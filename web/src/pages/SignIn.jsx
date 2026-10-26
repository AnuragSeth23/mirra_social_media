import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthShell } from '../components/AuthShell';
import { Button, Field, FormAlert, PasswordField } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { savePending } from '../lib/pending';
import { clearSignInId, getSignInId, saveSignInId } from '../lib/signinId';

export function SignIn() {
  const { acceptSession } = useAuth();
  const navigate = useNavigate();
  const notice = useLocation().state?.notice;
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [suggested, setSuggested] = useState(getSignInId); // username used or created last on this device
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const next = {};
    if (!identifier.trim()) next.identifier = 'Enter your username, email or phone.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const session = await api('/auth/login', { method: 'POST', body: { identifier, password }, auth: false });
      acceptSession(session);
      if (session.user?.username) saveSignInId(session.user.username);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'verification_required') {
        savePending(err.details);
        navigate('/verify');
      } else if (err instanceof ApiError && err.status === 422) {
        setErrors(err.fields);
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      footer={
        <p>
          New to SocialAmbak? <Link to="/signup">Create an account</Link>
        </p>
      }
    >
      <h1>Sign in</h1>
      <p className="lede">Welcome back. Use your username, email or mobile number.</p>
      <form onSubmit={submit} noValidate className="stack">
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field
          label="Username, email or phone"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={errors.identifier}
          autoComplete="off" // the browser must not pre-fill a saved login here
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
        />
        {suggested && !identifier && (
          <p className="fine">
            Your sign-in ID:{' '}
            <button type="button" className="link-btn" onClick={() => setIdentifier(suggested)}>
              @{suggested}
            </button>{' '}
            ·{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                clearSignInId();
                setSuggested('');
              }}
            >
              Not you?
            </button>
          </p>
        )}
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="new-password" />
        <p className="fine">
          <Link to="/forgot">Forgot password or username?</Link>
        </p>
        <Button type="submit" busy={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
