import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { BookmarkIcon, CommentIcon, HeartIcon, MuteIcon, ShareIcon } from '../components/Icons';
import { Topbar } from '../components/Topbar';
import { api } from '../lib/api';
import { ShareDialog } from '../components/ShareDialog';

function Reel({ post, muted, onMute, onChange }) {
  const box = useRef(null);
  const video = useRef(null);
  const [note, setNote] = useState('');
  const [sharing, setSharing] = useState(false);

  // Play only the reel that is mostly on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const v = video.current;
        if (!v) return;
        if (e.isIntersecting) void v.play().catch(() => {});
        else {
          v.pause();
          v.currentTime = 0;
        }
      },
      { threshold: 0.65 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const flash = (m) => {
    setNote(m);
    setTimeout(() => setNote(''), 1800);
  };
  const like = async () => {
    const liked = !post.liked;
    onChange({ ...post, liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) });
    try {
      const r = await api(`/posts/${post.id}/like`, { method: liked ? 'PUT' : 'DELETE' });
      onChange({ ...post, liked: r.liked, likeCount: r.likeCount });
    } catch {
      onChange(post);
    }
  };
  const save = async () => {
    const saved = !post.saved;
    onChange({ ...post, saved });
    try {
      await api(`/posts/${post.id}/save`, { method: saved ? 'PUT' : 'DELETE' });
      flash(saved ? 'Saved' : 'Removed');
    } catch {
      onChange(post);
    }
  };
  const share = () => setSharing(true);

  return (
    <article className="reel" ref={box}>
      <video ref={video} src={post.mediaUrl} loop muted={muted} playsInline preload="metadata" onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())} />
      <div className="reel-info">
        <Link to={`/u/${post.author.username}`} className="reel-author">
          <Avatar name={post.author.fullName} src={post.author.avatarUrl} size={36} />
          <strong>{post.author.username}</strong>
        </Link>
        {post.caption && <p>{post.caption}</p>}
      </div>
      <div className="reel-actions">
        <button type="button" className={post.liked ? 'on' : ''} onClick={like} aria-pressed={post.liked} aria-label="Like">
          <HeartIcon filled={post.liked} />
          <span>{post.likeCount}</span>
        </button>
        <Link to={`/post/${post.id}`} aria-label="Comments">
          <CommentIcon />
          <span>{post.commentCount}</span>
        </Link>
        <button type="button" onClick={share} aria-label="Share">
          <ShareIcon />
          <span>{post.shareCount}</span>
        </button>
        <button type="button" className={post.saved ? 'on-brand' : ''} onClick={save} aria-pressed={post.saved} aria-label="Save">
          <BookmarkIcon filled={post.saved} />
        </button>
        <button type="button" onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          <MuteIcon filled={muted} />
        </button>
      </div>
      {sharing && <ShareDialog post={post} onClose={() => setSharing(false)} onCounted={(n) => onChange({ ...post, shareCount: n })} />}
      {note && (
        <span className="reel-note" role="status">
          {note}
        </span>
      )}
    </article>
  );
}

export function Reels() {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState('loading');
  const [muted, setMuted] = useState(true); // browsers only autoplay muted video
  const more = useRef(false);

  const load = useCallback(async (before) => {
    if (more.current) return;
    more.current = true;
    try {
      const page = await api(`/posts/reels${before ? `?before=${before}` : ''}`);
      setPosts((p) => (before ? [...p, ...page.posts] : page.posts));
      setCursor(page.nextCursor);
      setState('ready');
    } catch {
      setState((s) => (s === 'loading' ? 'error' : s));
    } finally {
      more.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app reels-app">
      <Topbar />
      <main
        className="reels"
        aria-label="Reels"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (cursor && el.scrollTop + el.clientHeight * 2 > el.scrollHeight) void load(cursor);
        }}
      >
        {state === 'loading' && (
          <p className="fine center" role="status">
            Loading reels…
          </p>
        )}
        {state === 'error' && (
          <div className="empty">
            <h2>Couldn’t load reels</h2>
            <p>Check your connection and try again.</p>
          </div>
        )}
        {state === 'ready' && posts.length === 0 && (
          <div className="empty">
            <h2>No reels yet</h2>
            <p>Share a video from Home and pick “Reel” to be the first.</p>
          </div>
        )}
        {posts.map((p) => (
          <Reel key={p.id} post={p} muted={muted} onMute={() => setMuted((m) => !m)} onChange={(n) => setPosts((ps) => ps.map((x) => (x.id === n.id ? n : x)))} />
        ))}
      </main>
    </div>
  );
}
