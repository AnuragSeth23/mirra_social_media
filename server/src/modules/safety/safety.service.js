import { exec, pool, q, tx } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { mediaUrl } from '../../lib/media.js';
import { pairKey, postVisParams, postVisibleSql, relation } from '../../lib/permissions.js';

export const REPORT_REASONS = ['spam', 'nudity', 'harassment', 'hate', 'violence', 'self_harm', 'scam', 'other'];

/**
 * Blocking is mutual in effect: neither person can see the other's profile, posts, stories or search results,
 * follow, like, comment or message. Existing follows in both directions are removed (with their counters).
 */
export async function block(me, target) {
  if (me === target) throw new AppError(422, 'self_block', "You can't block yourself.");
  const [u] = await q(pool, 'SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL', [toBin(target)]);
  if (!u) throw new AppError(404, 'not_found', 'Account not found.');
  await tx(async (c) => {
    await exec(c, 'INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', [toBin(me), toBin(target)]);
    await exec(c, 'DELETE FROM friendships WHERE pair_key = ?', [pairKey(me, target)]);
    for (const [follower, followee] of [
      [me, target],
      [target, me],
    ]) {
      const [f] = await q(c, 'SELECT status FROM follows WHERE follower_id = ? AND followee_id = ?', [toBin(follower), toBin(followee)]);
      if (!f) continue;
      await exec(c, 'DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', [toBin(follower), toBin(followee)]);
      if (f.status === 'accepted') {
        await exec(c, 'UPDATE users SET following_count = GREATEST(following_count, 1) - 1 WHERE id = ?', [toBin(follower)]);
        await exec(c, 'UPDATE users SET followers_count = GREATEST(followers_count, 1) - 1 WHERE id = ?', [toBin(followee)]);
      }
    }
  });
  return { blocked: true };
}

export async function unblock(me, target) {
  await exec(pool, 'DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [toBin(me), toBin(target)]);
  return { blocked: false };
}

export async function blockedList(me) {
  const rows = await q(
    pool,
    `SELECT u.id, u.username, u.full_name, u.avatar_key FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? AND u.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 200`,
    [toBin(me)],
  );
  return rows.map((r) => ({ id: fromBin(r.id), username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) }));
}

/**
 * RESTRICT: a quiet middle step between doing nothing and blocking. The restricted person is never told. What changes:
 *   1. Their comments on the restrictor's posts are visible only to them and to the restrictor.
 *   2. Their messages go to the restrictor's "Requests" folder, and do not notify.
 *   3. They no longer see the restrictor's read receipts or activity status.
 *   4. They can still see public content and follow, and nothing is deleted.
 * Unrestricting restores everything for new activity. (Details: docs/PRIVACY.md.)
 */
export async function restrict(me, target) {
  if (me === target) throw new AppError(422, 'self_restrict', "You can't restrict yourself.");
  const rel = await relation(pool, me, target);
  const [u] = await q(pool, 'SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL', [toBin(target)]);
  if (!u || rel.blockedMe) throw new AppError(404, 'not_found', 'Account not found.');
  await exec(pool, 'INSERT IGNORE INTO restrictions (restrictor_id, restricted_id) VALUES (?, ?)', [toBin(me), toBin(target)]);
  return { restricted: true };
}

export async function unrestrict(me, target) {
  await exec(pool, 'DELETE FROM restrictions WHERE restrictor_id = ? AND restricted_id = ?', [toBin(me), toBin(target)]);
  return { restricted: false };
}

export async function restrictedList(me) {
  const rows = await q(
    pool,
    `SELECT u.id, u.username, u.full_name, u.avatar_key FROM restrictions r JOIN users u ON u.id = r.restricted_id
      WHERE r.restrictor_id = ? AND u.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 200`,
    [toBin(me)],
  );
  return rows.map((r) => ({ id: fromBin(r.id), username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) }));
}

/**
 * Files a report for moderators. The reporter must be able to see what they report (posts, comments), or be part of the
 * conversation (messages): reporting is not a way to probe ids. The reported person is never told who reported, and no
 * endpoint returns the reporter to anyone except moderators. Reporting the same thing twice returns the first report.
 */
export async function report(me, type, targetId, reason, details) {
  let owner;
  if (type === 'user') {
    const [u] = await q(pool, `SELECT id AS author FROM users WHERE id = ? AND deleted_at IS NULL`, [toBin(targetId)]);
    const rel = u ? await relation(pool, me, targetId) : null;
    owner = u && !rel.blockedMe ? u : null;
  } else if (type === 'post') {
    [owner] = await q(pool, `SELECT p.author_id AS author FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ? AND ${postVisibleSql('p', 'u')}`, [toBin(targetId), ...postVisParams(me)]);
  } else if (type === 'comment') {
    [owner] = await q(
      pool,
      `SELECT c.author_id AS author FROM comments c JOIN posts p ON p.id = c.post_id JOIN users u ON u.id = p.author_id
        WHERE c.id = ? AND c.deleted_at IS NULL AND ${postVisibleSql('p', 'u')}`,
      [toBin(targetId), ...postVisParams(me)],
    );
  } else {
    [owner] = await q(
      pool,
      `SELECT m.sender_id AS author FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
        WHERE m.id = ? AND m.deleted_at IS NULL`,
      [toBin(me), toBin(targetId)],
    );
  }
  if (!owner) throw new AppError(404, 'not_found', 'That item is no longer available.');
  if (owner.author && fromBin(owner.author) === me) throw new AppError(422, 'self_report', "You can't report your own content.");

  const [dupe] = await q(pool, `SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status IN ('open','reviewing')`, [toBin(me), type, toBin(targetId)]);
  if (!dupe) {
    await exec(pool, 'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?, ?, ?, ?, ?)', [toBin(me), type, toBin(targetId), reason, details]);
  }
  return { reported: true };
}
