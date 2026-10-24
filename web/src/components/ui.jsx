import { useId, useState } from 'react';
import { useTheme } from '../lib/theme';

export function Field({ label, error, hint, prefix, trailing, id, className, ...input }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={inputId}>{label}</label>
      <div className="control">
        {prefix && <span className="prefix">{prefix}</span>}
        <input id={inputId} aria-invalid={!!error} aria-describedby={describedBy} {...input} />
        {trailing}
      </div>
      {error ? (
        <p className="field-msg error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-msg" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordField(props) {
  const [shown, setShown] = useState(false);
  return (
    <Field
      {...props}
      type={shown ? 'text' : 'password'}
      trailing={
        <button type="button" className="reveal" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
          {shown ? 'Hide' : 'Show'}
        </button>
      }
    />
  );
}

export function Button({ busy, children, variant = 'primary', ...rest }) {
  return (
    <button {...rest} className={`btn btn-${variant} ${rest.className ?? ''}`} disabled={busy || rest.disabled} aria-busy={busy}>
      {busy && <span className="spinner" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}

export function FormAlert({ children }) {
  return (
    <div className="form-alert" role="alert">
      {children}
    </div>
  );
}

const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const LABEL = { system: 'Theme: match device', light: 'Theme: light', dark: 'Theme: dark' };

export function ThemeToggle() {
  const [pref, setPref] = useTheme();
  return (
    <button type="button" className="theme-toggle" onClick={() => setPref(NEXT[pref])} title={LABEL[pref]} aria-label={`${LABEL[pref]}. Change theme`}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        {pref === 'dark' ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor" />
        ) : pref === 'light' ? (
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </g>
        ) : (
          <g fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
          </g>
        )}
      </svg>
    </button>
  );
}

export function Wordmark({ size = 'md' }) {
  return <span className={`wordmark wordmark-${size}`}>SocialAmbak</span>;
}
