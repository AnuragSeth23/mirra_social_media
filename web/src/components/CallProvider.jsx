import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { Avatar } from './Avatar';
import { MicIcon, PhoneIcon, PhoneOffIcon, VideoIcon, VideoOffIcon } from './Icons';

// Audio/video goes straight between the two browsers (WebRTC); the API only carries the handshake notes.
// shortcut: STUN only, no TURN relay, so two people behind strict NATs may not connect. Set VITE_ICE_SERVERS (JSON) to add a TURN server.
function iceServers() {
  try {
    return JSON.parse(import.meta.env.VITE_ICE_SERVERS);
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

const CallContext = createContext({ startCall: async () => {}, busy: false });
export const useCall = () => useContext(CallContext);

async function getMedia(kind) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls need a browser that supports them, on https or localhost.');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
  } catch (e) {
    const what = kind === 'video' ? 'microphone and camera' : 'microphone';
    throw new Error(e?.name === 'NotAllowedError' ? `Allow the ${what} in your browser to make calls.` : `Could not use your ${what}. Check that it is connected.`);
  }
}

const ENDED = { declined: 'Call declined.', missed: 'No answer.', cancelled: 'Call ended.', ended: 'Call ended.' };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Stream({ stream, ...props }) {
  return <video {...props} ref={(el) => el && el.srcObject !== stream && (el.srcObject = stream)} autoPlay playsInline />;
}

export function CallProvider({ children }) {
  const { status } = useAuth();
  const [incoming, setIncoming] = useState(null);
  const [active, setActive] = useState(null); // { call, connected, startedAt }
  const [streams, setStreams] = useState({ local: null, remote: null, tracks: 0 });
  const [flags, setFlags] = useState({ muted: false, camOff: false });
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(0);
  const session = useRef(null);
  const joining = useRef(false);

  const say = (text) => setNotice(text);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function finish(sess, message) {
    if (sess.done) return;
    sess.done = true;
    clearTimeout(sess.timer);
    sess.pc.close();
    sess.local.getTracks().forEach((t) => t.stop());
    if (session.current === sess) session.current = null;
    setActive(null);
    setStreams({ local: null, remote: null, tracks: 0 });
    setFlags({ muted: false, camOff: false });
    if (message) say(message);
  }

  const post = (sess, type, payload) => api(`/calls/${sess.id}/signal`, { method: 'POST', body: { type, payload } }).catch(() => {});

  async function handle(sess, sig) {
    try {
      if (sig.type === 'ice') {
        if (sess.ready) await sess.pc.addIceCandidate(sig.payload);
        else sess.queue.push(sig.payload);
        return;
      }
      await sess.pc.setRemoteDescription(sig.payload);
      sess.ready = true;
      for (const c of sess.queue.splice(0)) await sess.pc.addIceCandidate(c);
      if (sig.type === 'offer') {
        await sess.pc.setLocalDescription(await sess.pc.createAnswer());
        await post(sess, 'answer', sess.pc.localDescription.toJSON());
      }
    } catch {
      /* a single bad note is not worth ending the call; a dead connection is caught by connectionState */
    }
  }

  // Asking for the call every second also tells the server we are still here.
  async function tick(sess) {
    if (sess.done) return;
    try {
      const { call, signals } = await api(`/calls/${sess.id}?after=${sess.last}`);
      if (sess.done) return;
      for (const sig of signals) {
        sess.last = sig.id;
        await handle(sess, sig);
      }
      if (call.status !== 'ringing' && call.status !== 'active') return finish(sess, ENDED[call.status] ?? 'Call ended.');
      setActive((a) => a && { ...a, call });
      if (call.status === 'active' && !sess.connectBy) sess.connectBy = Date.now() + 30_000;
      if (sess.connectBy && !sess.connected && Date.now() > sess.connectBy) {
        void api(`/calls/${sess.id}/end`, { method: 'POST' }).catch(() => {});
        return finish(sess, 'Could not connect the call. Check both connections and try again.');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return finish(sess, 'Call ended.');
    }
    sess.timer = setTimeout(() => tick(sess), 1000);
  }

  function open(call, local) {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const remote = new MediaStream();
    const sess = { id: call.id, pc, local, last: 0, queue: [], ready: false, connected: false, done: false, timer: null, connectBy: 0 };
    local.getTracks().forEach((t) => pc.addTrack(t, local));
    pc.ontrack = (e) => {
      remote.addTrack(e.track);
      setStreams((s) => ({ ...s, tracks: remote.getTracks().length }));
    };
    pc.onicecandidate = (e) => e.candidate && post(sess, 'ice', e.candidate.toJSON());
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        sess.connected = true;
        setActive((a) => a && { ...a, connected: true, startedAt: a.startedAt ?? Date.now() });
      } else if (pc.connectionState === 'failed') {
        void api(`/calls/${sess.id}/end`, { method: 'POST' }).catch(() => {});
        finish(sess, 'The call lost its connection.');
      }
    };
    session.current = sess;
    setStreams({ local, remote, tracks: 0 });
    setActive({ call, connected: false, startedAt: null });
    return sess;
  }

  async function startCall(conversationId, kind) {
    if (session.current || incoming) throw new Error('You are already on a call.');
    const local = await getMedia(kind);
    let sess = null;
    try {
      const call = await api('/calls', { method: 'POST', body: { conversationId, kind } });
      sess = open(call, local);
      await sess.pc.setLocalDescription(await sess.pc.createOffer());
      await api(`/calls/${call.id}/signal`, { method: 'POST', body: { type: 'offer', payload: sess.pc.localDescription.toJSON() } });
      void tick(sess);
    } catch (e) {
      if (sess) {
        void api(`/calls/${sess.id}/end`, { method: 'POST' }).catch(() => {});
        finish(sess, '');
      } else local.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }

  async function accept() {
    const call = incoming;
    joining.current = true;
    setIncoming(null);
    let local;
    try {
      local = await getMedia(call.kind);
    } catch (e) {
      void api(`/calls/${call.id}/decline`, { method: 'POST' }).catch(() => {});
      joining.current = false;
      return say(e.message);
    }
    try {
      const answered = await api(`/calls/${call.id}/answer`, { method: 'POST' });
      void tick(open(answered, local));
    } catch (e) {
      local.getTracks().forEach((t) => t.stop());
      say(e instanceof ApiError ? e.message : 'Could not answer the call.');
    } finally {
      joining.current = false;
    }
  }

  function decline() {
    void api(`/calls/${incoming.id}/decline`, { method: 'POST' }).catch(() => {});
    setIncoming(null);
  }

  function hangUp() {
    const sess = session.current;
    if (!sess) return;
    void api(`/calls/${sess.id}/end`, { method: 'POST' }).catch(() => {});
    finish(sess, '');
  }

  function toggle(kind) {
    const on = kind === 'audio' ? flags.muted : flags.camOff;
    streams.local?.getTracks().filter((t) => t.kind === kind).forEach((t) => (t.enabled = on));
    setFlags((f) => (kind === 'audio' ? { ...f, muted: !f.muted } : { ...f, camOff: !f.camOff }));
  }

  // Someone calling us: look every 3 s while signed in and not already on a call.
  useEffect(() => {
    if (status !== 'signedIn') return;
    let live = true;
    const look = () =>
      api('/calls/incoming')
        .then((c) => {
          if (!live || session.current || joining.current) return;
          setIncoming((cur) => (c ? (cur?.id === c.id ? cur : c) : null));
        })
        .catch(() => {});
    void look();
    const t = setInterval(look, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [status]);

  // Leaving the page or signing out hangs up.
  useEffect(
    () => () => {
      const sess = session.current;
      if (sess) {
        void api(`/calls/${sess.id}/end`, { method: 'POST' }).catch(() => {});
        finish(sess, '');
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // A best-effort ringtone while someone is calling; browsers may keep it silent until the page has been clicked.
  useEffect(() => {
    if (!incoming) return;
    let ctx;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const beep = () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0.08;
      o.frequency.value = 440;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    };
    beep();
    const t = setInterval(beep, 2000);
    return () => {
      clearInterval(t);
      ctx.close().catch(() => {});
    };
  }, [incoming?.id]);

  useEffect(() => {
    if (!active?.startedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active?.startedAt]);

  const call = active?.call;
  const video = call?.kind === 'video';
  const name = call?.peer.fullName ?? call?.peer.username;
  const label = !call ? '' : call.status === 'ringing' ? (call.mine ? 'Calling…' : 'Connecting…') : active.connected ? clock(Math.max(0, Math.round((now - active.startedAt) / 1000))) : 'Connecting…';

  return (
    <CallContext.Provider value={{ startCall, busy: !!active || !!incoming }}>
      {children}
      {notice && (
        <div className="call-toast" role="status">
          {notice}
        </div>
      )}
      {incoming && (
        <div className="call-ring" role="alertdialog" aria-label="Incoming call">
          <Avatar name={incoming.peer.fullName} src={incoming.peer.avatarUrl} size={44} />
          <div className="who">
            <strong>{incoming.peer.fullName ?? incoming.peer.username}</strong>
            <span>Incoming {incoming.kind} call…</span>
          </div>
          <button type="button" className="call-round stop" onClick={decline} aria-label="Decline call">
            <PhoneOffIcon />
          </button>
          <button type="button" className="call-round go" onClick={accept} aria-label="Accept call">
            {incoming.kind === 'video' ? <VideoIcon /> : <PhoneIcon />}
          </button>
        </div>
      )}
      {active && (
        <div className="call-screen" role="dialog" aria-label={`${video ? 'Video' : 'Voice'} call with ${name}`}>
          <Stream stream={streams.remote} className={`call-remote${video ? '' : ' off'}`} data-remote-tracks={streams.tracks} aria-label="Their video" />
          {video ? (
            <Stream stream={streams.local} muted className="call-local" aria-label="Your video" />
          ) : (
            <div className="call-voice">
              <Avatar name={call.peer.fullName} src={call.peer.avatarUrl} size={120} />
              <h2>{name}</h2>
            </div>
          )}
          <div className="call-info">
            <strong>{name}</strong>
            <span aria-label="Call status">{label}</span>
          </div>
          <div className="call-bar">
            <button type="button" className={`call-round${flags.muted ? ' off' : ''}`} onClick={() => toggle('audio')} aria-label={flags.muted ? 'Unmute microphone' : 'Mute microphone'}>
              <MicIcon off={flags.muted} />
            </button>
            {video && (
              <button type="button" className={`call-round${flags.camOff ? ' off' : ''}`} onClick={() => toggle('video')} aria-label={flags.camOff ? 'Turn camera on' : 'Turn camera off'}>
                {flags.camOff ? <VideoOffIcon /> : <VideoIcon />}
              </button>
            )}
            <button type="button" className="call-round stop" onClick={hangUp} aria-label="End call">
              <PhoneOffIcon />
            </button>
          </div>
        </div>
      )}
    </CallContext.Provider>
  );
}
