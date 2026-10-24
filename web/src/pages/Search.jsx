import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { FollowButton } from '../components/FollowButton';
import { CloseIcon, FlameIcon, SearchIcon, VideoIcon } from '../components/Icons';
import { Topbar } from '../components/Topbar';
import { Button } from '../components/ui';
import { api } from '../lib/api';

/**
 * Search and discover. A large rounded search bar, trending hashtags as chips, then results as cards
 * (people and hashtags). With nothing typed, the explore grid shows recent photos and videos from public accounts.
 */
export function Search() {
  const [text, setText] = useState('');
  const [people, setPeople] = useState(null);
  const [tags, setTags] = useState([]);
  const [trending, setTrending] = useState([]);
  const [grid, setGrid] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const box = useRef(null);

  const loadGrid = async (before) => {
    const page = await api(`/posts/explore${before ? `?before=${before}` : ''}`);
    setGrid((g) => (before ? [...g, ...page.posts] : page.posts));
    setCursor(page.nextCursor);
  };
  useEffect(() => {
    loadGrid().catch(() => {}).finally(() => setLoading(false));
    api('/posts/tags?q=').then(setTrending).catch(() => {});
  }, []);

  // Search 300 ms after the last keystroke; ignore answers for text that has since changed.
  useEffect(() => {
    const t = text.trim();
    if (!t) {
      setPeople(null);
      setTags([]);
      setBusy(false);
      return;
    }
    let live = true;
    setBusy(true);
    const h = setTimeout(() => {
      Promise.all([api(`/users/search?q=${encodeURIComponent(t)}`).catch(() => []), api(`/posts/tags?q=${encodeURIComponent(t)}`).catch(() => [])]).then(([p, g]) => {
        if (!live) return;
        setPeople(p);
        setTags(g);
        setBusy(false);
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [text]);

  const searching = text.trim().length > 0;

  return (
    <div className="app">
      <Topbar />
      <main className="app-main search-main">
        <header className="search-hero">
          <h1>Search</h1>
          <p>Find people, hashtags and things worth seeing.</p>
          <label className="searchbar">
            <SearchIcon />
            <input ref={box} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search people or #hashtags" aria-label="Search people" autoFocus />
            {text && (
              <button
                type="button"
                className="searchbar-clear"
                onClick={() => {
                  setText('');
                  box.current?.focus();
                }}
                aria-label="Clear search"
              >
                <CloseIcon />
              </button>
            )}
          </label>
          {!searching && trending.length > 0 && (
            <div className="chips" aria-label="Trending hashtags">
              <span className="chips-label">
                <FlameIcon /> Trending
              </span>
              {trending.map((t) => (
                <Link key={t.tag} to={`/tag/${encodeURIComponent(t.tag)}`} className="chip">
                  #{t.tag}
                </Link>
              ))}
            </div>
          )}
        </header>

        {searching ? (
          <section className="results" aria-label="Results" aria-busy={busy}>
            {busy && people === null && <p className="fine center" role="status">Searching…</p>}
            {tags.length > 0 && (
              <div className="result-group">
                <h2 className="section-title">Hashtags</h2>
                <ul className="tag-cards" aria-label="Hashtags">
                  {tags.map((t) => (
                    <li key={t.tag}>
                      <Link to={`/tag/${encodeURIComponent(t.tag)}`} className="tag-card plain">
                        <span className="tag-hash" aria-hidden>#</span>
                        <span>
                          <strong>#{t.tag}</strong>
                          <span className="fine">
                            {t.postCount} {t.postCount === 1 ? 'post' : 'posts'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {people && people.length > 0 && (
              <div className="result-group">
                <h2 className="section-title">People</h2>
                <ul className="person-cards">
                  {people.map((p) => (
                    <li key={p.id} className="person-card">
                      <Avatar name={p.fullName} src={p.avatarUrl} size={52} />
                      <Link to={`/u/${p.username}`} className="plain who">
                        <strong>{p.fullName}</strong>
                        <span>
                          @{p.username}
                          {p.followsYou && ' · follows you'}
                        </span>
                      </Link>
                      <FollowButton userId={p.id} username={p.username} following={p.following} followsYou={p.followsYou} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {people && people.length === 0 && tags.length === 0 && (
              <div className="empty">
                <h2>Nothing found</h2>
                <p>Nothing found for “{text.trim()}”. Check the spelling, or try a different name or hashtag.</p>
              </div>
            )}
          </section>
        ) : (
          <section aria-label="Explore">
            <h2 className="section-title">Explore</h2>
            {loading && <p className="fine center" role="status">Loading…</p>}
            {!loading && grid.length === 0 && (
              <div className="empty">
                <h2>Nothing to explore yet</h2>
                <p>Public photos and videos from other people will show up here.</p>
              </div>
            )}
            <div className="grid explore-grid">
              {grid.map((p) => (
                <Link key={p.id} to={`/post/${p.id}`} className="tile" aria-label={p.caption || `Post by ${p.author.username}`}>
                  {p.mediaType === 'video' ? <video src={`${p.mediaUrl}#t=0.1`} preload="metadata" muted playsInline /> : <img src={p.mediaUrl} alt="" loading="lazy" />}
                  {p.mediaType === 'video' && (
                    <span className="tile-badge">
                      <VideoIcon />
                    </span>
                  )}
                </Link>
              ))}
            </div>
            {cursor && (
              <Button
                variant="quiet"
                busy={more}
                onClick={async () => {
                  setMore(true);
                  await loadGrid(cursor).catch(() => {});
                  setMore(false);
                }}
              >
                Load more
              </Button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
