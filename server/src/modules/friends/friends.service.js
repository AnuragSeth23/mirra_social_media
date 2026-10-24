/*
 * Friends. A friendship needs both people to agree: one sends a request, the other accepts.
 * One row per pair of people in `friendships` (the unique pair_key guarantees there can never be two rows for the
 * same pair, whoever asked), with a status of pending / accepted / rejected.
 *
 * Rules:
 *   - You cannot ask yourself, someone who blocked you (looks like "not found"), or someone you blocked (unblock first).
 *   - The other person decides who may ask them: everyone, friends of friends, or nobody.
 *   - Asking twice is refused (409). If they had already asked you, asking back simply makes you friends.
 *   - After a rejection the same person cannot ask again for 30 days (they are told "already sent", never "rejected").
 *   - Only the person asked can accept or reject; only the asker can cancel; either friend can unfriend.
 */
import { exec, pool, q, tx } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { mediaUrl } from '../../lib/media.js';
import { allowedBy, pairKey, privacyOf, relation } from '../../lib/permissions.js';
import { notify } from '../notifications/notifications.service.js';

const REJECT_COOLDOWN_DAYS = 30;

const person = (r) => ({ id: fromBin(r.id), username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) });

/** Do I and this person have at least one friend in common? */
async function haveMutualFriend(db, a, b) {
  const side = `SELECT IF(requester_id = ?, addressee_id, requester_id) AS f FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`;
  const [r] = await q(db, `SELECT EXISTS (SELECT 1 FROM (${side}) mine JOIN (${side}) theirs ON mine.f = theirs.f) AS yes`, [
    toBin(a), toBin(a), toBin(a), toBin(b), toBin(b), toBin(b),
  ]);
  return !!r.yes;
}

/** How a viewer sees their friendship with someone, as one word the screen can use. */
export function friendshipLabel(rel) {
  if (rel.friends) return 'friends';
  if (rel.friendStatus === 'pending') return rel.iRequested ? 'request_sent' : 'request_received';
  if (rel.friendStatus === 'rejected' && rel.iRequested) return 'request_sent'; // a rejection is never revealed to the person who asked
  return 'none';
}

export async function sendRequest(me, target) {
  if (me === target) throw new AppError(422, 'self_friend', "You can't send yourself a friend request.");
  const [u] = await q(pool, `SELECT id FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL`, [toBin(target)]);
  const rel = u ? await relation(pool, me, target) : null;
  if (!u || rel.blockedMe) throw new AppError(404, 'not_found', 'Account not found.');
  if (rel.iBlocked) throw new AppError(403, 'blocked', 'Unblock this person first.');
  const privacy = await privacyOf(pool, target);
  if (privacy.who_can_friend_request === 'nobody') throw new AppError(403, 'requests_closed', 'This person isn’t accepting friend requests.');
  if (privacy.who_can_friend_request === 'friends_of_friends' && !rel.friends && !(await haveMutualFriend(pool, me, target))) {
    throw new AppError(403, 'requests_closed', 'This person only accepts friend requests from friends of friends.');
  }

  try {
    return await tx(async (c) => {
      const [row] = await q(c, 'SELECT requester_id, status, responded_at FROM friendships WHERE pair_key = ? FOR UPDATE', [pairKey(me, target)]);
      if (row) {
        const askedByMe = fromBin(row.requester_id) === me;
        if (row.status === 'accepted') throw new AppError(409, 'already_friends', 'You are already friends.');
        if (row.status === 'pending' && askedByMe) throw new AppError(409, 'already_sent', 'You already sent a friend request.');
        if (row.status === 'pending') {
          // They asked me first: asking back means yes.
          await exec(c, "UPDATE friendships SET status = 'accepted', responded_at = NOW(3) WHERE pair_key = ?", [pairKey(me, target)]);
          await notify(c, { recipient: target, actor: me, type: 'friend_accept' });
          return { status: 'friends' };
        }
        // rejected
        const recent = row.responded_at && Date.now() - row.responded_at.getTime() < REJECT_COOLDOWN_DAYS * 86_400_000;
        if (askedByMe && recent) throw new AppError(409, 'already_sent', 'You already sent a friend request.');
        await exec(c, 'DELETE FROM friendships WHERE pair_key = ?', [pairKey(me, target)]);
      }
      await exec(c, 'INSERT INTO friendships (requester_id, addressee_id, status, pair_key) VALUES (?, ?, ?, ?)', [toBin(me), toBin(target), 'pending', pairKey(me, target)]);
      await notify(c, { recipient: target, actor: me, type: 'friend_request' });
      return { status: 'request_sent' };
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'already_sent', 'You already sent a friend request.'); // two clicks at once
    throw err;
  }
}

export async function accept(me, requesterId) {
  const r = await exec(pool, "UPDATE friendships SET status = 'accepted', responded_at = NOW(3) WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'", [toBin(requesterId), toBin(me)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'There is no pending request from that person.');
  await notify(pool, { recipient: requesterId, actor: me, type: 'friend_accept' });
  return { status: 'friends' };
}

export async function reject(me, requesterId) {
  const r = await exec(pool, "UPDATE friendships SET status = 'rejected', responded_at = NOW(3) WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'", [toBin(requesterId), toBin(me)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'There is no pending request from that person.');
  return { status: 'none' };
}

/** The person who asked takes the request back. */
export async function cancel(me, addresseeId) {
  const r = await exec(pool, "DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status IN ('pending', 'rejected')", [toBin(me), toBin(addresseeId)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'There is no request to cancel.');
  return { status: 'none' };
}

export async function unfriend(me, otherId) {
  const r = await exec(pool, "DELETE FROM friendships WHERE pair_key = ? AND status = 'accepted'", [pairKey(me, otherId)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'You are not friends with that person.');
  return { status: 'none' };
}

const FRIEND_COLS = `u.id, u.username, u.full_name, u.avatar_key`;

/** Someone's friends, subject to their "who can see my friends list" setting. */
export async function friendsOf(me, userId) {
  const rel = await relation(pool, me, userId);
  if (rel.blockedMe) throw new AppError(404, 'not_found', 'Account not found.');
  const privacy = await privacyOf(pool, userId);
  if (!allowedBy(privacy.show_friends_list, rel)) throw new AppError(403, 'friends_hidden', 'This person keeps their friends list private.'); // also true when I blocked them
  const rows = await q(
    pool,
    `SELECT ${FRIEND_COLS} FROM friendships fr
       JOIN users u ON u.id = IF(fr.requester_id = ?, fr.addressee_id, fr.requester_id)
      WHERE fr.status = 'accepted' AND (fr.requester_id = ? OR fr.addressee_id = ?) AND u.status = 'active' AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
      ORDER BY fr.responded_at DESC, u.username LIMIT 500`,
    [toBin(userId), toBin(userId), toBin(userId), toBin(me), toBin(me)],
  );
  return rows.map(person);
}

export async function friendsCount(db, userId) {
  const [r] = await q(
    db,
    `SELECT COUNT(*) AS n FROM friendships fr WHERE fr.status = 'accepted' AND (fr.requester_id = ? OR fr.addressee_id = ?)`,
    [toBin(userId), toBin(userId)],
  );
  return Number(r.n);
}

/** Requests waiting for my answer (incoming) or that I sent and are still open (outgoing). */
export async function requests(me, direction) {
  const incoming = direction !== 'outgoing';
  const rows = await q(
    pool,
    `SELECT ${FRIEND_COLS}, fr.created_at FROM friendships fr
       JOIN users u ON u.id = ${incoming ? 'fr.requester_id' : 'fr.addressee_id'}
      WHERE ${incoming ? 'fr.addressee_id' : 'fr.requester_id'} = ? AND fr.status = ${incoming ? "'pending'" : "'pending'"}
        AND u.status = 'active' AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
      ORDER BY fr.created_at DESC LIMIT 200`,
    [toBin(me), toBin(me), toBin(me)],
  );
  return rows.map((r) => ({ ...person(r), requestedAt: r.created_at.toISOString() }));
}
