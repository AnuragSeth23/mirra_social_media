import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Avatar } from './Avatar';
import { CheckIcon, LinkIcon, MailIcon, SearchIcon, ShareIcon } from './Icons';
import { PostModal } from './PostModal';

// Outside services open their own page in a new tab with the link filled in.
const TARGETS = (url, text) => [
  { key: 'whatsapp', label: 'WhatsApp', color: '#25d366', letter: 'W', href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
  { key: 'facebook', label: 'Facebook', color: '#1877f2', letter: 'f', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  { key: 'x', label: 'X', color: '#111111', letter: 'X', href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
  { key: 'telegram', label: 'Telegram', color: '#27a7e7', letter: 'T', href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
  { key: 'email', label: 'Email', color: '#7b5cff', icon: <MailIcon />, href: `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}` },
];

/**
 * The Share pop-up. Copy the link (with a visible "Copied" answer), open WhatsApp / Facebook / X / Telegram / email,
 * use the phone's own share sheet, or send the post to a friend inside SocialAmbak. The share counter goes up once per
 * pop-up, the first time something is actually shared.
 */
export function ShareDialog({ post, onClose, onCounted }) {
  const url = `${location.origin}/post/${post.id}`;
  const text = post.caption ? `${post.author.fullName} on SocialAmbak: ${post.caption.slice(0, 80)}` : `A post by ${post.author.fullName} on SocialAmbak`;
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState({});
  const [error, setError] = useState('');
  const counted = useRef(false);
  const field = useRef(null);
  const canNative = typeof navigator.share === 'function' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  // The people you already chat with come first; typing searches everyone.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const q = query.trim();
      const job = q
        ? api(`/users/search?q=${encodeURIComponent(q)}`)
        : api('/messages').then(async (chats) => (chats.length ? chats.map((c) => ({ ...c.peer })) : api('/users/suggestions')));
      job.then((r) => live && setPeople(r.slice(0, 8))).catch(() => {});
    }, query ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  async function count() {
    if (counted.current) return;
    counted.current = true;
    try { onCounted?.((await api(`/posts/${post.id}/share`, { method: 'POST' })).shareCount); } catch { counted.current = false; }
  }

  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      void count();
    } catch {
      // Clipboard blocked (some browsers, some settings): select the link so Ctrl+C works.
      setManual(true);
      field.current?.focus();
      field.current?.select();
    }
  }

  async function nativeShare() {
    try { await navigator.share({ title: text, url }); void count(); } catch { /* closed without sharing */ }
  }

  async function sendTo(person) {
    setError('');
    try {
      const { id } = await api(`/messages/with/${person.id}`, { method: 'POST' });
      await api(`/messages/${id}`, { method: 'POST', body: { body: `${text}\n${url}` } });
      setSent((s) => ({ ...s, [person.id]: true }));
      void count();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send. Try again.');
    }
  }

  return (
    <PostModal onClose={onClose} label="Share">
      <div className="share-dialog">
        <h2><ShareIcon /> Share this post</h2>

        <div className="share-link">
          <input ref={field} readOnly value={url} aria-label="Post link" onFocus={(e) => e.target.select()} />
          <button type="button" className={`btn btn-primary btn-sm ${copied ? 'is-done' : ''}`} onClick={copy}>
            {copied ? <><CheckIcon /> Copied</> : <><LinkIcon /> Copy link</>}
          </button>
        </div>
        {copied && <p className="notice" role="status">Link copied. Paste it anywhere.</p>}
        {manual && <p className="fine" role="status">Your browser blocked automatic copying. The link is selected: press Ctrl+C.</p>}

        <div className="share-targets" role="group" aria-label="Share on another app">
          {TARGETS(url, text).map((t) => (
            <a key={t.key} className="share-target" href={t.href} target="_blank" rel="noopener noreferrer" onClick={() => void count()}>
              <span className="share-badge" style={{ background: t.color }} aria-hidden>{t.icon ?? t.letter}</span>
              <span>{t.label}</span>
            </a>
          ))}
          {canNative && (
            <button type="button" className="share-target" onClick={nativeShare}>
              <span className="share-badge" style={{ background: 'var(--brand)' }} aria-hidden><ShareIcon /></span>
              <span>More…</span>
            </button>
          )}
        </div>

        <h3>Send to a friend on SocialAmbak</h3>
        <label className="searchbox slim"><SearchIcon /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a name or username" aria-label="Find a friend to send this to" /></label>
        {error && <p className="field-msg error" role="alert">{error}</p>}
        <ul className="people full">
          {people.length === 0 && <li className="fine">{query ? 'No one found.' : 'Search for someone above.'}</li>}
          {people.map((p) => (
            <li key={p.id}>
              <Avatar name={p.fullName} src={p.avatarUrl} size={36} />
              <div className="who"><strong>{p.fullName}</strong><span>@{p.username}</span></div>
              <button type="button" className={`btn btn-sm ${sent[p.id] ? 'btn-quiet' : 'btn-primary'}`} onClick={() => sendTo(p)} disabled={!!sent[p.id]}>
                {sent[p.id] ? 'Sent ✓' : 'Send'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </PostModal>
  );
}
