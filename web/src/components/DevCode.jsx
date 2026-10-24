/**
 * Development helper. The API only sends `dev` when it is running in development with console delivery
 * (never in production), so this box never appears for real users. It saves hunting for the code in a console window.
 */
export function DevCode({ code, note, onUse }) {
  if (!code && !note) return null;
  return (
    <div className="dev-box" role="note">
      <strong>Development mode</strong>
      <span>No real email or SMS is sent here.</span>
      {code ? (
        <span className="dev-code">
          Your code: <b>{code}</b>
          {onUse && (
            <button type="button" className="link-btn" onClick={() => onUse(code)}>
              Fill it in
            </button>
          )}
        </span>
      ) : (
        <span>{note}</span>
      )}
      {code && note && <span>{note}</span>}
    </div>
  );
}
