import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { DevCode } from '../components/DevCode';
import { OtpInput } from '../components/OtpInput';
import { Button, Field, FormAlert, PasswordField } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { rules } from '../lib/validation';

const RESEND_SECONDS = 60;

export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState('ask');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [dev, setDev] = useState(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err) => {
    if (err instanceof ApiError && err.status === 422) setErrors(err.fields);
    else if (err instanceof ApiError && err.code === 'invalid_code' && typeof err.details?.attemptsLeft === 'number') {
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
      const r = await api('/auth/forgot', { method: 'POST', body: { identifier }, auth: false });
      setDev(r.dev ?? null);
      setStep('reset');
      setCode('');
      setCooldown(RESEND_SECONDS);
      setNotice('If an account matches, we’ve sent a 6-digit code to its email.');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function reset(e) {
    e.preventDefault();
    setErrors({});
    setFormError('');
    const pwd = rules.password(password, identifier.includes('@') || identifier.startsWith('+') ? '' : identifier.trim());
    if (code.length !== 6) return setFormError('Enter the 6-digit code.');
    if (pwd) return setErrors({ password: pwd });
    setBusy(true);
    try {
      await api('/auth/reset', { method: 'POST', body: { identifier, code, password }, auth: false });
      navigate('/signin', { replace: true, state: { notice: 'Password changed. Sign in with your new password.' } });
    } catch (err) {
      setCode('');
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      back={
        step === 'reset'
          ? () => {
              setStep('ask');
              setFormError('');
              setNotice('');
            }
          : '/signin'
      }
      footer={
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      }
    >
      {step === 'ask' ? (
        <>
          <h1>Forgot password?</h1>
          <p className="lede">Enter your username, email or phone. We’ll email a code to reset it.</p>
          <form onSubmit={sendCode} noValidate className="stack">
            {formError && <FormAlert>{formError}</FormAlert>}
            <Field
              label="Username, email or phone"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              error={errors.identifier}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
            <Button type="submit" busy={busy}>
              Send code
            </Button>
          </form>
        </>
      ) : (
        <>
          <h1>Set a new password</h1>
          <p className="lede">Enter the code from your email, then choose a new password.</p>
          <form onSubmit={reset} noValidate className="stack">
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {formError && <FormAlert>{formError}</FormAlert>}
            <DevCode code={dev?.code} note={dev?.note} onUse={setCode} />
            <OtpInput label="Reset code" value={code} onChange={setCode} disabled={busy} invalid={!!formError} />
            <PasswordField
              label="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              hint="At least 8 characters, with a letter and a number."
              autoComplete="new-password"
            />
            <Button type="submit" busy={busy} disabled={code.length !== 6 || !password}>
              Change password
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
    </AuthShell>
  );
}
