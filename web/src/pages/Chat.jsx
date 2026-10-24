import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Linkify } from '../components/Linkify';
import { Topbar } from '../components/Topbar';
import { api, ApiError } from '../lib/api';
import { timeAgo } from '../lib/time';

/** One conversation. New messages are fetched every 4 s while the tab is open. */
export function Chat() {
  const { id } = useParams();
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [sending, setSending] = useState(false);
  const end = useRef(null);
  const count = useRef(0);
  const sentAt = useRef(0);

  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return Promise.resolve(); // reading happens only when you can actually see the chat
      const started = Date.now();
      return api(`/messages/${id}`)
        .then((t) => {
          if (!live || sentAt.current > started) return;
          setPeer(t.peer);
          setMessages((m) => (m.length === t.messages.length && m.at(-1)?.id === t.messages.at(-1)?.id ? m : t.messages));
        })
        .catch((e) => {
          if (live && e instanceof ApiError && e.status === 404) setMissing(true);
        });
    };
    void load();
    const t = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (messages.length !== count.current) {
      end.current?.scrollIntoView({ behavior: count.current ? 'smooth' : 'auto' });
      count.current = messages.length;
    }
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError('');
    try {
      const m = await api(`/messages/${id}`, { method: 'POST', body: { body } });
      sentAt.current = Date.now();
      setMessages((ms) => [...ms, m]);
      setDraft('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  if (missing)
    return (
      <div className="app">
        <Topbar />
        <main className="app-main">
          <div className="empty">
            <h2>Conversation not found</h2>
            <Link to="/messages">Back to messages</Link>
          </div>
        </main>
      </div>
    );

  return (
    <div className="app chat-app">
      <Topbar />
      <main className="chat">
        <header className="chat-head">
          {peer && (
            <>
              <Avatar name={peer.fullName} src={peer.avatarUrl} size={40} />
              <Link to={`/u/${peer.username}`} className="plain who">
                <strong>{peer.fullName}</strong>
                <span>@{peer.username}</span>
              </Link>
            </>
          )}
        </header>
        <div className="bubbles" aria-live="polite">
          {messages.length === 0 && <p className="fine center">Say hello 👋</p>}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.mine ? 'mine' : 'theirs'}`}>
              <p><Linkify text={m.body} /></p>
              <span>{timeAgo(m.createdAt)}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
        {error && (
          <p className="field-msg error" role="alert">
            {error}
          </p>
        )}
        <form className="chat-form" onSubmit={send}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} placeholder="Message…" aria-label="Message" autoFocus />
          <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}
