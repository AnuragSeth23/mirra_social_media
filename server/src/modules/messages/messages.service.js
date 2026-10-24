/*
 * One-to-one messages with privacy rules.
 *
 *   Who may message me (my setting): everyone / people I follow? no: people who follow me ("following") / friends / nobody.
 *   Message requests: if the sender is not my friend, the first message arrives in my "Requests" folder instead of my inbox.
 *     Until I accept, the sender may send only that one message. Accepting (or simply replying) moves it to my inbox;
 *     declining hides it and the sender cannot send more.
 *   Blocks: neither person can start a chat, send, or read the thread (it answers "not found").
 *   Restrict: if I restricted someone, their messages go to my Requests folder and I stop sharing receipts and activity with them.
 *   Read receipts and activity status are mutual: you see the other person's only if you share yours too (and they have not restricted you).
 *   Nobody but the two members can ever read a conversation: every call checks membership on the server.
 */
import { exec, pool, q, tx } from '../../db/pool.js';
import { NOT_BLOCKED } from '../../lib/blocks.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, toBin, uuidv7 } from '../../lib/ids.js';
import { mediaUrl } from '../../lib/media.js';
import { relation } from '../../lib/permissions.js';

const peerOf = (r) => ({ id: fromBin(r.peer_id), username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) });

/** 1:1 chats are unique per pair: dm_key = smaller id || larger id. */
const dmKey = (a, b) => Buffer.concat([toBin(a), toBin(b)].sort(Buffer.compare));

const CLOSED = () => new AppError(403, 'messages_closed', 'You can’t message this account.');
const ACTIVE_MS = 5 * 60_000;

/** The recipient's setting, applied to this sender. */
function mayMessage(setting, rel) {
  if (rel.blocked) return false;
  if (setting === 'nobody') return false;
  if (setting === 'friends') return rel.friends;
  if (setting === 'following') return rel.followsMe || rel.friends;
  return true;
}

async function settingsOf(db, userId) {
  const [s] = await q(db, `SELECT COALESCE(s.messages_from, 'everyone') AS messages_from, COALESCE(s.read_receipts, 1) AS read_receipts, COALESCE(s.show_activity_status, 1) AS show_activity_status
                             FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?`, [toBin(userId)]);
  return s ?? { messages_from: 'everyone', read_receipts: 1, show_activity_status: 1 };
}

/** Opens (or creates) the chat with another user, if their settings and any blocks allow it. */
export async function openWith(me, other) {
  if (me === other) throw new AppError(422, 'self_message', "You can't message yourself.");
  const [target] = await q(pool, `SELECT id FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL`, [toBin(other)]);
  if (!target) throw new AppError(404, 'not_found', 'Account not found.');
  const rel = await relation(pool, me, other);
  if (rel.blocked) throw CLOSED();
  const key = dmKey(me, other);
  const [existing] = await q(pool, 'SELECT id FROM conversations WHERE dm_key = ?', [key]);
  const theirs = await settingsOf(pool, other);
  if (!mayMessage(theirs.messages_from, rel)) throw new AppError(403, 'messages_closed', 'This person isn’t accepting messages from you.');
  if (existing) return { id: fromBin(existing.id) };
  const id = uuidv7();
  // Not friends (or they restricted me): it lands in their Requests folder first.
  const asRequest = !rel.friends || rel.restrictedMe;
  try {
    await tx(async (c) => {
      await exec(c, 'INSERT INTO conversations (id, is_group, dm_key, created_by) VALUES (?, 0, ?, ?)', [toBin(id), key, toBin(me)]);
      await exec(c, 'INSERT INTO conversation_members (conversation_id, user_id, request_pending) VALUES (?, ?, 0), (?, ?, ?)', [toBin(id), toBin(me), toBin(id), toBin(other), asRequest ? 1 : 0]);
    });
  } catch (err) {
    // Two people (or two tabs) opened the same chat at the same moment: the other one won, so use theirs.
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    const [won] = await q(pool, 'SELECT id FROM conversations WHERE dm_key = ?', [key]);
    return { id: fromBin(won.id) };
  }
  return { id };
}

async function memberOf(me, cid) {
  const [row] = await q(pool, 'SELECT request_pending, last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL', [toBin(cid), toBin(me)]);
  if (!row) throw new AppError(404, 'not_found', 'Conversation not found.');
  return row;
}

async function peerOfConversation(me, cid) {
  const [row] = await q(
    pool,
    `SELECT u.id AS peer_id, u.username, u.full_name, u.avatar_key, u.status, u.last_active_at, m.request_pending, m.left_at, m.last_read_at
       FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.user_id <> ? LIMIT 1`,
    [toBin(cid), toBin(me)],
  );
  return row;
}

/** folder 'inbox' (default) or 'requests'. Chats with someone blocked either way are not listed. */
export async function conversations(me, folder = 'inbox') {
  const rows = await q(
    pool,
    `SELECT c.id, c.last_message_at, u.id AS peer_id, u.username, u.full_name, u.avatar_key, me.request_pending,
            (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
                AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)) AS unread
       FROM conversation_members me
       JOIN conversations c ON c.id = me.conversation_id
       JOIN conversation_members other ON other.conversation_id = c.id AND other.user_id <> me.user_id
       JOIN users u ON u.id = other.user_id
      WHERE me.user_id = ? AND me.left_at IS NULL AND c.is_group = 0 AND me.request_pending = ?
        AND ${NOT_BLOCKED('u.id')}
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      ORDER BY c.last_message_at DESC LIMIT 50`,
    [toBin(me), toBin(me), folder === 'requests' ? 1 : 0, toBin(me), toBin(me)],
  );
  return rows.map((r) => ({ id: fromBin(r.id), peer: peerOf(r), lastMessage: r.last_body, lastAt: r.last_message_at.toISOString(), unread: Number(r.unread), request: !!r.request_pending }));
}

export async function thread(me, cid, after) {
  const mine = await memberOf(me, cid);
  const peer = await peerOfConversation(me, cid);
  if (!peer) throw new AppError(404, 'not_found', 'Conversation not found.');
  const peerId = fromBin(peer.peer_id);
  const rel = await relation(pool, me, peerId);
  if (rel.blocked) throw new AppError(404, 'not_found', 'Conversation not found.'); // blocked: nothing can be read, in either direction

  const rows = await q(
    pool,
    `SELECT id, sender_id, body, created_at FROM messages
      WHERE conversation_id = ? AND deleted_at IS NULL ${after ? 'AND id > ?' : ''} ORDER BY id DESC LIMIT 100`,
    after ? [toBin(cid), toBin(after)] : [toBin(cid)],
  );
  await exec(pool, 'UPDATE conversation_members SET last_read_at = NOW(3) WHERE conversation_id = ? AND user_id = ?', [toBin(cid), toBin(me)]);

  // Receipts and activity status are mutual, and never shown to someone the other person restricted.
  const [mySettings, peerSettings] = [await settingsOf(pool, me), await settingsOf(pool, peerId)];
  const shareable = !rel.restrictedMe && !peer.request_pending;
  const peerReadAt = shareable && mySettings.read_receipts && peerSettings.read_receipts ? peer.last_read_at?.toISOString() ?? null : null;
  const activity =
    !rel.restrictedMe && mySettings.show_activity_status && peerSettings.show_activity_status && peer.last_active_at
      ? { online: Date.now() - peer.last_active_at.getTime() < ACTIVE_MS, lastActiveAt: peer.last_active_at.toISOString() }
      : null;

  return {
    peer: peerOf(peer),
    messages: rows.reverse().map((r) => ({ id: fromBin(r.id), body: r.body ?? '', mine: !!r.sender_id && fromBin(r.sender_id) === me, createdAt: r.created_at.toISOString() })),
    peerReadAt,
    activity,
    // incoming: someone outside my friends wrote first and waits for my answer; outgoing: I wrote first and am waiting
    request: { incoming: !!mine.request_pending, outgoing: !!peer.request_pending },
  };
}

export async function send(me, cid, body) {
  const mine = await memberOf(me, cid);
  const peer = await peerOfConversation(me, cid);
  if (!peer || peer.status !== 'active') throw CLOSED();
  const peerId = fromBin(peer.peer_id);
  const rel = await relation(pool, me, peerId);
  if (rel.blocked) throw CLOSED();
  const theirs = await settingsOf(pool, peerId);
  if (!mayMessage(theirs.messages_from, rel)) throw new AppError(403, 'messages_closed', 'This person isn’t accepting messages from you.');

  // While my first message waits in their Requests folder (or they declined), I cannot send more.
  if (peer.request_pending) {
    const [sent] = await q(pool, 'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id = ? AND deleted_at IS NULL', [toBin(cid), toBin(me)]);
    if (Number(sent.n) >= 1 || peer.left_at) throw new AppError(403, 'request_pending', 'Wait for them to accept your message request before sending more.');
  }
  const id = uuidv7();
  await tx(async (c) => {
    await exec(c, 'INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?, ?, ?, ?)', [toBin(id), toBin(cid), toBin(me), body]);
    await exec(c, 'UPDATE conversations SET last_message_at = NOW(3) WHERE id = ?', [toBin(cid)]);
    // Replying to a request accepts it. A restricted sender's messages go to the other person's Requests folder.
    await exec(c, 'UPDATE conversation_members SET last_read_at = NOW(3), request_pending = 0 WHERE conversation_id = ? AND user_id = ?', [toBin(cid), toBin(me)]);
    if (rel.restrictedMe) await exec(c, 'UPDATE conversation_members SET request_pending = 1 WHERE conversation_id = ? AND user_id = ?', [toBin(cid), toBin(peerId)]);
  });
  return { id, body, mine: true, createdAt: new Date().toISOString() };
}

/** Moves a message request into my inbox. */
export async function acceptRequest(me, cid) {
  const r = await exec(pool, 'UPDATE conversation_members SET request_pending = 0 WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL AND request_pending = 1', [toBin(cid), toBin(me)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'There is no message request to accept.');
  return { accepted: true };
}

/** Hides a message request. The sender is not told, and cannot send more. */
export async function declineRequest(me, cid) {
  const r = await exec(pool, 'UPDATE conversation_members SET left_at = NOW(3) WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL AND request_pending = 1', [toBin(cid), toBin(me)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'There is no message request to decline.');
  return { declined: true };
}

/** Unread messages in my inbox, and how many requests are waiting. Chats with blocked people are not counted. */
export async function unreadTotal(me) {
  const [r] = await q(
    pool,
    `SELECT
       COALESCE(SUM(CASE WHEN me.request_pending = 0 AND m.sender_id <> ? AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at) THEN 1 ELSE 0 END), 0) AS n
     FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = ?
     JOIN conversation_members other ON other.conversation_id = m.conversation_id AND other.user_id <> me.user_id
    WHERE m.deleted_at IS NULL AND me.left_at IS NULL AND ${NOT_BLOCKED('other.user_id')}`,
    [toBin(me), toBin(me), toBin(me), toBin(me)],
  );
  const [req] = await q(
    pool,
    `SELECT COUNT(*) AS n FROM conversation_members me
       JOIN conversation_members other ON other.conversation_id = me.conversation_id AND other.user_id <> me.user_id
      WHERE me.user_id = ? AND me.left_at IS NULL AND me.request_pending = 1 AND ${NOT_BLOCKED('other.user_id')}
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = me.conversation_id)`,
    [toBin(me), toBin(me), toBin(me)],
  );
  return { count: Number(r.n), requests: Number(req.n) };
}
