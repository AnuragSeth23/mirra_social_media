import { exec, q } from '../db/pool.js';
import { toBin } from './ids.js';

const TAG_RE = /(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,50})/gu;
const MAX_TAGS = 30;

/** Unique lower-case hashtags in a caption, in order of first use. "#Sunset #sunset" gives ["sunset"]. */
export function extractTags(caption) {
  const seen = new Set();
  for (const m of caption.matchAll(TAG_RE)) {
    seen.add(m[1].toLowerCase());
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** Makes post_hashtags match the caption and keeps hashtags.post_count in step. Safe to call again after an edit. */
export async function syncTags(c, postId, caption) {
  const want = new Set(extractTags(caption));
  const have = await q(c, 'SELECT h.id, h.tag FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = ?', [toBin(postId)]);
  const haveTags = new Set(have.map((h) => h.tag));

  for (const h of have.filter((x) => !want.has(x.tag))) {
    await exec(c, 'DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id = ?', [toBin(postId), h.id]);
    await exec(c, 'UPDATE hashtags SET post_count = GREATEST(post_count, 1) - 1 WHERE id = ?', [h.id]);
  }
  for (const tag of [...want].filter((t) => !haveTags.has(t))) {
    await exec(c, 'INSERT IGNORE INTO hashtags (tag) VALUES (?)', [tag]);
    const [row] = await q(c, 'SELECT id FROM hashtags WHERE tag = ?', [tag]);
    const r = await exec(c, 'INSERT IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?)', [toBin(postId), row.id]);
    if (r.affectedRows) await exec(c, 'UPDATE hashtags SET post_count = post_count + 1 WHERE id = ?', [row.id]);
  }
}

/** Takes a post's tags out of the counts, used when a post is deleted. */
export async function dropTags(c, postId) {
  await exec(c, 'UPDATE hashtags h JOIN post_hashtags ph ON ph.hashtag_id = h.id SET h.post_count = GREATEST(h.post_count, 1) - 1 WHERE ph.post_id = ?', [toBin(postId)]);
  await exec(c, 'DELETE FROM post_hashtags WHERE post_id = ?', [toBin(postId)]);
}
