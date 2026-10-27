import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { BackButton } from '../components/BackButton';
import { useCall } from '../components/CallProvider';
import { PhoneIcon, VideoIcon } from '../components/Icons';
import { Linkify } from '../components/Linkify';
import { Topbar } from '../components/Topbar';
import { api, ApiError, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, uploadMedia } from '../lib/api';
import { timeAgo } from '../lib/time';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm';

/** A post or reel someone sent: a small card that opens the post. If this reader may not see it, a plain note instead. */
function SharedPost({ post }) {
  if (post.unavailable) return <div className="share-card gone">This post is no longer available.</div>;
  return (
    <Link to={`/post/${post.id}`} className="share-card plain">
      {post.mediaUrl && (post.mediaType === 'video' ? <video src={post.mediaUrl} muted playsInline preload="metadata" /> : <img src={post.mediaUrl} alt="" loading="lazy" />)}
      <div>
        <strong>@{post.author.username}</strong>
        {post.kind === 'reel' && ' · Reel'}
        {post.caption && <p>{post.caption}</p>}
      </div>
    </Link>
  );
}

/** A finished call, shown in the thread like a message. */
function CallCard({ call }) {
  if (call.unavailable) return <div className="call-card">Call</div>;
  const what = call.kind === 'video' ? 'video call' : 'voice call';
  const m = Math.floor(call.seconds / 60);
  const text =
    call.outcome === 'completed' ? `${call.kind === 'video' ? 'Video' : 'Voice'} call · ${m}:${String(call.seconds % 60).padStart(2, '0')}` : call.outcome === 'declined' ? `Declined ${what}` : call.outcome === 'missed' ? `Missed ${what}` : `Cancelled ${what}`;
  return (
    <div className={`call-card${call.outcome === 'missed' || call.outcome === 'declined' ? ' bad' : ''}`}>
      {call.kind === 'video' ? <VideoIcon /> : <PhoneIcon />}
      {text}
    </div>
  );
}

/** One conversation. New messages are fetched every 4 s while the tab is open. */
export function Chat() {
  const { id } = useParams();
  const { startCall, busy } = useCall();
  const navigate = useNavigate();
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [request, setRequest] = useState({ incoming: false, outgoing: false });
  const [canSend, setCanSend] = useState(true);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [sending, setSending] = useState(false);
  const end = useRef(null);
  const count = useRef(0);
  const sentAt = useRef(0);
  const picker = useRef(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return Promise.resolve(); // reading happens only when you can actually see the chat
      const started = Date.now();
      return api(`/messages/${id}`)
        .then((t) => {
          if (!live || sentAt.current > started) return;
          setPeer(t.peer);
          setRequest(t.request);
          setCanSend(t.canSend);
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

  // A local preview of the chosen photo/video, released when it is replaced or sent.
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires
    if (!f) return;
    setError('');
    const video = f.type.startsWith('video/');
    if (!ACCEPT.split(',').includes(f.type)) return setError('Choose a JPG, PNG, WebP or GIF photo, or an MP4 or WebM video.');
    if (f.size > (video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) return setError(video ? 'Videos can be up to 50 MB.' : 'Photos can be up to 5 MB.');
    setFile(f);
  }

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body && !file) return;
    setSending(true);
    setError('');
    try {
      const media = file ? await uploadMedia(file) : undefined;
      const m = await api(`/messages/${id}`, { method: 'POST', body: { ...(body ? { body } : {}), ...(media ? { mediaKey: media.key } : {}) } });
      sentAt.current = Date.now();
      setMessages((ms) => [...ms, m]);
      setDraft('');
      setFile(null);
      if (request.outgoing) setCanSend(false); // the one allowed message of a request has been sent
    } catch (err) {
      if (err instanceof ApiError && err.code === 'request_pending') setCanSend(false);
      else setError(err instanceof ApiError ? err.message : 'Could not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  async function call(kind) {
    setError('');
    try {
      await startCall(id, kind);
    } catch (err) {
      setError(err.message || 'Could not start the call.');
    }
  }

  async function acceptRequest() {
    setError('');
    try {
      await api(`/messages/${id}/accept`, { method: 'POST' });
      setRequest((r) => ({ ...r, incoming: false }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept. Try again.');
    }
  }
  async function declineRequest() {
    setError('');
    try {
      await api(`/messages/${id}/decline`, { method: 'POST' });
      navigate('/messages', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not decline. Try again.');
    }
  }

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
          <BackButton to="/messages" label="Back to messages" />
          {peer && (
            <>
              <Avatar name={peer.fullName} src={peer.avatarUrl} size={40} />
              <Link to={`/u/${peer.username}`} className="plain who">
                <strong>{peer.fullName}</strong>
                <span>@{peer.username}</span>
              </Link>
              <div className="call-btns">
                <button type="button" className="call-btn" onClick={() => call('voice')} disabled={busy || request.incoming || request.outgoing} aria-label="Start a voice call" title="Voice call">
                  <PhoneIcon />
                </button>
                <button type="button" className="call-btn" onClick={() => call('video')} disabled={busy || request.incoming || request.outgoing} aria-label="Start a video call" title="Video call">
                  <VideoIcon />
                </button>
              </div>
            </>
          )}
        </header>
        <div className="bubbles" aria-live="polite">
          {messages.length === 0 && <p className="fine center">Say hello 👋</p>}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.mine ? 'mine' : 'theirs'} ${m.media || m.sharedPost ? 'has-media' : ''}`}>
              {m.media && (m.media.type === 'video' ? <video className="msg-media" src={m.media.url} controls playsInline preload="metadata" /> : <img className="msg-media" src={m.media.url} alt="Photo" loading="lazy" />)}
              {m.sharedPost && <SharedPost post={m.sharedPost} />}
              {m.call && <CallCard call={m.call} />}
              {m.body && (
                <p>
                  <Linkify text={m.body} />
                </p>
              )}
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
        {request.incoming && (
          <div className="request-note" role="status">
            <p>
              <strong>{peer?.fullName ?? 'Someone'}</strong> isn’t your friend yet. Accept to move this chat to your inbox, or decline to hide it. Replying also accepts.
            </p>
            <div className="row">
              <button type="button" className="btn btn-primary btn-sm" onClick={acceptRequest}>
                Accept
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={declineRequest}>
                Decline
              </button>
            </div>
          </div>
        )}
        {!canSend ? (
          <p className="request-note" role="status">
            Message request sent. {peer?.fullName ?? 'They'} hasn’t accepted it yet, so you can send more once they do.
          </p>
        ) : (
          <>
            {file && (
              <div className="attach-preview">
                {file.type.startsWith('video/') ? <video src={preview ?? undefined} muted playsInline /> : <img src={preview ?? undefined} alt="" />}
                <span>{file.name}</span>
                <button type="button" className="link-btn" onClick={() => setFile(null)} aria-label="Remove the attachment">
                  Remove
                </button>
              </div>
            )}
            <form className="chat-form" onSubmit={send}>
              <button type="button" className="attach" onClick={() => picker.current?.click()} aria-label="Attach a photo or video" title="Attach a photo or video" disabled={sending}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="m21 16-5-5-8 8" />
                </svg>
              </button>
              <input ref={picker} type="file" accept={ACCEPT} hidden onChange={pick} aria-label="Choose a photo or video" />
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} placeholder={file ? 'Add a caption…' : 'Message…'} aria-label="Message" autoFocus />
              <button type="submit" className="btn btn-primary btn-sm" disabled={sending || (!draft.trim() && !file)}>
                {sending ? 'Sending' : 'Send'}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
