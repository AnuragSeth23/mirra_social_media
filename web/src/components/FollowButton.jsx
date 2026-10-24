import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Follow / Follow back / Requested / Following. Clicking "Following" or "Requested" unfollows (after a confirm). */
export function FollowButton({ userId, username, following, followsYou, onChange }) {
  const [state, setState] = useState(following);
  const [busy, setBusy] = useState(false);
  useEffect(() => setState(following), [following]); // keep in step when the parent reloads

  const click = async () => {
    if (state !== 'none' && !confirm(state === 'pending' ? `Cancel your request to @${username}?` : `Unfollow @${username}?`)) return;
    setBusy(true);
    try {
      const r = await api(`/users/${userId}/follow`, { method: state === 'none' ? 'PUT' : 'DELETE' });
      setState(r.following);
      onChange?.(r.following);
    } catch {
      /* leave the button as it was; the next click retries */
    } finally {
      setBusy(false);
    }
  };

  const label = state === 'none' ? (followsYou ? 'Follow back' : 'Follow') : state === 'pending' ? 'Requested' : 'Following';
  return (
    <button type="button" className={`btn ${state === 'none' ? 'btn-primary' : 'btn-quiet'} btn-sm`} onClick={click} disabled={busy} aria-pressed={state === 'accepted'}>
      {label}
    </button>
  );
}
