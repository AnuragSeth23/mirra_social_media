import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Composer } from '../components/Composer';
import { PostCard } from '../components/PostCard';
import { PostModal } from '../components/PostModal';
import { StoriesBar } from '../components/StoriesBar';
import { Suggestions } from '../components/Suggestions';
import { Avatar } from '../components/Avatar';
import { Topbar } from '../components/Topbar';
import { useWide } from '../lib/useWide';
import { Button } from '../components/ui';
import { api, ApiError } from '../lib/api';

export function Home() {
  const { user, refreshUser } = useAuth();
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState('loading');
  const [more, setMore] = useState(false);
  // "Suggested for you": public posts from people I don't follow, shown once the posts from people I follow run out.
  const [suggested, setSuggested] = useState([]);
  const [dCursor, setDCursor] = useState(null);
  const [dState, setDState] = useState('idle');
  const [storyKey, setStoryKey] = useState(0);
  const [request, setRequest] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [composeOpen, setComposeOpen] = useState(false);
  const wide = useWide(1100); // wide screens: suggestions live in the right-hand column; narrower: inside the feed
  const ask = (kind) => {
    setRequest((r) => ({ kind, n: (r?.n ?? 0) + 1 }));
    setComposeOpen(true);
  };

  // The + Create button in the nav lands here with state.create set.
  useEffect(() => {
    if (location.state?.create) {
      ask('post');
      navigate('/', { replace: true, state: null });
    }
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDiscover = useCallback(async (before) => {
    setDState('loading');
    try {
      const page = await api(`/posts/discover${before ? `?before=${before}` : ''}`);
      setSuggested((p) => (before ? [...p, ...page.posts] : page.posts));
      setDCursor(page.nextCursor);
    } catch {
      /* suggestions are a bonus; the feed still works without them */
    } finally {
      setDState('done');
    }
  }, []);

  const load = useCallback(
    async (before) => {
      try {
        const page = await api(`/posts/feed${before ? `?before=${before}` : ''}`);
        setPosts((p) => (before ? [...p, ...page.posts] : page.posts));
        setCursor(page.nextCursor);
        setState('ready');
        if (!page.nextCursor) void loadDiscover(); // nothing (more) from people I follow: carry on with public posts
      } catch (e) {
        setState(before ? 'ready' : 'error');
        if (!(e instanceof ApiError)) throw e;
      }
    },
    [loadDiscover],
  );

  const reload = useCallback(() => {
    setSuggested([]);
    setDCursor(null);
    setDState('idle');
    void load();
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);

  if (!user) return null;
  const suggestions = (
    <Suggestions
      compact={!wide}
      onFollowChanged={() => {
        reload();
        void refreshUser();
      }}
    />
  );
  const swap = (p) => (list) => list.map((x) => (x.id === p.id ? p : x));
  const update = (p) => {
    setPosts(swap(p));
    setSuggested(swap(p));
  };
  const drop = (id) => {
    setPosts((ps) => ps.filter((x) => x.id !== id));
    setSuggested((ps) => ps.filter((x) => x.id !== id));
    void refreshUser();
  };

  return (
    <div className="app">
      <Topbar />
      <main className="app-main home-main">
        <div className="home-grid">
          <div className="home-feed">
            <StoriesBar me={user} reloadKey={storyKey} onAdd={() => ask('story')} />

            {!wide && suggestions}

            <section aria-label="Your feed" className="feed">
              {state === 'loading' && (
                <p className="fine center" role="status">
                  Loading your feed…
                </p>
              )}
              {state === 'error' && (
                <div className="empty">
                  <h2>Couldn’t load your feed</h2>
                  <p>Check your connection and try again.</p>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setState('loading');
                      void load();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {state === 'ready' && posts.length === 0 && dState === 'done' && suggested.length === 0 && (
                <div className="empty">
                  <h2>Your feed is quiet for now</h2>
                  <p>Tap + to share your first post, or follow people to see what they post.</p>
                </div>
              )}
              {posts.map((p) => (
                <PostCard key={p.id} post={p} onChange={update} onDelete={drop} />
              ))}
              {cursor && (
                <Button
                  variant="quiet"
                  busy={more}
                  onClick={async () => {
                    setMore(true);
                    await load(cursor);
                    setMore(false);
                  }}
                >
                  Load more
                </Button>
              )}

              {!cursor && suggested.length > 0 && (
                <>
                  <h2 className="section-title suggested-title">Suggested for you</h2>
                  <p className="fine suggested-note">
                    {posts.length === 0
                      ? 'Your feed is empty because you don’t follow anyone yet. Here are public posts to get you started: follow people to fill it with theirs.'
                      : 'Public posts from people you don’t follow yet.'}
                  </p>
                  {suggested.map((p) => (
                    <PostCard key={p.id} post={p} onChange={update} onDelete={drop} />
                  ))}
                  {dCursor && (
                    <Button variant="quiet" busy={dState === 'loading'} onClick={() => void loadDiscover(dCursor)}>
                      Load more
                    </Button>
                  )}
                </>
              )}
            </section>
          </div>

          {wide && (
            <aside className="rail" aria-label="Suggestions">
              <Link to={`/u/${user.username}`} className="rail-me plain">
                <Avatar name={user.fullName} src={user.avatarUrl} size={52} />
                <span className="who">
                  <strong>{user.username}</strong>
                  <span>{user.fullName}</span>
                </span>
              </Link>
              {suggestions}
              <p className="rail-foot">© {new Date().getFullYear()} SocialAmbak</p>
            </aside>
          )}
        </div>
      </main>
      {composeOpen && (
        <PostModal onClose={() => setComposeOpen(false)}>
          <Composer
            name={user.fullName}
            request={request}
            onDone={() => setComposeOpen(false)}
            onPosted={(p) => {
              setPosts((ps) => [p, ...ps]);
              void refreshUser();
            }}
            onStoryPosted={() => setStoryKey((k) => k + 1)}
          />
        </PostModal>
      )}
    </div>
  );
}
