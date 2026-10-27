import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { Avatar } from '../components/Avatar';
import { DevCode } from '../components/DevCode';
import { OtpInput } from '../components/OtpInput';
import { Button, Field, FormAlert, PasswordField } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { saveSignInId } from '../lib/signinId';
import { rules } from '../lib/validation';

const RESEND_SECONDS = 60;
// An @ means an email, digits (with an optional +) a phone number, anything else a username.
const looksLikeUsername = (v) => !!v.trim() && !v.includes('@') && !/^\+?[\d\s().-]{7,}$/.test(v.trim());

/**
 * Forgot password and forgot username, one flow (like Instagram / Facebook):
 *   ask → code → accounts → reset
 * Type a username, email or mobile number; for a username choose whether the code goes to its email or its phone.
 * The code proves the email or phone, and then EVERY account that uses it is listed: sign in as one, or reset its password.
 */
export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState('ask');
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState('phone'); // every account has a phone; the email is optional
  const [ticket, setTicket] = useState('');
  const [destination, setDestination] = useState(null);
  const [sentTo, setSentTo] = useState('email');
  const [dev, setDev] = useState(null);
  const [code, setCode] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const byUsername = looksLikeUsername(identifier);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err) => {
    if (err instanceof ApiError && err.status === 422) setErrors(err.fields);
    else if (err instanceof ApiError && err.code === 'recovery_expired') {
      setStep('ask');
      setFormError(err.message);
    } else if (err instanceof ApiError && err.code === 'invalid_code' && typeof err.details?.attemptsLeft === 'number') {
      const left = err.details.attemptsLeft;
      setFormError(`${err.message} ${left} ${left === 1 ? 'try' : 'tries'} left.`);
    } else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
  };

  async function sendCode(e) {
    e?.preventDefault();
    setErrors({});
    setFormError('');
    setNotice('');
    if (!identifier.trim()) return setErrors({ identifier: 'Enter your username, email or phone.' });
    setBusy(true);
    try {
      const r = await api('/auth/recover/start', { method: 'POST', body: { identifier, ...(byUsername ? { channel } : {}) }, auth: false });
      setTicket(r.ticket);
      setDestination(r.destination);
      setSentTo(r.channel);
      setDev(r.dev ?? null);
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(e) {
    e.preventDefault();
    setFormError('');
    if (code.length !== 6) return setFormError('Enter the 6-digit code.');
    setBusy(true);
    try {
      const r = await api('/auth/recover/verify', { method: 'POST', body: { ticket, code }, auth: false });
      setAccounts(r.accounts);
      setStep('accounts');
    } catch (err) {
      setCode('');
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setErrors({});
    setFormError('');
    const pwd = rules.password(password, chosen.username);
    if (pwd) return setErrors({ password: pwd });
    setBusy(true);
    try {
      await api('/auth/recover/reset', { method: 'POST', body: { ticket, userId: chosen.id, password }, auth: false });
      saveSignInId(chosen.username);
      navigate('/signin', { replace: true, state: { notice: `Password changed for @${chosen.username}. Sign in with your new password.` } });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const back = {
    ask: '/signin',
    code: () => { setStep('ask'); setFormError(''); },
    accounts: () => { setStep('ask'); setFormError(''); setAccounts([]); },
    reset: () => { setStep('accounts'); setFormError(''); setErrors({}); setPassword(''); },
  }[step];

  return (
    <AuthShell
      back={back}
      footer={
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      }
    >
      {step === 'ask' && (
        <>
          <h1>Find your account</h1>
          <p className="lede">Forgot your password or your username? Enter your username, email or mobile number (like 98765 43210 or +91 98765 43210).</p>
          <form onSubmit={sendCode} noValidate className="stack">
            {formError && <FormAlert>{formError}</FormAlert>}
            <Field
              label="Username, email or phone"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              error={errors.identifier}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
            {byUsername && (
              <fieldset className="choice-group">
                <legend>Send the code to the account’s</legend>
                {[
                  ['phone', 'Phone (text message)'],
                  ['email', 'Email (if the account has one)'],
                ].map(([value, label]) => (
                  <label key={value} className={`choice ${channel === value ? 'on' : ''}`}>
                    <input type="radio" name="channel" value={value} checked={channel === value} onChange={() => setChannel(value)} />
                    <span>
                      <strong>{label}</strong>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <Button type="submit" busy={busy}>
              Send code
            </Button>
          </form>
        </>
      )}

      {step === 'code' && (
        <>
          <h1>{sentTo === 'email' ? 'Check your email' : 'Check your phone'}</h1>
          <p className="lede">
            Enter the 6-digit code we sent to <strong className="dest">{destination ?? (sentTo === 'email' ? 'the email saved on that account' : 'the phone saved on that account')}</strong>. It expires in 10 minutes.
          </p>
          <form onSubmit={checkCode} noValidate className="stack">
            {formError && <FormAlert>{formError}</FormAlert>}
            <DevCode code={dev?.code} note={dev?.note} onUse={setCode} />
            <OtpInput label="Verification code" value={code} onChange={setCode} disabled={busy} invalid={!!formError} />
            <Button type="submit" busy={busy} disabled={code.length !== 6}>
              Confirm code
            </Button>
            <p className="resend">
              {cooldown > 0 ? (
                <span>You can request a new code in {cooldown}s</span>
              ) : (
                <button type="button" className="link-btn" onClick={() => sendCode()}>
                  Send a new code
                </button>
              )}
            </p>
          </form>
        </>
      )}

      {step === 'accounts' && (
        <>
          <h1>{accounts.length === 1 ? 'We found your account' : 'We found your accounts'}</h1>
          <p className="lede">
            {accounts.length === 1 ? 'This is the account that uses ' : 'These accounts use '}
            {sentTo === 'email' ? 'that email' : 'that phone number'}. Sign in, or choose a new password.
          </p>
          {formError && <FormAlert>{formError}</FormAlert>}
          {accounts.length === 0 ? (
            <p className="fine">No active account uses it any more.</p>
          ) : (
            <ul className="account-list">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Avatar name={a.fullName} src={a.avatarUrl} size={42} />
                  <div className="who">
                    <strong>{a.fullName}</strong>
                    <span>@{a.username}</span>
                  </div>
                  <div className="acts">
                    <Link to="/signin" className="link-btn" onClick={() => saveSignInId(a.username)}>
                      Sign in
                    </Link>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setChosen(a);
                        setPassword('');
                        setErrors({});
                        setFormError('');
                        setStep('reset');
                      }}
                    >
                      Reset password
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {step === 'reset' && chosen && (
        <>
          <h1>Set a new password</h1>
          <p className="lede">
            For <strong>@{chosen.username}</strong>. You’ll be signed out everywhere else.
          </p>
          <form onSubmit={changePassword} noValidate className="stack">
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {formError && <FormAlert>{formError}</FormAlert>}
            <PasswordField
              label="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              hint="At least 8 characters, with a letter and a number."
              autoComplete="new-password"
              autoFocus
            />
            <Button type="submit" busy={busy} disabled={!password}>
              Change password
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
