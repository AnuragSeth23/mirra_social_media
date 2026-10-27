/*
 * Checks voice and video calls against a running API: who may call whom, ringing, busy, the handshake notes, answering,
 * ending, declining, cancelling, missed and dropped calls, the call card that lands in the chat, and the privacy rules.
 * (The audio/video itself runs between browsers and is covered by the browser test e2e/tests/07-calls.spec.js.)
 * Usage: npm run smoke:calls   (codes are read from verification_codes.dev_code, development only)
 */
import mysql from 'mysql2/promise';
import { config } from '../src/config/env.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = await mysql.createConnection(config.DATABASE_URL);
const code = async (username) => (await db.query(`SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id WHERE u.username = ? AND vc.channel = 'phone' ORDER BY vc.id DESC LIMIT 1`, [username]))[0][0].dev_code;

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-SocialAmbak-Client': 'web', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
}

let passed = 0;
function expect(label, cond, extra) {
  if (!cond) {
    console.error(`✗ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

const stamp = Date.now().toString(36).slice(-6);
let n = 0;
async function newUser(tag) {
  const id = `${stamp}${tag}${n++}`;
  const u = { fullName: `Call ${tag}`, username: `k${id}`, email: `k${id}@example.com`, phone: `+1415${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`, password: 'tidepool42', dateOfBirth: '1998-04-12', verifyVia: 'phone' };
  const s = await call('POST', '/auth/signup', undefined, u);
  await sleep(120);
  const v = await call('POST', '/auth/verify', undefined, { ticket: s.json.data.ticket, channel: 'phone', code: await code(u.username) });
  return { id: v.json.data.user.id, token: v.json.data.accessToken, u };
}
/** Two people with an accepted chat (a first message, accepted by the other side). */
async function chatBetween(a, b) {
  const cid = (await call('POST', `/messages/with/${b.id}`, a.token)).json.data.id;
  await call('POST', `/messages/${cid}`, a.token, { body: 'hello' });
  await call('POST', `/messages/${cid}/accept`, b.token);
  return cid;
}
const thread = async (token, cid) => (await call('GET', `/messages/${cid}`, token)).json.data;
const lastCard = async (token, cid) => (await thread(token, cid)).messages.filter((m) => m.call).at(-1)?.call;
const OFFER = { type: 'offer', payload: { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n' } };

const a = await newUser('a');
const b = await newUser('b');
const c = await newUser('c');

// ===================================================================== who may call
const stranger = (await call('POST', `/messages/with/${b.id}`, a.token)).json.data.id;
await call('POST', `/messages/${stranger}`, a.token, { body: 'hi, not friends yet' });
const early = await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' });
expect('nobody can call while a message request is still waiting (403)', early.status === 403 && early.json.error.code === 'call_not_allowed', early.json);
await call('POST', `/messages/${stranger}/accept`, b.token);
const noAuth = await call('POST', '/calls', undefined, { conversationId: stranger, kind: 'voice' });
const badKind = await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'hologram' });
const ghostChat = await call('POST', '/calls', a.token, { conversationId: '999999999', kind: 'voice' });
const outsiderCall = await call('POST', '/calls', c.token, { conversationId: stranger, kind: 'voice' });
expect('a call needs sign-in (401), a real kind (422), an existing chat (404) and membership of that chat (404)', noAuth.status === 401 && badKind.status === 422 && ghostChat.status === 404 && outsiderCall.status === 404, [noAuth.status, badKind.status, ghostChat.status, outsiderCall.status]);

// ===================================================================== ringing, busy, the handshake
const ring = await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'video' });
expect('after the chat is accepted a video call starts ringing', ring.status === 200 && ring.json.data.status === 'ringing' && ring.json.data.kind === 'video' && ring.json.data.mine === true && ring.json.data.peer.username === b.u.username, ring.json);
const callId = ring.json.data.id;
const inc = await call('GET', '/calls/incoming', b.token);
expect('the other person sees it as an incoming call with the caller’s name', inc.json.data?.id === callId && inc.json.data.peer.username === a.u.username && inc.json.data.mine === false, inc.json);
expect('the caller has no incoming call, and an unrelated person has none either', (await call('GET', '/calls/incoming', a.token)).json.data === null && (await call('GET', '/calls/incoming', c.token)).json.data === null);
const again = await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' });
expect('a second call while one is ringing is refused as busy (409)', again.status === 409 && again.json.error.code === 'busy', again.json);
const cb = await chatBetween(c, b);
const busyCallee = await call('POST', '/calls', c.token, { conversationId: cb, kind: 'voice' });
expect('calling someone who is on a call answers "busy" (409)', busyCallee.status === 409 && /another call/.test(busyCallee.json.error.message), busyCallee.json);
const calleeCalls = await call('POST', '/calls', b.token, { conversationId: cb, kind: 'voice' });
expect('a person who is on a call cannot start another (409)', calleeCalls.status === 409 && /already on a call/.test(calleeCalls.json.error.message), calleeCalls.json);
const spy = await call('GET', `/calls/${callId}`, c.token);
const spySignal = await call('POST', `/calls/${callId}/signal`, c.token, OFFER);
const spyEnd = await call('POST', `/calls/${callId}/end`, c.token);
expect('someone outside the call cannot read it, send into it or end it (404)', spy.status === 404 && spySignal.status === 404 && spyEnd.status === 404, [spy.status, spySignal.status, spyEnd.status]);

expect('the caller posts the offer', (await call('POST', `/calls/${callId}/signal`, a.token, OFFER)).status === 200);
expect('an invalid handshake type is refused (422)', (await call('POST', `/calls/${callId}/signal`, a.token, { type: 'bomb', payload: {} })).status === 422);
expect('a huge handshake note is refused (422)', (await call('POST', `/calls/${callId}/signal`, a.token, { type: 'ice', payload: { junk: 'x'.repeat(20_000) } })).status === 422);
await call('POST', `/calls/${callId}/signal`, a.token, { type: 'ice', payload: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
const seenByB = await call('GET', `/calls/${callId}?after=0`, b.token);
const seenByA = await call('GET', `/calls/${callId}?after=0`, a.token);
expect('the callee receives the caller’s notes in order; the caller never gets her own back', seenByB.json.data.signals.map((s) => s.type).join() === 'offer,ice' && seenByA.json.data.signals.length === 0 && seenByB.json.data.signals[0].payload.type === 'offer', [seenByB.json, seenByA.json]);
const lastId = seenByB.json.data.signals.at(-1).id;
expect('asking again "after" the last note returns nothing new', (await call('GET', `/calls/${callId}?after=${lastId}`, b.token)).json.data.signals.length === 0);

// ===================================================================== answering and the call card
const callerAnswers = await call('POST', `/calls/${callId}/answer`, a.token);
expect('only the person being called can answer (403)', callerAnswers.status === 403, callerAnswers.json);
const answered = await call('POST', `/calls/${callId}/answer`, b.token);
expect('answering makes the call active', answered.status === 200 && answered.json.data.status === 'active' && !!answered.json.data.answeredAt, answered.json);
expect('answering twice is harmless', (await call('POST', `/calls/${callId}/answer`, b.token)).json.data.status === 'active');
await call('POST', `/calls/${callId}/signal`, b.token, { type: 'answer', payload: { type: 'answer', sdp: 'v=0\r\n' } });
expect('the caller receives the answer', (await call('GET', `/calls/${callId}?after=0`, a.token)).json.data.signals.some((s) => s.type === 'answer'));
await sleep(1200);
const ended = await call('POST', `/calls/${callId}/end`, a.token);
expect('either side can end an active call', ended.status === 200 && ended.json.data.status === 'ended' && !!ended.json.data.endedAt, ended.json);
expect('ending twice is harmless, and nothing more can be signalled (409)', (await call('POST', `/calls/${callId}/end`, b.token)).json.data.status === 'ended' && (await call('POST', `/calls/${callId}/signal`, a.token, OFFER)).status === 409);
const cardA = await lastCard(a.token, stranger);
const cardB = await lastCard(b.token, stranger);
expect('a finished call leaves a card in the chat: completed, with its length, "outgoing" for the caller only', cardA?.outcome === 'completed' && cardA.kind === 'video' && cardA.seconds >= 1 && cardA.outgoing === true && cardB?.outgoing === false, [cardA, cardB]);
expect('the chat list previews it as a call', (await call('GET', '/messages', b.token)).json.data.find((x) => x.id === stranger).lastMessage === '📞 Call');

// ===================================================================== declined, cancelled, missed, dropped
const r1 = (await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' })).json.data;
await call('POST', `/calls/${r1.id}/decline`, b.token);
expect('declining rings off and leaves a "declined" card', (await call('GET', `/calls/${r1.id}`, a.token)).json.data.call.status === 'declined' && (await lastCard(a.token, stranger)).outcome === 'declined');
const r2 = (await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' })).json.data;
await call('POST', `/calls/${r2.id}/end`, a.token);
expect('the caller giving up cancels it: it stops ringing for the callee and shows as "cancelled"', (await call('GET', '/calls/incoming', b.token)).json.data === null && (await lastCard(b.token, stranger)).outcome === 'cancelled');
const r3 = (await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' })).json.data;
await db.query('UPDATE calls SET created_at = NOW(3) - INTERVAL 60 SECOND WHERE id = ?', [r3.id]);
expect('a call nobody answers for 45 s stops ringing and becomes "missed"', (await call('GET', '/calls/incoming', b.token)).json.data === null && (await lastCard(b.token, stranger)).outcome === 'missed');
const r4 = (await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' })).json.data;
await db.query('UPDATE calls SET caller_seen_at = NOW(3) - INTERVAL 30 SECOND WHERE id = ?', [r4.id]);
expect('a caller who vanishes while it rings (tab closed) cancels it by itself', (await call('GET', '/calls/incoming', b.token)).json.data === null);
const r5 = (await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'video' })).json.data;
await call('POST', `/calls/${r5.id}/answer`, b.token);
await db.query('UPDATE calls SET caller_seen_at = NOW(3) - INTERVAL 30 SECOND WHERE id = ?', [r5.id]);
const dropped = await call('GET', `/calls/${r5.id}`, b.token);
expect('an active call whose other side went silent for 20 s ends by itself', dropped.json.data.call.status === 'ended', dropped.json);
expect('nobody is left "busy" after all that: a new call can start', (await call('POST', '/calls', b.token, { conversationId: stranger, kind: 'voice' })).status === 200);
await call('POST', `/calls/${(await call('GET', '/calls/incoming', a.token)).json.data.id}/end`, a.token);

// ===================================================================== privacy
await call('PATCH', '/account/settings', b.token, { messagesFrom: 'nobody' });
const closed = await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' });
expect('someone who accepts no messages cannot be called (403)', closed.status === 403, closed.json);
await call('PATCH', '/account/settings', b.token, { messagesFrom: 'everyone' });
await call('PUT', `/safety/block/${a.id}`, b.token);
const blocked = await call('POST', '/calls', a.token, { conversationId: stranger, kind: 'voice' });
const blockedBack = await call('POST', '/calls', b.token, { conversationId: stranger, kind: 'voice' });
expect('nobody can call across a block, in either direction (403)', blocked.status === 403 && blockedBack.status === 403, [blocked.json, blockedBack.json]);

console.log(`\nAll ${passed} call checks passed.`);
await db.end();
process.exit(0);
