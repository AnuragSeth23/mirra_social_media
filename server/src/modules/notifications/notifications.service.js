import { exec, pool, q } from '../../db/pool.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { mediaUrl } from '../../lib/media.js';
import { postVisibleSql, postVisParams } from '../../lib/permissions.js';

const SETTING = {
  mention: 'notify_comments',
  tag: 'notify_comments',
  friend_request: 'notify_follows',
  friend_accept: 'notify_follows',
  post_like: 'notify_likes',
  comment: 'notify_comments',
  comment_reply: 'notify_comments',
  follow: 'notify_follows',
  follow_request: 'notify_follows',
  follow_accepted: 'notify_follows',
};

/** Records "actor did X to your thing". Never notifies you about your own actions; repeats replace the unread one. */
export async function notify(db, n) {
  if (n.recipient === n.actor) return;
  // Respect the recipient's notification settings, and never notify across a block.
  const [pref] = await q(db, `SELECT COALESCE((SELECT ${SETTING[n.type]} FROM user_settings WHERE user_id = ?), 1) AS \`on\``, [toBin(n.recipient)]);
  if (pref && !pref.on) return;
  const [blocked] = await q(db, 'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [
    toBin(n.recipient),
    toBin(n.actor),
    toBin(n.actor),
    toBin(n.recipient),
  ]);
  if (blocked) return;
  if (n.type !== 'comment' && n.type !== 'comment_reply') {
    await exec(db, 'DELETE FROM notifications WHERE recipient_id = ? AND actor_id = ? AND type = ? AND post_id <=> ? AND read_at IS NULL', [
      toBin(n.recipient),
      toBin(n.actor),
      n.type,
      n.postId ? toBin(n.postId) : null,
    ]);
  }
  await exec(db, 'INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)', [
    toBin(n.recipient),
    toBin(n.actor),
    n.type,
    n.postId ? toBin(n.postId) : null,
    n.commentId ? toBin(n.commentId) : null,
  ]);
}

export async function list(me) {
  const rows = await q(
    pool,
    `SELECT n.id, n.type, n.post_id, n.read_at, n.created_at, u.username, u.full_name, u.avatar_key, m.storage_key
       FROM notifications n JOIN users u ON u.id = n.actor_id AND u.status = 'active' AND u.deleted_at IS NULL
       LEFT JOIN posts p ON p.id = n.post_id
       LEFT JOIN users au ON au.id = p.author_id
       LEFT JOIN post_media m ON m.post_id = n.post_id AND m.position = 0
      WHERE n.recipient_id = ? AND (n.post_id IS NULL OR (${postVisibleSql('p', 'au')})) ORDER BY n.id DESC LIMIT 50`,
    [toBin(me), ...postVisParams(me)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    type: r.type,
    postId: r.post_id ? fromBin(r.post_id) : null,
    read: !!r.read_at,
    createdAt: r.created_at.toISOString(),
    actor: { username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) },
    thumbUrl: r.storage_key && /\.(jpg|png|gif|webp)$/.test(r.storage_key) ? mediaUrl(r.storage_key) : null,
  }));
}

export async function unreadCount(me) {
  const [r] = await q(pool, 'SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND read_at IS NULL', [toBin(me)]);
  return { count: Number(r.n) };
}

/** Marks notifications read up to `upToId` (the newest one the user was shown), so newer arrivals stay unread. */
export async function markAllRead(me, upToId) {
  await exec(pool, `UPDATE notifications SET read_at = NOW(3) WHERE recipient_id = ? AND read_at IS NULL ${upToId ? 'AND id <= ?' : ''}`, upToId ? [toBin(me), upToId] : [toBin(me)]);
}
