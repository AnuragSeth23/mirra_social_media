import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { BackButton } from './BackButton';
import { BellIcon, HomeIcon, LogoutIcon, MailIcon, PlusIcon, ReelIcon, SearchIcon, SettingsIcon, UserIcon } from './Icons';
import { Button, ThemeToggle, Wordmark } from './ui';

/** Unread notification and message counts, refreshed every 30 s and whenever the route changes. */
function useBadges() {
  const { pathname } = useLocation();
  const [counts, setCounts] = useState({ notifications: 0, messages: 0 });
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([api('/notifications/unread-count'), api('/messages/unread-count')])
        .then(([n, m]) => live && setCounts({ notifications: n.count, messages: m.count }))
        .catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pathname]);
  return counts;
}

function Tab({ to, label, children, badge, end, side }) {
  return (
    <NavLink to={to} end={end} className={`tab ${side ? 'side-only' : ''}`} aria-label={badge ? `${label}, ${badge} new` : label} title={label}>
      {({ isActive }) => (
        <>
          {children(isActive)}
          {!!badge && <span className="dot">{badge > 9 ? '9+' : badge}</span>}
          <span className="tab-label">{label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Your avatar in the top bar. Click it for a small profile card: counts, a link to your full profile, and edit. */
function ProfileMenu() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div className="profile-menu" ref={box}>
      <button type="button" className="profile-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Your profile">
        <Avatar name={user.fullName} src={user.avatarUrl} size={38} ring={open} />
        <span className="profile-name">
          <strong>{user.fullName}</strong>
          <small>@{user.username}</small>
        </span>
      </button>
      {open && (
        <div className="profile-card" role="dialog" aria-label="Your profile">
          <Avatar name={user.fullName} src={user.avatarUrl} size={72} ring />
          <h2>{user.fullName}</h2>
          <p className="handle">@{user.username}</p>
          <dl className="counts">
            <div>
              <dt>posts</dt>
              <dd>{user.postsCount}</dd>
            </div>
            <div>
              <dt>followers</dt>
              <dd>{user.followersCount}</dd>
            </div>
            <div>
              <dt>following</dt>
              <dd>{user.followingCount}</dd>
            </div>
          </dl>
          {user.bio && <p className="bio">{user.bio}</p>}
          <div className="row">
            <Link to={`/u/${user.username}`} className="btn btn-primary btn-sm plain">
              View profile
            </Link>
            <Link to="/settings" className="btn btn-quiet btn-sm plain">
              Edit profile
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const badges = useBadges();
  const navigate = useNavigate();
  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          {pathname !== '/' && <BackButton />}
          <Link to="/" className="plain" aria-label="SocialAmbak home">
            <Wordmark size="sm" />
          </Link>
        </div>
        <nav className="mainnav" aria-label="Main">
          <Tab to="/" end label="Home">
            {(a) => <HomeIcon filled={a} />}
          </Tab>
          <Tab to="/search" label="Search">
            {() => <SearchIcon />}
          </Tab>
          <button type="button" className="tab create" onClick={() => navigate('/', { state: { create: Date.now() } })} aria-label="Create" title="Create">
            <PlusIcon />
            <span className="tab-label">Create</span>
          </button>
          <Tab to="/reels" label="Reels">
            {(a) => <ReelIcon filled={a} />}
          </Tab>
          <Tab to="/notifications" label="Activity" badge={badges.notifications}>
            {(a) => <BellIcon filled={a} />}
          </Tab>
          <Tab to="/messages" label="Messages" badge={badges.messages}>
            {(a) => <MailIcon filled={a} />}
          </Tab>
          {user && (
            <Tab to={`/u/${user.username}`} label="Profile">
              {(a) => <UserIcon filled={a} />}
            </Tab>
          )}
          <Tab to="/settings" label="Settings" side>
            {() => <SettingsIcon />}
          </Tab>
        </nav>
        <div className="topbar-actions">
          <Link to="/settings" className="navlink tablet-only">
            Settings
          </Link>
          <ThemeToggle />
          <ProfileMenu />
          <Button
            variant="quiet"
            busy={busy}
            className="logout-btn"
            onClick={() => {
              setBusy(true);
              signOut(false).catch(() => {});
            }}
          >
            <span className="logout-icon" aria-hidden>
              <LogoutIcon />
            </span>
            Log out
          </Button>
        </div>
      </header>
    </>
  );
}
