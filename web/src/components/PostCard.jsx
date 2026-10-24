import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { timeAgo } from '../lib/time';
import { Avatar } from './Avatar';
import { Caption } from './Caption';
import { BookmarkIcon, CommentIcon, HeartIcon, MoreIcon, ShareIcon } from './Icons';
import { ReportDialog } from './ReportDialog';
import { ShareDialog } from './ShareDialog';
import { Button } from './ui';

export function PostCard({ post, onChange, onDelete, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [comments, setComments] = useState(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption);
  const [reporting, setReporting] = useState(null);
  const menuBox = useRef(null);

  // Handlers run after awaits, so they must start from the newest post, not the one from when they were created.
  const latest = useRef(post);
  latest.current = post;
  const update = (patch) => onChange({ ...latest.current, ...patch });

  const flash = (m) => {
    setNote(m);
    setTimeout(() => setNote(''), 2200);
  };
  const fail = (e) => flash(e instanceof ApiError ? e.message : 'Something went wrong.');

  useEffect(() => {
    setComments(null);
    setOpen(startOpen);
    setEditing(false);
    setCaption(post.caption);
  }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Comments load the first time the thread is open.
  useEffect(() => {
    if (open && !comments) api(`/posts/${post.id}/comments`).then(setComments).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post.id]);

  useEffect(() => {
    if (!menu) return;
    const away = (e) => {
      if (!menuBox.current?.contains(e.target)) setMenu(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);

  const toggleLike = async () => {
    const before = latest.current;
    const liked = !before.liked; // optimistic; the server's numbers win when they arrive
    update({ liked, likeCount: Math.max(0, before.likeCount + (liked ? 1 : -1)) });
    try {
      const r = await api(`/posts/${post.id}/like`, { method: liked ? 'PUT' : 'DELETE' });
      update({ liked: r.liked, likeCount: r.likeCount });
    } catch (e) {
      update({ liked: before.liked, likeCount: before.likeCount });
      fail(e);
    }
  };

  const toggleSave = async () => {
    const saved = !latest.current.saved;
    update({ saved });
    try {
      await api(`/posts/${post.id}/save`, { method: saved ? 'PUT' : 'DELETE' });
      flash(saved ? 'Saved' : 'Removed from saved');
    } catch (e) {
      update({ saved: !saved });
      fail(e);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      const c = await api(`/posts/${post.id}/comments`, { method: 'POST', body: { body: draft, parentId: replyTo?.id } });
      setComments((cs) => (replyTo ? (cs ?? []).map((x) => (x.id === replyTo.id ? { ...x, replies: [...x.replies, c] } : x)) : [...(cs ?? []), c]));
      setDraft('');
      setReplyTo(null);
      update({ commentCount: latest.current.commentCount + 1 });
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (c, parent) => {
    if (!confirm(c.replies.length ? 'Delete this comment and its replies?' : 'Delete this comment?')) return;
    try {
      await api(`/posts/${post.id}/comments/${c.id}`, { method: 'DELETE' });
      setComments((cs) => (parent ? (cs ?? []).map((x) => (x.id === parent.id ? { ...x, replies: x.replies.filter((r) => r.id !== c.id) } : x)) : (cs ?? []).filter((x) => x.id !== c.id)));
      update({ commentCount: Math.max(0, latest.current.commentCount - 1 - (parent ? 0 : c.replies.length)) });
    } catch (err) {
      fail(err);
    }
  };

  const share = () => setSharing(true); // opens the Share pop-up (copy link, other apps, send to a friend)

  const saveCaption = async () => {
    try {
      onChange(await api(`/posts/${post.id}`, { method: 'PATCH', body: { caption } }));
      setEditing(false);
    } catch (e) {
      fail(e);
    }
  };

  const remove = async () => {
    setMenu(false);
    if (!confirm('Delete this post?')) return;
    try {
      await api(`/posts/${post.id}`, { method: 'DELETE' });
      onDelete(post.id);
    } catch (e) {
      fail(e);
    }
  };

  const CommentRow = ({ c, parent }) => (
    <li key={c.id}>
      <div className="comment-line">
        <Avatar name={c.author.fullName} src={c.author.avatarUrl} size={28} />
        <div>
          <p>
            <Link to={`/u/${c.author.username}`} className="plain">
              <strong>{c.author.username}</strong>
            </Link>{' '}
            {c.body}
          </p>
          <span className="fine">
            {timeAgo(c.createdAt)}
            <>
              {' '}
              ·{' '}
              <button
                type="button"
                className="link-btn quiet-danger"
                onClick={() => {
                  setReplyTo(parent ?? c);
                  setDraft((d) => d || `@${c.author.username} `);
                }}
              >
                Reply
              </button>
            </>
            {c.canDelete && (
              <>
                {' '}
                ·{' '}
                <button type="button" className="link-btn quiet-danger" onClick={() => removeComment(c, parent)}>
                  Delete
                </button>
              </>
            )}
            {!c.mine && (
              <>
                {' '}
                ·{' '}
                <button type="button" className="link-btn quiet-danger" onClick={() => setReporting({ type: 'comment', id: c.id })}>
                  Report
                </button>
              </>
            )}
          </span>
        </div>
      </div>
      {c.replies.length > 0 && (
        <ul className="replies">
          {c.replies.map((r) => (
            <CommentRow key={r.id} c={r} parent={c} />
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <article className="post">
      <header className="post-head">
        <Avatar name={post.author.fullName} src={post.author.avatarUrl} />
        <div className="post-who">
          <Link to={`/u/${post.author.username}`} className="plain">
            <strong>{post.author.fullName}</strong>
          </Link>
          <span>
            @{post.author.username} ·{' '}
            <Link to={`/post/${post.id}`} className="plain">
              {timeAgo(post.createdAt)}
            </Link>
            {post.kind === 'reel' && ' · Reel'}
          </span>
        </div>
        <div className="menu-wrap" ref={menuBox}>
          <button type="button" className="icon-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="More options">
            <MoreIcon />
          </button>
          {menu && (
            <div className="menu" role="menu">
              {post.mine ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setCaption(post.caption);
                      setEditing(true);
                    }}
                  >
                    Edit caption
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={remove}>
                    Delete
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setReporting({ type: 'post', id: post.id });
                  }}
                >
                  Report
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  void navigator.clipboard.writeText(`${location.origin}/post/${post.id}`).then(() => flash('Link copied'));
                }}
              >
                Copy link
              </button>
            </div>
          )}
        </div>
      </header>

      {post.mediaUrl && post.mediaType === 'video' && <video className="post-img" src={post.mediaUrl} controls playsInline preload="metadata" />}
      {post.mediaUrl && post.mediaType === 'image' && (
        <img className="post-img" src={post.mediaUrl} alt={post.caption ? `Photo: ${post.caption.slice(0, 80)}` : `Photo by ${post.author.fullName}`} loading="lazy" />
      )}

      {editing ? (
        <div className="edit-caption">
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={3} aria-label="Edit caption" autoFocus />
          <div className="row">
            <Button onClick={saveCaption}>Save</Button>
            <Button variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : post.caption ? (
        <Caption text={post.caption} className="post-caption" />
      ) : null}

      <div className="post-actions">
        <button type="button" className={`act ${post.liked ? 'on' : ''}`} onClick={toggleLike} aria-pressed={post.liked} aria-label={post.liked ? 'Unlike' : 'Like'}>
          <HeartIcon filled={post.liked} />
          <span>{post.likeCount}</span>
        </button>
        <button type="button" className="act" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Comments">
          <CommentIcon />
          <span>{post.commentCount}</span>
        </button>
        <button type="button" className="act" onClick={share} aria-label="Share">
          <ShareIcon />
          <span>{post.shareCount}</span>
        </button>
        {note && (
          <span className="act-note" role="status">
            {note}
          </span>
        )}
        <button type="button" className={`act save ${post.saved ? 'on-brand' : ''}`} onClick={toggleSave} aria-pressed={post.saved} aria-label={post.saved ? 'Unsave' : 'Save'}>
          <BookmarkIcon filled={post.saved} />
        </button>
      </div>

      {open && (
        <div className="comments">
          {comments?.length === 0 && <p className="fine">No comments yet. Be the first.</p>}
          <ul>
            {comments?.map((c) => (
              <CommentRow key={c.id} c={c} />
            ))}
          </ul>
          {replyTo && (
            <p className="fine replying">
              Replying to @{replyTo.author.username}{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setReplyTo(null);
                  setDraft('');
                }}
                aria-label="Cancel reply"
              >
                ✕
              </button>
            </p>
          )}
          <form className="comment-form" onSubmit={send}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2200} placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'} aria-label="Add a comment" />
            <button type="submit" className="link-btn" disabled={sending || !draft.trim()}>
              Post
            </button>
          </form>
        </div>
      )}
      {sharing && <ShareDialog post={post} onClose={() => setSharing(false)} onCounted={(n) => update({ shareCount: n })} />}
      {reporting && <ReportDialog targetType={reporting.type} targetId={reporting.id} onClose={() => setReporting(null)} />}
    </article>
  );
}
