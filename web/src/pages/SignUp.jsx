import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { Button, Field, FormAlert, PasswordField } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { savePending } from '../lib/pending';
import { saveSignInId } from '../lib/signinId';
import { COUNTRIES, DEFAULT_COUNTRY, rules } from '../lib/validation';

const FIELD_ORDER = ['fullName', 'username', 'email', 'phone', 'dateOfBirth', 'password'];

function validate(f, country, verifyVia) {
  const out = {};
  for (const k of FIELD_ORDER) {
    // The email is optional: it is needed only when the sign-up code is to be sent there. If given, it must look like an email.
    const msg =
      k === 'password'
        ? rules.password(f.password, f.username.trim())
        : k === 'phone'
          ? rules.phone(f.phone, country)
          : k === 'email' && !f.email.trim()
            ? verifyVia === 'email'
              ? 'Enter your email to get the code there.'
              : ''
            : rules[k](f[k]);
    if (msg) out[k] = msg;
  }
  return out;
}

/**
 * Keeps only the digits of what was typed or pasted, drops a pasted country code ("+91 98765 43210", "919876543210")
 * and a leading trunk 0 ("09876543210"), and stops at 10 digits.
 */
function cleanPhone(raw, dial) {
  let d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+') && d.startsWith(dial)) d = d.slice(dial.length);
  else if (d.length > 10 && d.startsWith(dial)) d = d.slice(dial.length);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

export function SignUp() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', username: '', email: '', phone: '', dateOfBirth: '', password: '' });
  const [country, setCountry] = useState(DEFAULT_COUNTRY); // India (+91) is selected when the page opens
  const [verifyVia, setVerifyVia] = useState('phone'); // where the single sign-up code is sent
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [usernameState, setUsernameState] = useState('idle');
  const formRef = useRef(null);

  const clientErrors = validate(form, country, verifyVia);
  const errorFor = (k) => serverErrors[k] || (touched[k] ? clientErrors[k] : undefined);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setServerErrors((s) => ({ ...s, [k]: '' }));
  };
  // The mobile number box takes digits only and stops at 10; the country code lives in the Country box, not in this one.
  const setPhone = (e) => {
    setForm((f) => ({ ...f, phone: cleanPhone(e.target.value, dial) }));
    setServerErrors((s) => ({ ...s, phone: '' }));
  };
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  // Live username availability, debounced; only checked once the format is valid.
  useEffect(() => {
    const u = form.username.trim().toLowerCase();
    if (rules.username(u)) {
      setUsernameState('idle');
      return;
    }
    setUsernameState('checking');
    const ctrl = { cancelled: false };
    const t = setTimeout(async () => {
      try {
        const r = await api(`/auth/availability?username=${encodeURIComponent(u)}`, { auth: false });
        if (ctrl.cancelled) return;
        setUsernameState(r.username ? 'available' : 'taken');
        if (!r.username) setServerErrors((s) => ({ ...s, username: r.usernameReason ?? 'That username is taken.' }));
      } catch {
        if (!ctrl.cancelled) setUsernameState('idle'); // the submit will re-check
      }
    }, 450);
    return () => {
      ctrl.cancelled = true;
      clearTimeout(t);
    };
  }, [form.username]);

  const dial = COUNTRIES.find((c) => c.iso === country)?.dial ?? '1';
  // Drop a leading trunk 0 (common in national formats) before adding the country code.
  const e164 = () => `+${dial}${form.phone.replace(/\D/g, '').replace(/^0+/, '')}`;

  async function submit(e) {
    e.preventDefault();
    setTouched(Object.fromEntries(FIELD_ORDER.map((k) => [k, true])));
    setFormError('');
    const firstBad = FIELD_ORDER.find((k) => clientErrors[k] || serverErrors[k]);
    if (firstBad) {
      formRef.current?.querySelector(`[name="${firstBad}"]`)?.focus();
      return;
    }

    setBusy(true);
    try {
      const body = { ...form, username: form.username.trim().toLowerCase(), email: form.email.trim() || undefined, phone: e164(), verifyVia };
      const res = await api('/auth/signup', { method: 'POST', body, auth: false });
      savePending({ ...res, email: body.email, phone: `+${dial} ${form.phone.trim()}`, username: body.username });
      saveSignInId(body.username);
      navigate('/verify');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 422) && Object.keys(err.fields).length) {
        setServerErrors(err.fields);
        const first = FIELD_ORDER.find((k) => err.fields[k]);
        if (first) formRef.current?.querySelector(`[name="${first}"]`)?.focus();
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const usernameHint = usernameState === 'checking' ? 'Checking…' : usernameState === 'available' ? <span className="ok">Available</span> : 'Your unique ID, 3–30 characters: small letters, numbers, "." or "_". No spaces and no @. Example: anurag_seth';

  const maxDob = new Date().toISOString().slice(0, 10);

  return (
    <AuthShell
      back="/signin"
      footer={
        <p>
          Already have an account? <Link to="/signin">Sign in</Link>
        </p>
      }
    >
      <ol className="steps" aria-label="Sign-up progress">
        <li className="current" aria-current="step">
          Your details
        </li>
        <li>Verify code</li>
      </ol>
      <h1>Create your account</h1>
      <p className="lede">We’ll send one code to the email or phone you choose, to confirm it’s yours.</p>

      <form ref={formRef} onSubmit={submit} noValidate className="stack">
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label="Full name" name="fullName" value={form.fullName} onChange={set('fullName')} onBlur={blur('fullName')} error={errorFor('fullName')} autoComplete="name" maxLength={60} autoFocus />
        <Field
          label="Username"
          name="username"
          value={form.username}
          onChange={(e) => set('username')({ target: { value: e.target.value.replace(/[@\s]/g, '').toLowerCase() } })} // an @, spaces or capitals are dropped as you type
          onBlur={blur('username')}
          error={errorFor('username')}
          hint={usernameHint}
          placeholder="e.g. anurag_seth"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={set('email')}
          onBlur={blur('email')}
          error={errorFor('email')}
          hint={verifyVia === 'email' ? 'Needed to receive your code by email.' : 'Optional. Add it to sign in or recover your account by email too.'}
          autoComplete="email"
          autoCapitalize="none"
        />
        <div className="field-row">
          <div className="field country">
            <label htmlFor="country">Country</label>
            <div className="control">
              <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} autoComplete="tel-country-code">
                {COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {c.name} (+{c.dial})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Field
            label="Mobile number"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={setPhone}
            onBlur={blur('phone')}
            error={errorFor('phone')}
            autoComplete="tel-national"
            inputMode="numeric"
            placeholder="10-digit mobile number"
          />
        </div>
        <Field
          label="Date of birth"
          name="dateOfBirth"
          type="date"
          value={form.dateOfBirth}
          onChange={set('dateOfBirth')}
          onBlur={blur('dateOfBirth')}
          error={errorFor('dateOfBirth')}
          hint="Not shown on your profile."
          max={maxDob}
        />
        <PasswordField
          label="Password"
          name="password"
          value={form.password}
          onChange={set('password')}
          onBlur={blur('password')}
          error={errorFor('password')}
          hint="At least 8 characters, with a letter and a number."
          autoComplete="new-password"
        />
        <fieldset className="choice-group">
          <legend>Send my verification code to</legend>
          {[
            ['phone', 'Phone (text message)', form.phone ? `+${dial} ${form.phone}` : 'the number you enter above'],
            ['email', 'Email address', form.email.trim() || 'enter your email above to use this'],
          ].map(([value, label, where]) => (
            <label key={value} className={`choice ${verifyVia === value ? 'on' : ''}`}>
              <input type="radio" name="verifyVia" value={value} checked={verifyVia === value} onChange={() => setVerifyVia(value)} />
              <span>
                <strong>{label}</strong>
                <small>{where}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" busy={busy}>
          {busy ? 'Creating account' : 'Create account'}
        </Button>
        <p className="fine">By creating an account you agree to the Terms and Privacy Policy.</p>
      </form>
    </AuthShell>
  );
}
