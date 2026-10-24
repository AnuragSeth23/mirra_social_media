import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/time';
import { Avatar } from './Avatar';
import { CloseIcon } from './Icons';

const IMAGE_MS = 5000;

/** Full-screen story player. Tap right/left (or use arrow keys) to move, Esc to close. Images last 5 s; videos play to the end. */
export function StoryViewer({ groups, start, onClose, onDeleted }) {
  const [g, setG] = useState(start);
  const [i, setI] = useState(0);
  const [progress, setProgress] = useState(0);
  const video = useRef(null);
  const group = groups[g];
  const item = group.items[i];

  const next = () => {
    if (i < group.items.length - 1) {
      setI(i + 1);
      setProgress(0);
    } else if (g < groups.length - 1) {
      setG(g + 1);
      setI(0);
      setProgress(0);
    } else onClose();
  };
  const prev = () => {
    if (i > 0) {
      setI(i - 1);
      setProgress(0);
    } else if (g > 0) {
      setG(g - 1);
      setI(0);
      setProgress(0);
    }
  };

  // Mark seen once it appears (never for your own story).
  useEffect(() => {
    if (!group.mine && !item.viewed) void api(`/stories/${item.id}/view`, { method: 'POST' }).catch(() => {});
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Images advance on a timer; videos advance when they end.
  useEffect(() => {
    if (item.mediaType !== 'image') return;
    const t0 = Date.now();
    const t = setInterval(() => {
      const p = (Date.now() - t0) / IMAGE_MS;
      if (p >= 1) {
        clearInterval(t);
        next();
      } else setProgress(p);
    }, 60);
    return () => clearInterval(t);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const remove = async () => {
    if (!confirm('Delete this story?')) return;
    await api(`/stories/${item.id}`, { method: 'DELETE' }).catch(() => {});
    onDeleted();
    onClose();
  };

  return (
    <div className="story-view" role="dialog" aria-modal="true" aria-label={`${group.author.username}’s story`}>
      <div className="story-bars">
        {group.items.map((it, n) => (
          <span key={it.id}>
            <i style={{ width: n < i ? '100%' : n === i ? `${progress * 100}%` : '0%' }} />
          </span>
        ))}
      </div>
      <header className="story-head">
        <Avatar name={group.author.fullName} src={group.author.avatarUrl} size={36} />
        <strong>{group.mine ? 'Your story' : group.author.username}</strong>
        <span>{timeAgo(item.createdAt)}</span>
        {group.mine && (
          <span className="story-views">
            {item.viewCount} {item.viewCount === 1 ? 'view' : 'views'}
          </span>
        )}
        {group.mine && (
          <button type="button" className="link-btn" onClick={remove}>
            Delete
          </button>
        )}
        <button type="button" className="story-x" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="story-media">
        {item.mediaType === 'video' ? (
          <video key={item.id} ref={video} src={item.mediaUrl} autoPlay playsInline onEnded={next} onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))} />
        ) : (
          <img key={item.id} src={item.mediaUrl} alt={item.caption ?? 'Story'} />
        )}
        {item.caption && <p className="story-caption">{item.caption}</p>}
        <button type="button" className="story-hit left" onClick={prev} aria-label="Previous" />
        <button type="button" className="story-hit right" onClick={next} aria-label="Next" />
      </div>
    </div>
  );
}
