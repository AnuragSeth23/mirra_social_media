/*
 * Voice and video calls between the two people of a chat.
 *
 * How it works (WebRTC): the audio and video go directly from browser to browser. The server only carries the small
 * "handshake" notes the browsers need to find each other (offer, answer, ICE candidates), and keeps the call's record.
 * There is no WebSocket here: like the chat, the browsers ask the API for news every second or so.
 *
 * Rules
 *   - Only the two members of an accepted one-to-one chat can call each other (not while a message request is waiting).
 *   - Nobody can call across a block, or someone who restricted them, or someone who does not accept messages from them.
 *   - One call at a time per person: calling someone who is on another call answers "busy".
 *   - A call nobody answers for 45 s becomes "missed". If a browser goes silent (tab closed, network lost) for ~20 s the call ends.
 *   - When a call finishes, a message is added to the chat (a call card) so it shows in the conversation, including missed calls.
 */
import { exec, pool, q, tx } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { mediaUrl } from '../../lib/media.js';
import { relation } from '../../lib/permissions.js';
import { mayMessage, settingsOf } from '../messages/messages.service.js';

const RING_SECONDS = 45; // an unanswered call becomes "missed"
const CALLER_GONE_WHILE_RINGING = 15; // the caller closed the tab before anyone answered
const LOST_SECONDS = 20; // an answered call where one side has been silent this long has dropped
const MAX_SIGNALS_PER_CALL = 400;
const MAX_SIGNAL_BYTES = 16_000;

const NOT_FOUND = () => new AppError(404, 'not_found', 'Call not found.');
const CLOSED = () => new AppError(403, 'call_not_allowed', 'You can’t call this account.');

const dto = (r, me) => ({
  id: fromBin(r.id),
  conversationId: fromBin(r.conversation_id),
  kind: r.kind,
  status: r.status,
  mine: fromBin(r.caller_id) === me,
  peer: { id: fromBin(r.peer_id), username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) },
  createdAt: r.created_at.toISOString(),
  answeredAt: r.answered_at ? r.answered_at.toISOString() : null,
  endedAt: r.ended_at ? r.ended_at.toISOString() : null,
});

/** The call as seen by `me`, only if `me` is one of its two people. */
async function load(me, id) {
  const [row] = await q(
    pool,
    `SELECT c.*, u.id AS peer_id, u.username, u.full_name, u.avatar_key
       FROM calls c JOIN users u ON u.id = IF(c.caller_id = ?, c.callee_id, c.caller_id)
      WHERE c.id = ? AND (c.caller_id = ? OR c.callee_id = ?)`,
    [toBin(me), toBin(id), toBin(me), toBin(me)],
  );
  if (!row) throw NOT_FOUND();
  return row;
}

/** Ends a call that is still ringing/active, and puts the call card into the chat. Safe to call twice. */
async function close(id, status, by) {
  await tx(async (c) => {
    const [row] = await q(c, 'SELECT conversation_id, caller_id, status FROM calls WHERE id = ? FOR UPDATE', [toBin(id)]);
    if (!row || !['ringing', 'active'].includes(row.status)) return;
    await exec(c, 'UPDATE calls SET status = ?, ended_at = NOW(3), ended_by = ? WHERE id = ?', [status, by ? toBin(by) : null, toBin(id)]);
    await exec(c, 'INSERT INTO messages (conversation_id, sender_id, call_id) VALUES (?, ?, ?)', [row.conversation_id, row.caller_id, toBin(id)]);
    await exec(c, 'UPDATE conversations SET last_message_at = NOW(3) WHERE id = ?', [row.conversation_id]);
  });
}

/** Applies the time rules (unanswered too long, a side gone silent) to one call. */
async function settle(id) {
  const [c] = await q(
    pool,
    `SELECT status, TIMESTAMPDIFF(SECOND, created_at, NOW(3)) AS age,
            TIMESTAMPDIFF(SECOND, COALESCE(caller_seen_at, created_at), NOW(3)) AS caller_idle,
            TIMESTAMPDIFF(SECOND, COALESCE(callee_seen_at, answered_at, created_at), NOW(3)) AS callee_idle
       FROM calls WHERE id = ?`,
    [toBin(id)],
  );
  if (!c) return;
  if (c.status === 'ringing') {
    if (c.age > RING_SECONDS) await close(id, 'missed', null);
    else if (c.caller_idle > CALLER_GONE_WHILE_RINGING) await close(id, 'cancelled', null);
  } else if (c.status === 'active' && (c.caller_idle > LOST_SECONDS || c.callee_idle > LOST_SECONDS)) {
    await close(id, 'ended', null);
  }
}

/** Settles every unfinished call of a person, so a call that was left hanging never makes them look busy. */
async function settleOpenCalls(userId) {
  const open = await q(pool, `SELECT id FROM calls WHERE (caller_id = ? OR callee_id = ?) AND status IN ('ringing', 'active')`, [toBin(userId), toBin(userId)]);
  for (const o of open) await settle(fromBin(o.id));
}

export async function start(me, conversationId, kind) {
  const [mine] = await q(
    pool,
    `SELECT c.is_group FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ? AND m.left_at IS NULL AND m.request_pending = 0
      WHERE c.id = ?`,
    [toBin(me), toBin(conversationId)],
  );
  if (!mine || mine.is_group) throw NOT_FOUND();
  const [peer] = await q(
    pool,
    `SELECT u.id, u.status, m.request_pending, m.left_at FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.user_id <> ?`,
    [toBin(conversationId), toBin(me)],
  );
  if (!peer || peer.status !== 'active' || peer.left_at) throw CLOSED();
  if (peer.request_pending) throw new AppError(403, 'call_not_allowed', 'You can call once they accept your message request.');
  const peerId = fromBin(peer.id);
  const rel = await relation(pool, me, peerId);
  if (rel.blocked || rel.restrictedMe) throw CLOSED();
  if (!mayMessage((await settingsOf(pool, peerId)).messages_from, rel)) throw new AppError(403, 'call_not_allowed', 'This person isn’t accepting messages or calls from you.');

  await settleOpenCalls(me);
  await settleOpenCalls(peerId);
  const [busy] = await q(pool, `SELECT caller_id FROM calls WHERE (caller_id IN (?, ?) OR callee_id IN (?, ?)) AND status IN ('ringing', 'active') LIMIT 1`, [toBin(me), toBin(peerId), toBin(me), toBin(peerId)]);
  if (busy) {
    const iAmBusy = fromBin(busy.caller_id) === me || (await q(pool, `SELECT 1 FROM calls WHERE callee_id = ? AND status IN ('ringing', 'active') LIMIT 1`, [toBin(me)])).length > 0;
    throw new AppError(409, 'busy', iAmBusy ? 'You are already on a call.' : 'They are on another call. Try again in a moment.');
  }

  const id = String((await exec(pool, 'INSERT INTO calls (conversation_id, caller_id, callee_id, kind, caller_seen_at) VALUES (?, ?, ?, ?, NOW(3))', [toBin(conversationId), toBin(me), toBin(peerId), kind])).insertId);
  return dto(await load(me, id), me);
}

/** The call that is ringing for me right now, if any (the app asks every few seconds). */
export async function incoming(me) {
  const ringing = await q(pool, `SELECT id FROM calls WHERE callee_id = ? AND status = 'ringing' ORDER BY created_at DESC LIMIT 3`, [toBin(me)]);
  for (const r of ringing) await settle(fromBin(r.id));
  const [next] = await q(pool, `SELECT id FROM calls WHERE callee_id = ? AND status = 'ringing' ORDER BY created_at DESC LIMIT 1`, [toBin(me)]);
  return next ? dto(await load(me, fromBin(next.id)), me) : null;
}

/** The call's state plus the handshake notes from the OTHER person that I have not seen yet (after = the last note id I saw). */
export async function get(me, id, after = 0) {
  const row = await load(me, id);
  if (['ringing', 'active'].includes(row.status)) {
    const side = fromBin(row.caller_id) === me ? 'caller_seen_at' : 'callee_seen_at';
    await exec(pool, `UPDATE calls SET ${side} = NOW(3) WHERE id = ?`, [toBin(id)]);
    await settle(id);
  }
  const signals = await q(pool, 'SELECT id, type, payload FROM call_signals WHERE call_id = ? AND from_user <> ? AND id > ? ORDER BY id LIMIT 100', [toBin(id), toBin(me), after]);
  return { call: dto(await load(me, id), me), signals: signals.map((s) => ({ id: Number(s.id), type: s.type, payload: s.payload })) };
}

export async function signal(me, id, type, payload) {
  const row = await load(me, id);
  if (!['ringing', 'active'].includes(row.status)) throw new AppError(409, 'call_ended', 'This call has ended.');
  const json = JSON.stringify(payload);
  if (json.length > MAX_SIGNAL_BYTES) throw new AppError(422, 'signal_too_large', 'That is too large.');
  const [{ n }] = await q(pool, 'SELECT COUNT(*) AS n FROM call_signals WHERE call_id = ? AND from_user = ?', [toBin(id), toBin(me)]);
  if (Number(n) >= MAX_SIGNALS_PER_CALL) throw new AppError(429, 'too_many_signals', 'Too many messages for one call.');
  await exec(pool, 'INSERT INTO call_signals (call_id, from_user, type, payload) VALUES (?, ?, ?, ?)', [toBin(id), toBin(me), type, json]);
  return { ok: true };
}

/** The person being called picks up. */
export async function answer(me, id) {
  const row = await load(me, id);
  if (fromBin(row.callee_id) !== me) throw new AppError(403, 'not_allowed', 'Only the person being called can answer.');
  const r = await exec(pool, `UPDATE calls SET status = 'active', answered_at = NOW(3), callee_seen_at = NOW(3) WHERE id = ? AND status = 'ringing'`, [toBin(id)]);
  const fresh = await load(me, id);
  if (!r.affectedRows && fresh.status !== 'active') throw new AppError(409, 'call_ended', 'This call has ended.');
  return dto(fresh, me);
}

/** Hang up. While ringing: the caller cancels, the callee declines. During a call: either side ends it. Calling it twice is fine. */
export async function end(me, id) {
  const row = await load(me, id);
  const iAmCaller = fromBin(row.caller_id) === me;
  if (row.status === 'ringing') await close(id, iAmCaller ? 'cancelled' : 'declined', me);
  else if (row.status === 'active') await close(id, 'ended', me);
  return dto(await load(me, id), me);
}
