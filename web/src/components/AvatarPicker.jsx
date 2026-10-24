import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError, MAX_IMAGE_BYTES, uploadMedia } from '../lib/api';
import { Avatar } from './Avatar';
import { CameraCapture } from './CameraCapture';
import { CameraIcon } from './Icons';

/**
 * Your own profile photo with a small camera badge. Click it to choose a photo, take one with the camera,
 * or remove the current one. The change is saved straight away.
 */
export function AvatarPicker({ size = 88, onChanged }) {
  const { user, refreshUser } = useAuth();
  const [menu, setMenu] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);
  const file = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e) => {
      if (!box.current?.contains(e.target)) setMenu(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  if (!user) return null;

  async function save(avatarKey) {
    await api('/users/me', { method: 'PATCH', body: { avatarKey } });
    await refreshUser();
    onChanged?.();
  }

  async function upload(f) {
    if (!f) return;
    setError('');
    const type = f.type.split(';')[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return setError('Choose a JPG, PNG, WebP or GIF photo.');
    if (f.size > MAX_IMAGE_BYTES) return setError('Photos can be up to 5 MB.');
    setBusy(true);
    try {
      await save((await uploadMedia(f)).key);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change your photo. Try again.');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  async function remove() {
    setMenu(false);
    setError('');
    setBusy(true);
    try {
      await save(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove your photo. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avatar-picker" ref={box}>
      <button type="button" className="avatar-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Change profile photo" disabled={busy}>
        <Avatar name={user.fullName} src={user.avatarUrl} size={size} ring />
        <span className="avatar-badge" aria-hidden>
          <CameraIcon size={14} />
        </span>
        {busy && (
          <span className="avatar-busy" role="status" aria-label="Saving photo">
            <span className="spinner" aria-hidden />
          </span>
        )}
      </button>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      {menu && (
        <div className="menu avatar-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              file.current?.click();
            }}
          >
            Choose a photo
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setCamera(true);
            }}
          >
            Take a photo
          </button>
          {user.avatarUrl && (
            <button type="button" role="menuitem" className="danger" onClick={remove}>
              Remove current photo
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="field-msg error avatar-error" role="alert">
          {error}
        </p>
      )}
      {camera && (
        <CameraCapture
          onClose={() => setCamera(false)}
          onCapture={(f) => {
            setCamera(false);
            if (f.type.startsWith('video/')) setError('A profile photo has to be a picture, not a video. Use the white camera button.');
            else void upload(f);
          }}
        />
      )}
    </div>
  );
}
