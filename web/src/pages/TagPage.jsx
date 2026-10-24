import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { VideoIcon } from '../components/Icons';
import { Topbar } from '../components/Topbar';
import { Button } from '../components/ui';
import { api } from '../lib/api';

/** Posts that use one hashtag, newest first. */
export function TagPage() {
  const { tag = '' } = useParams();
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState('loading');
  const [more, setMore] = useState(false);

  const load = async (before) => {
    const page = await api(`/posts/tag/${encodeURIComponent(tag)}${before ? `?before=${before}` : ''}`);
    setPosts((p) => (before ? [...p, ...page.posts] : page.posts));
    setCursor(page.nextCursor);
  };
  useEffect(() => {
    setState('loading');
    setPosts([]);
    load()
      .then(() => setState('ready'))
      .catch(() => setState('error'));
  }, [tag]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Topbar />
      <main className="app-main">
        <h1 className="section-title big">#{tag}</h1>
        {state === 'loading' && (
          <p className="fine center" role="status">
            Loading…
          </p>
        )}
        {state === 'error' && (
          <div className="empty">
            <h2>Couldn’t load this tag</h2>
            <p>Check your connection and try again.</p>
          </div>
        )}
        {state === 'ready' && posts.length === 0 && (
          <div className="empty">
            <h2>No posts with #{tag} yet</h2>
            <p>Add #{tag} to a caption to start it.</p>
          </div>
        )}
        <div className="grid">
          {posts.map((p) => (
            <Link key={p.id} to={`/post/${p.id}`} className="tile" aria-label={p.caption || `Post by ${p.author.username}`}>
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
            </Link>
          ))}
        </div>
        {cursor && (
          <Button
            variant="quiet"
            busy={more}
            onClick={async () => {
              setMore(true);
              await load(cursor).catch(() => {});
              setMore(false);
            }}
          >
            Load more
          </Button>
        )}
      </main>
    </div>
  );
}
