/*
 * Mentions (@username in a caption) and tags (people attached to a post).
 *
 * Rules, in plain words:
 *   - Everyone controls who may mention them and who may tag them (everyone / friends / nobody).
 *   - Someone who blocked you, or whom you blocked, can never be mentioned or tagged (and you are not told why).
 *   - A tag never makes a post visible to anyone new. You can only tag a person who could already see the post:
 *     public posts: anyone allowed; friends-only posts: only your friends; "only me" posts: nobody.
 *   - If the tagged person turned on "review tags", the tag waits as "pending" and does not appear on their profile
 *     until they approve it. They can remove a tag at any time, and the post's author can remove tags too.
 *   - Tightening a post's audience later removes the tags of people who can no longer see it.
 */
import { exec, pool, q } from '../../db/pool.js';
import { NOT_BLOCKED } from '../../lib/blocks.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { mediaUrl } from '../../lib/media.js';
import { mayDo, postVisibleSql, postVisParams, privacyOf, relation } from '../../lib/permissions.js';
import { notify } from '../notifications/notifications.service.js';

const MENTION_RE = /(?<![\p{L}\p{N}_&])@([a-z0-9._]{3,30})/giu;
const MAX_TAGS = 20;

export function parseMentions(caption) {
  const found = new Set();
  for (const m of caption.matchAll(MENTION_RE)) {
    const name = m[1].toLowerCase().replace(/\.+$/, '');
    if (name.length >= 3) found.add(name);
    if (found.size >= 20) break;
  }
  return [...found];
}

/** Can a person looking through this audience see the post? (Used to decide who may be notified or tagged.) */
const seesAudience = (audience, rel) => audience === 'public' || (audience === 'friends' && rel.friends);

/** Works out who a caption mentions, and refuses the whole post if someone does not accept mentions from the author. */
export async function checkMentions(db, me, caption) {
  const names = parseMentions(caption);
  if (!names.length) return [];
  const rows = await q(db, `SELECT id, username FROM users WHERE username IN (${names.map(() => '?').join(',')}) AND status = 'active' AND deleted_at IS NULL`, names);
  const people = [];
  const refused = [];
  for (const r of rows) {
    const id = fromBin(r.id);
    if (id === me) continue;
    const rel = await relation(db, me, id);
    if (rel.blocked) continue; // acts like an unknown name, so a block is never revealed
    const privacy = await privacyOf(db, id);
    if (mayDo(privacy.who_can_mention, rel)) people.push({ id, username: r.username });
    else refused.push(r.username);
  }
  if (refused.length) {
    throw new AppError(422, 'mention_not_allowed', 'Some people don’t accept mentions from you.', [
      { field: 'caption', message: `You can’t mention ${refused.map((n) => `@${n}`).join(', ')}.` },
    ]);
  }
  return people;
}

/** Makes post_mentions match the caption, and tells newly mentioned people who are able to see the post. */
export async function syncMentions(c, postId, me, people, audience) {
  const have = new Set((await q(c, 'SELECT user_id FROM post_mentions WHERE post_id = ?', [toBin(postId)])).map((r) => fromBin(r.user_id)));
  const want = new Map(people.map((p) => [p.id, p]));
  for (const id of have) if (!want.has(id)) await exec(c, 'DELETE FROM post_mentions WHERE post_id = ? AND user_id = ?', [toBin(postId), toBin(id)]);
  for (const [id] of want) {
    if (have.has(id)) continue;
    await exec(c, 'INSERT IGNORE INTO post_mentions (post_id, user_id) VALUES (?, ?)', [toBin(postId), toBin(id)]);
    const rel = await relation(c, me, id);
    if (seesAudience(audience, rel)) await notify(c, { recipient: id, actor: me, type: 'mention', postId });
  }
}

/** Tags people on a post. Everything is checked first; one problem refuses the whole request (nothing half-saved). */
export async function addTags(c, postId, me, audience, userIds) {
  const ids = [...new Set(userIds)].filter((id) => id !== me).slice(0, MAX_TAGS);
  if (!ids.length) return;
  if (audience === 'only_me') throw new AppError(422, 'tag_audience', 'A post only you can see can’t tag other people. Change the audience first.');
  const plan = [];
  const refused = [];
  for (const id of ids) {
    const [u] = await q(c, `SELECT id, username FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL`, [toBin(id)]);
    const rel = u ? await relation(c, me, id) : null;
    if (!u || rel.blocked) throw new AppError(422, 'tag_invalid', 'One of the people you tried to tag can’t be tagged.');
    if (audience === 'friends' && !rel.friends) {
      throw new AppError(422, 'tag_audience', `@${u.username} isn’t your friend, so they couldn’t see a friends-only post and can’t be tagged.`);
    }
    const privacy = await privacyOf(c, id);
    if (!mayDo(privacy.who_can_tag, rel)) refused.push(u.username);
    else plan.push({ id, status: privacy.review_tags ? 'pending' : 'approved' });
  }
  if (refused.length) throw new AppError(422, 'tag_not_allowed', `${refused.map((n) => `@${n}`).join(', ')} ${refused.length === 1 ? 'doesn’t' : 'don’t'} allow tags from you.`);
  for (const { id, status } of plan) {
    // An existing row is kept as it is, so a person who removed a tag is not tagged again behind their back.
    const r = await exec(c, 'INSERT INTO post_tags (post_id, tagged_user_id, tagged_by, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE post_id = post_id', [
      toBin(postId), toBin(id), toBin(me), status,
    ]);
    if (r.affectedRows === 1) await notify(c, { recipient: id, actor: me, type: 'tag', postId });
  }
}

/** After an audience change: take the tags off people who can no longer see the post. */
export async function pruneTags(c, postId, authorId, audience) {
  if (audience === 'public') return;
  if (audience === 'only_me') {
    await exec(c, "UPDATE post_tags SET status = 'removed', responded_at = NOW(3) WHERE post_id = ? AND status <> 'removed'", [toBin(postId)]);
    return;
  }
  await exec(
    c,
    `UPDATE post_tags t SET t.status = 'removed', t.responded_at = NOW(3)
      WHERE t.post_id = ? AND t.status <> 'removed'
        AND NOT EXISTS (SELECT 1 FROM friendships fr WHERE fr.status = 'accepted'
              AND ((fr.requester_id = ? AND fr.addressee_id = t.tagged_user_id) OR (fr.requester_id = t.tagged_user_id AND fr.addressee_id = ?)))`,
    [toBin(postId), toBin(authorId), toBin(authorId)],
  );
}

/** Removes a tag. Allowed for the tagged person (remove myself) and for the post's author. Safe to repeat. */
export async function removeTag(me, postId, userId) {
  const [row] = await q(pool, 'SELECT p.author_id FROM posts p WHERE p.id = ? AND p.deleted_at IS NULL', [toBin(postId)]);
  if (!row || (fromBin(row.author_id) !== me && userId !== me)) throw new AppError(404, 'not_found', 'Tag not found.');
  const r = await exec(pool, "UPDATE post_tags SET status = 'removed', responded_at = NOW(3) WHERE post_id = ? AND tagged_user_id = ? AND status <> 'removed'", [toBin(postId), toBin(userId)]);
  return { removed: r.affectedRows > 0 };
}

/** The tagged person approves a pending tag so the post can show on their profile. Only they can do it. */
export async function approveTag(me, postId) {
  const r = await exec(pool, "UPDATE post_tags SET status = 'approved', responded_at = NOW(3) WHERE post_id = ? AND tagged_user_id = ? AND status = 'pending'", [toBin(postId), toBin(me)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'There is no pending tag to approve.');
  return { status: 'approved' };
}

/** Tags waiting for my approval (only for posts I am still allowed to see). */
export async function pendingTags(me) {
  const rows = await q(
    pool,
    `SELECT t.post_id, t.created_at, p.caption, u.username, u.full_name, u.avatar_key, m.storage_key
       FROM post_tags t JOIN posts p ON p.id = t.post_id JOIN users u ON u.id = p.author_id
       LEFT JOIN post_media m ON m.post_id = p.id AND m.position = 0
      WHERE t.tagged_user_id = ? AND t.status = 'pending' AND ${postVisibleSql('p', 'u')}
      ORDER BY t.created_at DESC LIMIT 50`,
    [toBin(me), ...postVisParams(me)],
  );
  return rows.map((r) => ({
    postId: fromBin(r.post_id),
    createdAt: r.created_at.toISOString(),
    caption: r.caption,
    thumbUrl: r.storage_key && /\.(jpg|png|gif|webp)$/.test(r.storage_key) ? mediaUrl(r.storage_key) : null,
    author: { username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) },
  }));
}

/**
 * Tags to show next to a list of posts. Everyone who can see the post sees approved tags (except people who blocked or
 * were blocked by the viewer). The post's author and the tagged person also see their own pending tags.
 */
export async function tagsFor(db, postIds, me) {
  const map = new Map(postIds.map((id) => [id, []]));
  if (!postIds.length) return map;
  const rows = await q(
    db,
    `SELECT t.post_id, t.status, t.tagged_user_id, u.username, u.full_name, u.avatar_key, p.author_id
       FROM post_tags t JOIN users u ON u.id = t.tagged_user_id JOIN posts p ON p.id = t.post_id
      WHERE t.post_id IN (${postIds.map(() => '?').join(',')}) AND t.status <> 'removed' AND u.status = 'active' AND u.deleted_at IS NULL
        AND ${NOT_BLOCKED('t.tagged_user_id')}
      ORDER BY t.created_at`,
    [...postIds.map(toBin), toBin(me), toBin(me)],
  );
  for (const r of rows) {
    const tagged = fromBin(r.tagged_user_id);
    const isAuthor = fromBin(r.author_id) === me;
    if (r.status === 'pending' && !isAuthor && tagged !== me) continue;
    map.get(fromBin(r.post_id)).push({ id: tagged, username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key), status: r.status });
  }
  return map;
}
