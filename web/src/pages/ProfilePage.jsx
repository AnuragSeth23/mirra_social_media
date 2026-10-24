import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { FollowButton } from '../components/FollowButton';
import { Avatar } from '../components/Avatar';
import { AvatarPicker } from '../components/AvatarPicker';
import { CommentIcon, HeartIcon, VideoIcon } from '../components/Icons';
import { PostCard } from '../components/PostCard';
import { PostModal } from '../components/PostModal';
import { Topbar } from '../components/Topbar';
import { Button } from '../components/ui';
import { ReportDialog } from '../components/ReportDialog';
import { MoreIcon } from '../components/Icons';
import { api, ApiError } from '../lib/api';

export function ProfilePage() {
  const { username = '' } = useParams();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('posts');
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState('');

  // Answers that arrive after you have moved to another profile are ignored.
  const current = useRef(username);
  current.current = username;
  const loadProfile = useCallback(
    () =>
      api(`/users/by/${encodeURIComponent(username)}`)
        .then((p) => {
          if (current.current === username) setProfile(p);
        })
        .catch((e) => {
          if (current.current === username && e instanceof ApiError && e.status === 404) setMissing(true);
          else if (current.current === username) setProblem('Couldn’t load this profile. Check your connection and refresh.');
        }),
    [username],
  );

  useEffect(() => {
    setProfile(null);
    setMissing(false);
    setTab('posts');
    setOpenId(null);
    void loadProfile();
  }, [loadProfile]);

  const loadPosts = useCallback(
    async (before) => {
      const base = tab === 'saved' ? '/posts/saved' : `/posts/by/${encodeURIComponent(username)}`;
      const page = await api(`${base}${before ? `?before=${before}` : ''}`);
      if (current.current !== username) return;
      setPosts((p) => (before ? [...p, ...page.posts] : page.posts));
      setCursor(page.nextCursor);
    },
    [username, tab],
  );

  // Load whatever the active tab shows, once the profile says we're allowed to see it.
  useEffect(() => {
    if (!profile?.canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const job = tab === 'posts' || tab === 'saved' ? loadPosts() : api(`/users/by/${encodeURIComponent(username)}/connections?type=${tab}`).then(setPeople);
    job
      .catch((e) => {
        if (!(e instanceof ApiError)) throw e;
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profile?.canView, profile?.id]);

  const message = async () => {
    setProblem('');
    try {
      navigate(`/messages/${(await api(`/messages/with/${profile.id}`, { method: 'POST' })).id}`);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not open the chat.');
    }
  };

  const openPost = posts.find((p) => p.id === openId) ?? null;
  const toggleBlock = async () => {
    setMenu(false);
    setProblem('');
    if (!profile.blockedByMe && !confirm(`Block @${profile.username}? They won’t be able to find your profile or posts, and you’ll stop following each other.`)) return;
    try {
      await api(`/safety/block/${profile.id}`, { method: profile.blockedByMe ? 'DELETE' : 'PUT' });
      await loadProfile();
      void refreshUser();
      setTab('posts');
      setPosts([]);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not do that. Try again.');
    }
  };

  const afterFollowChange = () => {
    void loadProfile();
    void refreshUser();
  };

  if (missing) {
    return (
      <div className="app">
        <Topbar />
        <main className="app-main">
          <div className="empty">
            <h2>No such account</h2>
            <p>We couldn’t find @{username}.</p>
            <Link to="/">Back to feed</Link>
          </div>
        </main>
      </div>
    );
  }
  if (!profile && problem)
    return (
      <div className="app">
        <Topbar />
        <main className="app-main">
          <div className="empty">
            <h2>Something went wrong</h2>
            <p>{problem}</p>
          </div>
        </main>
      </div>
    );
  if (!profile)
    return (
      <div className="app">
        <Topbar />
        <main className="app-main">
          <p className="fine center" role="status">
            Loading profile…
          </p>
        </main>
      </div>
    );

  return (
    <div className="app">
      <Topbar />
      <main className="app-main profile-main">
        <section className="profile-head compact" aria-labelledby="profile-name">
          {profile.isMe ? <AvatarPicker size={88} onChanged={() => void loadProfile()} /> : <Avatar name={profile.fullName} src={profile.avatarUrl} size={88} ring />}
          <div className="profile-info">
            <h1 id="profile-name">{profile.fullName}</h1>
            <p className="handle">
              @{profile.username}
              {profile.isPrivate && ' · Private'}
              {profile.followsYou && !profile.isMe && ' · Follows you'}
            </p>
            <dl className="counts">
              <div>
                <dt>posts</dt>
                <dd>{profile.postsCount}</dd>
              </div>
              <div>
                <dt>
                  <button type="button" className="count-btn" onClick={() => setTab('followers')}>
                    followers
                  </button>
                </dt>
                <dd>{profile.followersCount}</dd>
              </div>
              <div>
                <dt>
                  <button type="button" className="count-btn" onClick={() => setTab('following')}>
                    following
                  </button>
                </dt>
                <dd>{profile.followingCount}</dd>
              </div>
            </dl>
            {profile.bio && <p className="bio">{profile.bio}</p>}
            {/^https?:\/\//i.test(profile.website ?? '') && (
              <a className="site" href={profile.website} target="_blank" rel="noopener noreferrer nofollow">
                {profile.website.replace(/^https?:\/\//i, '')}
              </a>
            )}
            <div className="row">
              {!profile.isMe && (
                <FollowButton key={profile.following} userId={profile.id} username={profile.username} following={profile.following} followsYou={profile.followsYou} onChange={afterFollowChange} />
              )}
              {!profile.isMe && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={message}>
                  Message
                </button>
              )}
              {profile.isMe && (
                <Link to="/settings" className="btn btn-quiet btn-sm plain">
                  Edit profile
                </Link>
              )}
              {!profile.isMe && (
                <span className="menu-wrap">
                  <button type="button" className="icon-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="More options">
                    <MoreIcon />
                  </button>
                  {menu && (
                    <div className="menu" role="menu">
                      <button type="button" role="menuitem" className="danger" onClick={toggleBlock}>
                        {profile.blockedByMe ? 'Unblock' : 'Block'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          setReporting(true);
                        }}
                      >
                        Report
                      </button>
                    </div>
                  )}
                </span>
              )}
            </div>
            {problem && (
              <p className="field-msg error" role="alert">
                {problem}
              </p>
            )}
          </div>
        </section>

        {profile.blockedByMe ? (
          <div className="empty">
            <h2>You blocked @{profile.username}</h2>
            <p>They can’t see your profile or posts. Unblock to follow or message them again.</p>
          </div>
        ) : !profile.canView ? (
          <div className="empty">
            <h2>This account is private</h2>
            <p>Follow @{profile.username} to see their posts. They’ll need to accept your request.</p>
          </div>
        ) : (
          <>
            <div className="tabs" role="tablist">
              {(profile.isMe ? ['posts', 'saved', 'followers', 'following'] : ['posts', 'followers', 'following']).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            {loading && (
              <p className="fine center" role="status">
                Loading…
              </p>
            )}
            {!loading && (tab === 'posts' || tab === 'saved') && (
              <section aria-label={tab === 'saved' ? 'Saved posts' : 'Posts'}>
                {posts.length === 0 && (
                  <div className="empty">
                    <h2>{tab === 'saved' ? 'Nothing saved yet' : 'No posts yet'}</h2>
                    {tab === 'saved' && <p>Tap the bookmark on any post to keep it here.</p>}
                  </div>
                )}
                <div className="grid profile-grid">
                  {posts.map((p) => (
                    <button key={p.id} type="button" className="tile" onClick={() => setOpenId(p.id)} aria-label={`Open post${p.caption ? `: ${p.caption.slice(0, 60)}` : ''}`}>
                      {p.mediaType === 'video' ? (
                        <video src={`${p.mediaUrl}#t=0.1`} preload="metadata" muted playsInline />
                      ) : p.mediaUrl ? (
                        <img src={p.mediaUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="tile-text">{p.caption}</span>
                      )}
                      {p.mediaType === 'video' && (
                        <span className="tile-badge">
                          <VideoIcon />
                        </span>
                      )}
                      <span className="tile-stats">
                        <span>
                          <HeartIcon filled /> {p.likeCount}
                        </span>
                        <span>
                          <CommentIcon /> {p.commentCount}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {cursor && (
                  <Button
                    variant="quiet"
                    busy={more}
                    onClick={async () => {
                      setMore(true);
                      await loadPosts(cursor);
                      setMore(false);
                    }}
                  >
                    Load more
                  </Button>
                )}
              </section>
            )}
            {!loading && tab !== 'posts' && tab !== 'saved' && (
              <section className="suggest" aria-label={tab}>
                {people.length === 0 && <p className="fine">{tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>}
                <ul>
                  {people.map((p) => (
                    <li key={p.id}>
                      <Avatar name={p.fullName} src={p.avatarUrl} size={40} />
                      <Link to={`/u/${p.username}`} className="plain who">
                        <strong>{p.fullName}</strong>
                        <span>@{p.username}</span>
                      </Link>
                      <PersonAction person={p} onChange={afterFollowChange} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      {reporting && <ReportDialog targetType="user" targetId={profile.id} onClose={() => setReporting(false)} />}
      {openPost && (
        <PostModal onClose={() => setOpenId(null)}>
          <PostCard
            post={openPost}
            startOpen
            onChange={(n) => setPosts((ps) => ps.map((x) => (x.id === n.id ? n : x)))}
            onDelete={(id) => {
              setPosts((ps) => ps.filter((x) => x.id !== id));
              setOpenId(null);
              void loadProfile();
              void refreshUser();
            }}
          />
        </PostModal>
      )}
    </div>
  );
}

/** Hides the button on the signed-in user's own row. */
function PersonAction({ person, onChange }) {
  const { user } = useAuth();
  if (user?.id === person.id) return <span className="fine">You</span>;
  return <FollowButton userId={person.id} username={person.username} following={person.following} followsYou={person.followsYou} onChange={onChange} />;
}
