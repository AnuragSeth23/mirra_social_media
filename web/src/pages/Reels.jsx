import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { BackButton } from '../components/BackButton';
import { BookmarkIcon, CommentIcon, HeartIcon, MuteIcon, ShareIcon } from '../components/Icons';
import { Topbar } from '../components/Topbar';
import { api } from '../lib/api';
import { useDoubleClickRefresh } from '../lib/doubleClickRefresh';
import { ShareDialog } from '../components/ShareDialog';

const DEFAULT_PHOTO_MS = 5000;
// The reel frame takes the shape of its first photo or video (never cropped), so the name and buttons sit ON the picture, not on black bars.
// Very tall or very wide shapes are limited so the frame stays usable; the picture is then shown whole inside it.
const ratioOf = (w, h) => (w && h ? Math.min(1.78, Math.max(0.3, w / h)) : null);

function Reel({ post, muted, onMute, onChange }) {
  const box = useRef(null);
  const video = useRef(null);
  const [note, setNote] = useState('');
  const [sharing, setSharing] = useState(false);
  // A reel is one or more photos/videos played one after another (older reels have just the one).
  const items = post.items?.length ? post.items : [{ mediaUrl: post.mediaUrl, mediaType: post.mediaType, durationMs: null }];
  const many = items.length > 1;
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(false); // this reel is the one mostly on screen
  const [paused, setPaused] = useState(false);
  const [videoPct, setVideoPct] = useState(0);
  const [ratio, setRatio] = useState(null); // width / height of the first item
  const item = items[Math.min(index, items.length - 1)];
  const next = useCallback(() => setIndex((i) => (i + 1) % items.length), [items.length]);
  // The first item decides the frame's shape. The size is read from the element BEFORE this is called: React clears
  // event.currentTarget once the handler returns, so it must never be read inside a state-update function.
  const keepShape = (shape) => setRatio((current) => current ?? shape);

  // Only the reel that is mostly on screen plays; when it leaves the screen it starts again from its first item.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setActive(e.isIntersecting);
        if (!e.isIntersecting) {
          setIndex(0);
          setPaused(false);
          setVideoPct(0);
        }
      },
      { threshold: 0.65 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A photo moves on after its time (5 s unless the author chose another); a video moves on when it ends.
  useEffect(() => {
    if (!active || paused || item.mediaType !== 'image') return;
    const t = setTimeout(next, item.durationMs ?? DEFAULT_PHOTO_MS);
    return () => clearTimeout(t);
  }, [active, paused, index, item.mediaType, item.durationMs, next]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active && !paused) void v.play().catch(() => {});
    else {
      v.pause();
      if (!active) v.currentTime = 0;
    }
  }, [active, paused, index]);

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
    <article className="reel" ref={box} style={ratio ? { aspectRatio: String(ratio), width: 'auto', maxWidth: 'min(480px, 100%)' } : undefined}>
      <div className="reel-back">
        <BackButton label="Back" />
      </div>
      {many && (
        <div className="reel-bars" aria-hidden>
          {items.map((it, i) => (
            <i key={i} className={i < index ? 'done' : ''}>
              {i === index &&
                (it.mediaType === 'video' ? (
                  <b style={{ width: `${videoPct * 100}%` }} />
                ) : (
                  <b className="run" style={{ animationDuration: `${it.durationMs ?? DEFAULT_PHOTO_MS}ms`, animationPlayState: paused || !active ? 'paused' : 'running' }} />
                ))}
            </i>
          ))}
        </div>
      )}
      {item.mediaType === 'video' ? (
        <video
          key={index}
          ref={video}
          src={item.mediaUrl}
          loop={!many}
          muted={muted}
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => keepShape(ratioOf(e.currentTarget.videoWidth, e.currentTarget.videoHeight))}
          onEnded={many ? next : undefined}
          onTimeUpdate={many ? (e) => setVideoPct(e.currentTarget.currentTime / (e.currentTarget.duration || 1)) : undefined}
          onClick={() => setPaused((p) => !p)}
        />
      ) : (
        <img
          key={index}
          className="reel-photo"
          src={item.mediaUrl}
          alt={post.caption ? post.caption.slice(0, 120) : `Photo by ${post.author.fullName}`}
          onLoad={(e) => keepShape(ratioOf(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
          onClick={() => setPaused((p) => !p)}
        />
      )}
      <div className="reel-info">
        <Link to={`/u/${post.author.username}`} className="reel-author">
          <Avatar name={post.author.fullName} src={post.author.avatarUrl} size={36} />
          <strong>{post.author.username}</strong>
        </Link>
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
  useDoubleClickRefresh(); // double-click on a reel (outside its buttons) reloads the reels
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
