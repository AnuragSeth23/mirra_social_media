import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthShell } from '../components/AuthShell';
import { DevCode } from '../components/DevCode';
import { OtpInput } from '../components/OtpInput';
import { Button, FormAlert } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clearPending, loadPending, savePending } from '../lib/pending';

const RESEND_SECONDS = 60;

export function Verify() {
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const [state, setState] = useState(loadPending);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!state) return <Navigate to="/signup" replace />;
  const channel = state.pending[0] ?? 'email';
  const destination = channel === 'email' ? (state.email ?? 'your email') : (state.phone ?? 'your phone');
  const stepIndex = channel === 'email' ? 1 : 2;

  async function submit(value = code) {
    if (value.length !== 6 || !state) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api('/auth/verify', { method: 'POST', body: { ticket: state.ticket, channel, code: value }, auth: false });
      if ('accessToken' in res) {
        clearPending();
        acceptSession(res);
        navigate('/', { replace: true });
        return;
      }
      const next = { ...state, pending: res.pending };
      savePending(next);
      setState(next);
      setCode('');
      setCooldown(RESEND_SECONDS);
      setNotice(`Email confirmed. Now enter the code we texted to ${state.phone ?? 'your phone'}.`);
    } catch (err) {
      setCode('');
      if (err instanceof ApiError && (err.code === 'ticket_expired' || err.code === 'invalid_token')) setExpired(true);
      else setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!state) return;
    setError('');
    setNotice('');
    try {
      const r = await api('/auth/resend', { method: 'POST', body: { ticket: state.ticket, channel }, auth: false });
      if (r.dev) {
        const next = { ...state, dev: { ...state.dev, ...r.dev } };
        savePending(next);
        setState(next);
      }
      setCooldown(RESEND_SECONDS);
      setNotice(`New code sent to ${destination}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const wait = err.details?.retryAfter ?? RESEND_SECONDS;
        setCooldown(wait);
      }
      if (err instanceof ApiError && (err.code === 'ticket_expired' || err.code === 'invalid_token')) setExpired(true);
      else setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  if (expired) {
    return (
      <AuthShell back="/signin">
        <h1>This step timed out</h1>
        <p className="lede">For your security, verification links last 30 minutes. Sign in with your password and we’ll send fresh codes.</p>
        <Button
          onClick={() => {
            clearPending();
            navigate('/signin');
          }}
        >
          Go to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      back={() => {
        clearPending();
        navigate('/signup');
      }}
      footer={
        <p>
          Wrong details?{' '}
          <Link to="/signup" onClick={clearPending}>
            Start again
          </Link>
        </p>
      }
    >
      <ol className="steps" aria-label="Sign-up progress">
        <li className="done">Your details</li>
        <li className={stepIndex === 1 ? 'current' : 'done'} aria-current={stepIndex === 1 ? 'step' : undefined}>
          Email code
        </li>
        <li className={stepIndex === 2 ? 'current' : ''} aria-current={stepIndex === 2 ? 'step' : undefined}>
          Phone code
        </li>
      </ol>
      <h1>{channel === 'email' ? 'Check your email' : 'Check your phone'}</h1>
      <p className="lede">
        Enter the 6-digit code we sent to <strong className="dest">{destination}</strong>. It expires in 10 minutes.
      </p>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error && <FormAlert>{error}</FormAlert>}
        <DevCode
          code={state.dev?.[channel]}
          onUse={(c) => {
            setCode(c);
            void submit(c);
          }}
        />
        <OtpInput key={channel} label={`${channel === 'email' ? 'Email' : 'Phone'} verification code`} value={code} onChange={setCode} onComplete={submit} disabled={busy} invalid={!!error} />
        <Button type="submit" busy={busy} disabled={code.length !== 6}>
          {busy ? 'Checking code' : 'Confirm code'}
        </Button>
        <p className="resend">
          {cooldown > 0 ? (
            <span>You can request a new code in {cooldown}s</span>
          ) : (
            <button type="button" className="link-btn" onClick={resend}>
              Send a new code
            </button>
          )}
        </p>
      </form>
    </AuthShell>
  );
}
