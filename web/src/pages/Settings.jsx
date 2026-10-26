import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Topbar } from '../components/Topbar';
import { Button, Field, FormAlert, PasswordField } from '../components/ui';
import { api, ApiError, MAX_IMAGE_BYTES, uploadMedia } from '../lib/api';

const msg = (e, fallback = 'Something went wrong. Try again.') => (e instanceof ApiError ? e.message : fallback);

function ProfileForm() {
  const { user, refreshUser } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [website, setWebsite] = useState(user?.website ?? '');
  const [isPrivate, setIsPrivate] = useState(user?.isPrivate ?? false);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  if (!user) return null;

  const pick = (f) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return setFormError('Choose a JPG, PNG, WebP or GIF photo.');
    if (f.size > MAX_IMAGE_BYTES) return setFormError('Photos can be up to 5 MB.');
    setFormError('');
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  };

  async function save(e) {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setSaved(false);
    setBusy(true);
    try {
      const avatarKey = photo ? (await uploadMedia(photo)).key : undefined;
      await api('/users/me', { method: 'PATCH', body: { fullName, bio, website: website.trim() || null, isPrivate, ...(avatarKey ? { avatarKey } : {}) } });
      await refreshUser();
      setPhoto(null);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors(err.fields);
      else setFormError(msg(err, 'Could not save. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={save} noValidate>
      <h2>Edit profile</h2>
      <div className="avatar-edit">
        <Avatar name={fullName || user.fullName} src={preview ?? user.avatarUrl} size={72} />
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn btn-quiet" onClick={() => file.current?.click()}>
          Change photo
        </button>
      </div>
      {formError && <FormAlert>{formError}</FormAlert>}
      <div className="stack full">
        <Field label="Name" value={fullName} onChange={(e) => setFullName(e.target.value)} error={errors.fullName} maxLength={60} />
        <Field label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} error={errors.bio} maxLength={150} hint={`${bio.length}/150`} />
        <Field label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} error={errors.website} placeholder="https://" inputMode="url" autoCapitalize="none" />
        <label className="switch">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          <span>
            Private account<small>Only people you approve can see your posts. People who asked to follow are approved if you turn this off.</small>
          </span>
        </label>
      </div>
      <div className="row">
        <Button type="submit" busy={busy}>
          Save changes
        </Button>
        {saved && (
          <span className="notice" role="status">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

function Preferences() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/account/settings')
      .then(setS)
      .catch((e) => setError(msg(e)));
  }, []);
  if (!s)
    return (
      <section className="panel">
        <h2>Messages and notifications</h2>
        {error ? <FormAlert>{error}</FormAlert> : <p className="fine">Loading…</p>}
      </section>
    );

  const change = async (patch) => {
    const before = s;
    setS({ ...s, ...patch });
    setError('');
    try {
      setS(await api('/account/settings', { method: 'PATCH', body: patch }));
    } catch (e) {
      setS(before);
      setError(msg(e));
    }
  };
  const toggle = (key, label) => (
    <label className="switch">
      <input type="checkbox" checked={s[key]} onChange={(e) => change({ [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );

  return (
    <section className="panel" aria-labelledby="prefs-h">
      <h2 id="prefs-h">Messages and notifications</h2>
      {error && <FormAlert>{error}</FormAlert>}
      <label className="field full">
        <span className="fine">Who can start a chat with you</span>
        <select className="plain-select" value={s.messagesFrom} onChange={(e) => change({ messagesFrom: e.target.value })}>
          <option value="everyone">Everyone</option>
          <option value="following">Only people I follow</option>
          <option value="nobody">Nobody</option>
        </select>
      </label>
      <fieldset className="reasons">
        <legend className="fine">Notify me about</legend>
        {toggle('notifyLikes', 'Likes on my posts')}
        {toggle('notifyComments', 'Comments and replies')}
        {toggle('notifyFollows', 'New followers and follow requests')}
      </fieldset>
    </section>
  );
}

function Blocked() {
  const [people, setPeople] = useState(null);
  useEffect(() => {
    api('/safety/blocked')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);
  const unblock = async (p) => {
    await api(`/safety/block/${p.id}`, { method: 'DELETE' }).catch(() => {});
    setPeople((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
  };
  return (
    <section className="panel" aria-labelledby="blocked-h">
      <h2 id="blocked-h">Blocked accounts</h2>
      {people === null && <p className="fine">Loading…</p>}
      {people?.length === 0 && <p className="fine">You haven’t blocked anyone.</p>}
      <ul className="people full">
        {people?.map((p) => (
          <li key={p.id}>
            <Avatar name={p.fullName} src={p.avatarUrl} size={36} />
            <Link to={`/u/${p.username}`} className="plain who">
              <strong>{p.fullName}</strong>
              <span>@{p.username}</span>
            </Link>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => unblock(p)}>
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Security() {
  const { signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deact, setDeact] = useState(false);
  const [deactPw, setDeactPw] = useState('');
  const [deactError, setDeactError] = useState('');
  const [outBusy, setOutBusy] = useState(false);
  const [outError, setOutError] = useState('');

  async function change(e) {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setDone(false);
    setBusy(true);
    try {
      await api('/account/change-password', { method: 'POST', body: { current, password: next } });
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors(err.fields);
      else setFormError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(e) {
    e.preventDefault();
    setDeactError('');
    try {
      await api('/account/deactivate', { method: 'POST', body: { password: deactPw } });
      await signOut(false).catch(() => {});
    } catch (err) {
      setDeactError(msg(err));
    }
  }

  return (
    <>
      <form className="panel" onSubmit={change} noValidate aria-labelledby="pw-h">
        <h2 id="pw-h">Change password</h2>
        {formError && <FormAlert>{formError}</FormAlert>}
        <div className="stack full">
          <PasswordField label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          <PasswordField
            label="New password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            error={errors.password}
            hint="At least 8 characters, with a letter and a number."
            autoComplete="new-password"
          />
        </div>
        <div className="row">
          <Button type="submit" busy={busy} disabled={!current || !next}>
            Change password
          </Button>
          {done && (
            <span className="notice" role="status">
              Password changed. Other devices were signed out.
            </span>
          )}
        </div>
      </form>

      <section className="panel" aria-labelledby="danger-h">
        <h2 id="danger-h">Sign out and account</h2>
        {outError && <FormAlert>{outError}</FormAlert>}
        <Button
          variant="danger"
          busy={outBusy}
          onClick={async () => {
            setOutBusy(true);
            setOutError('');
            try {
              await signOut(true);
            } catch (e) {
              setOutError(`${msg(e)} Other devices may still be signed in.`);
              setOutBusy(false);
            }
          }}
        >
          Log out of all devices
        </Button>
        {!deact ? (
          <button type="button" className="link-btn quiet-danger" onClick={() => setDeact(true)}>
            Deactivate my account…
          </button>
        ) : (
          <form onSubmit={deactivate} className="stack full" noValidate>
            <p className="fine">Your profile, posts and stories are hidden until you sign in again. Enter your password to confirm.</p>
            {deactError && <FormAlert>{deactError}</FormAlert>}
            <PasswordField label="Password" value={deactPw} onChange={(e) => setDeactPw(e.target.value)} autoComplete="current-password" />
            <div className="row">
              <Button type="submit" variant="danger" disabled={!deactPw}>
                Deactivate
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setDeact(false);
                  setDeactPw('');
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}

export function Settings() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="app">
      <Topbar />
      <main className="app-main">
        <ProfileForm />
        <Preferences />
        <Blocked />
        <section className="panel" aria-labelledby="account-heading">
          <h2 id="account-heading">Account</h2>
          <dl className="details">
            <div>
              <dt>Username</dt>
              <dd>@{user.username}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                {user.email ?? <span className="muted">Not added</span>} {user.emailVerified && <span className="badge">Verified</span>}
              </dd>
            </div>
            <div>
              <dt>Mobile</dt>
              <dd>
                {user.phoneMasked} {user.phoneVerified && <span className="badge">Verified</span>}
              </dd>
            </div>
          </dl>
        </section>
        <Security />
      </main>
    </div>
  );
}
