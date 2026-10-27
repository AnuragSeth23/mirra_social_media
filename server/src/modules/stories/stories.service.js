import { exec, pool, q } from '../../db/pool.js';
import { NOT_BLOCKED } from '../../lib/blocks.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { mediaTypeOf, mediaUrl, requireMedia } from '../../lib/media.js';

export async function createStory(me, mediaKey, caption) {
  await requireMedia(mediaKey);
  const { insertId } = await exec(pool, 'INSERT INTO stories (author_id, media_type, storage_key, caption) VALUES (?, ?, ?, ?)', [toBin(me), mediaTypeOf(mediaKey), mediaKey, caption || null]);
  return { id: String(insertId) };
}

/** Live (under 24 h) stories from me and the people I follow, grouped per person. Mine first, then unseen, then seen. */
export async function tray(me) {
  const rows = await q(
    pool,
    `SELECT s.id, s.author_id, s.media_type, s.storage_key, s.caption, s.created_at, s.view_count, u.username, u.full_name, u.avatar_key,
            EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = ?) AS viewed
       FROM stories s JOIN users u ON u.id = s.author_id
      WHERE s.expires_at > NOW(3) AND u.status = 'active' AND u.deleted_at IS NULL
        AND (s.author_id = ? OR s.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ? AND status = 'accepted'))
        AND ${NOT_BLOCKED('s.author_id')}
      ORDER BY s.created_at ASC`,
    [toBin(me), toBin(me), toBin(me), toBin(me), toBin(me)],
  );
  const groups = new Map();
  for (const r of rows) {
    const aid = fromBin(r.author_id);
    const g = groups.get(aid) ?? { author: { id: aid, username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) }, mine: aid === me, allViewed: true, items: [] };
    g.items.push({
      id: fromBin(r.id),
      mediaUrl: mediaUrl(r.storage_key),
      mediaType: r.media_type,
      caption: r.caption,
      createdAt: r.created_at.toISOString(),
      viewed: !!r.viewed,
      viewCount: aid === me ? r.view_count : 0,
    });
    if (!r.viewed) g.allViewed = false;
    groups.set(aid, g);
  }
  return [...groups.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(a.allViewed) - Number(b.allViewed));
}

export async function markViewed(me, storyId) {
  const r = await exec(
    pool,
    `INSERT IGNORE INTO story_views (story_id, viewer_id)
     SELECT s.id, ? FROM stories s WHERE s.id = ? AND s.expires_at > NOW(3) AND s.author_id <> ?
        AND (s.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ? AND status = 'accepted'))
        AND ${NOT_BLOCKED('s.author_id')}`,
    [toBin(me), toBin(storyId), toBin(me), toBin(me), toBin(me), toBin(me)],
  );
  if (r.affectedRows) await exec(pool, 'UPDATE stories SET view_count = view_count + 1 WHERE id = ?', [toBin(storyId)]);
}

export async function deleteStory(me, storyId) {
  const r = await exec(pool, 'DELETE FROM stories WHERE id = ? AND author_id = ?', [toBin(storyId), toBin(me)]);
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'Story not found.');
}
