import { exec, pool, q, tx } from '../../db/pool.js';
import { NOT_BLOCKED } from '../../lib/blocks.js';
import { AppError } from '../../lib/errors.js';
import { dropTags, syncTags } from '../../lib/hashtags.js';
import { fromBin, toBin, uuidv7 } from '../../lib/ids.js';
import { mediaTypeOf, mediaUrl, requireMedia } from '../../lib/media.js';
import { POST_VIS_N, privacyOf, postVisibleSql, relation } from '../../lib/permissions.js';
import { notify } from '../notifications/notifications.service.js';
import { addTags, checkMentions, pruneTags, syncMentions, tagsFor } from './tagging.js';

// Who may see a post is decided in one place (lib/permissions.js): public / friends / only me, private accounts, blocks.
const VISIBLE = postVisibleSql('p', 'u');
const VIS_N = POST_VIS_N;

// Placeholders in the select list: liked(me), saved(me) = 2.
const SELECT = `SELECT p.id, p.author_id, p.kind, p.audience, p.caption, p.like_count, p.comment_count, p.share_count, p.created_at,
    u.username, u.full_name, u.avatar_key, m.storage_key, m.media_type,
    EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked,
    EXISTS (SELECT 1 FROM saved_posts s WHERE s.post_id = p.id AND s.user_id = ?) AS saved
  FROM posts p JOIN users u ON u.id = p.author_id
  LEFT JOIN post_media m ON m.post_id = p.id AND m.position = 0`;
const SEL_N = 2;

const bins = (me, n) => Array.from({ length: n }, () => toBin(me));
/** Leading params for any query built from SELECT ... WHERE VISIBLE. */
const sel = (me) => bins(me, SEL_N);
const vis = (me) => bins(me, VIS_N);

function toDto(r, me) {
  const authorId = fromBin(r.author_id);
  return {
    id: fromBin(r.id),
    author: { id: authorId, username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) },
    kind: r.kind,
    audience: r.audience,
    caption: r.caption,
    mediaUrl: mediaUrl(r.storage_key),
    mediaType: r.media_type ?? null,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    shareCount: r.share_count,
    liked: !!r.liked,
    saved: !!r.saved,
    mine: authorId === me,
    tags: [],
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Adds the (approved) tags and, for reels, the list of photos/videos (`items`, in order, with each photo's time) to a list of post DTOs,
 * with one extra query each. `mediaUrl`/`mediaType` stay the FIRST item, so everything that shows a single picture keeps working.
 */
async function withTags(posts, me) {
  const map = await tagsFor(pool, posts.map((p) => p.id), me);
  const media = posts.length ? await q(pool, 'SELECT post_id, media_type, storage_key, duration_ms FROM post_media WHERE post_id IN (?) ORDER BY post_id, position', [posts.map((p) => toBin(p.id))]) : [];
  for (const p of posts) {
    p.tags = map.get(p.id) ?? [];
    p.items = media.filter((m) => fromBin(m.post_id) === p.id).map((m) => ({ mediaUrl: mediaUrl(m.storage_key), mediaType: m.media_type, durationMs: m.duration_ms }));
  }
  return posts;
}

export const AUDIENCES = ['public', 'friends', 'only_me'];

export const REEL_MAX_ITEMS = 10;
export const IMAGE_SECONDS_DEFAULT = 5; // a photo in a reel plays this long unless the author chose another time
const IMAGE_MS_MIN = 1000;
const IMAGE_MS_MAX = 30_000;
const clampMs = (v) => Math.min(IMAGE_MS_MAX, Math.max(IMAGE_MS_MIN, Math.round(Number(v) || IMAGE_SECONDS_DEFAULT * 1000)));

/**
 * A post has one photo or video; a reel has 1 to REEL_MAX_ITEMS photos and/or videos, played one after another.
 * `items` is [{ key, durationMs? }]; the older single `mediaKey` still works. A photo's time (durationMs) is kept between 1 and 30 s.
 */
export async function createPost(me, caption, mediaKey, kind = 'post', audience, tagUserIds = [], items = []) {
  const list = items.length ? items : mediaKey ? [{ key: mediaKey }] : [];
  if (kind === 'reel' && !list.length) throw new AppError(422, 'reel_needs_media', 'A reel needs at least one photo or video.');
  if (!caption && !list.length) throw new AppError(422, 'empty_post', 'Add a photo or video, or write something.');
  if (list.length > 1 && kind !== 'reel') throw new AppError(422, 'too_many_media', 'Only a reel can have more than one photo or video.');
  if (list.length > REEL_MAX_ITEMS) throw new AppError(422, 'too_many_media', `A reel can have up to ${REEL_MAX_ITEMS} photos and videos.`);
  for (const it of list) await requireMedia(it.key);
  // No audience sent: use the author's own default (never a value the client invents for someone else).
  const chosen = audience ?? (await privacyOf(pool, me)).default_post_audience;
  const mentions = await checkMentions(pool, me, caption); // refuses people who do not accept mentions
  const id = uuidv7();
  await tx(async (c) => {
    await exec(c, 'INSERT INTO posts (id, author_id, kind, audience, caption) VALUES (?, ?, ?, ?, ?)', [toBin(id), toBin(me), kind, chosen, caption]);
    for (const [position, it] of list.entries()) {
      const type = mediaTypeOf(it.key);
      // Only photos in a reel have a set time; a video plays for its own length.
      const duration = type === 'image' && kind === 'reel' ? clampMs(it.durationMs ?? IMAGE_SECONDS_DEFAULT * 1000) : null;
      await exec(c, 'INSERT INTO post_media (id, post_id, position, media_type, storage_key, duration_ms) VALUES (?, ?, ?, ?, ?, ?)', [toBin(uuidv7()), toBin(id), position, type, it.key, duration]);
    }
    await exec(c, 'UPDATE users SET posts_count = posts_count + 1 WHERE id = ?', [toBin(me)]);
    await syncTags(c, id, caption);
    await syncMentions(c, id, me, mentions, chosen);
    await addTags(c, id, me, chosen, tagUserIds);
  });
  return getPost(me, id);
}

export async function getPost(me, id) {
  const rows = await q(pool, `${SELECT} WHERE p.id = ? AND ${VISIBLE}`, [...sel(me), toBin(id), ...vis(me)]);
  if (!rows[0]) throw new AppError(404, 'not_found', 'This post is not available.');
  const [dto] = await withTags([toDto(rows[0], me)], me);
  return dto;
}

/**
 * Small cards for posts and reels shared inside a chat, built for the person who is looking: a post they are not allowed to
 * see (private account, friends-only, blocked, deleted) is left out of the map and the chat shows "no longer available".
 */
export async function postPreviews(me, ids) {
  if (!ids.length) return new Map();
  const rows = await q(pool, `${SELECT} WHERE p.id IN (?) AND ${VISIBLE}`, [...sel(me), ids.map(toBin), ...vis(me)]);
  return new Map(
    rows.map((r) => [
      fromBin(r.id),
      {
        id: fromBin(r.id),
        kind: r.kind,
        caption: (r.caption ?? '').slice(0, 140),
        mediaUrl: mediaUrl(r.storage_key),
        mediaType: r.media_type ?? null,
        author: { username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) },
      },
    ]),
  );
}

/**
 * The author can change the caption (hashtags and mentions follow along) and/or the audience.
 * A text-only post cannot be emptied. Making the audience stricter also removes the tags of people who can no longer see it.
 */
export async function editPost(me, id, { caption, audience }) {
  const mentions = caption !== undefined ? await checkMentions(pool, me, caption) : null;
  await tx(async (c) => {
    const [row] = await q(c, `SELECT p.audience, p.caption, EXISTS (SELECT 1 FROM post_media m WHERE m.post_id = p.id) AS has_media FROM posts p WHERE p.id = ? AND p.author_id = ? AND p.deleted_at IS NULL FOR UPDATE`, [
      toBin(id),
      toBin(me),
    ]);
    if (!row) throw new AppError(404, 'not_found', 'Post not found.');
    const newCaption = caption ?? row.caption;
    const newAudience = audience ?? row.audience;
    if (!newCaption && !row.has_media) throw new AppError(422, 'empty_post', 'A post needs a caption or a photo or video.');
    await exec(c, 'UPDATE posts SET caption = ?, audience = ? WHERE id = ?', [newCaption, newAudience, toBin(id)]);
    if (caption !== undefined) {
      await syncTags(c, id, newCaption);
      await syncMentions(c, id, me, mentions, newAudience);
    }
    if (newAudience !== row.audience) await pruneTags(c, id, me, newAudience);
  });
  return getPost(me, id);
}

const paginate = async (rows, me, limit) => {
  const posts = await withTags(rows.slice(0, limit).map((r) => toDto(r, me)), me);
  return { posts, nextCursor: rows.length > limit ? posts[posts.length - 1].id : null };
};
const cursorSql = (before) => (before ? { sql: 'AND p.id < ?', args: [toBin(before)] } : { sql: '', args: [] });

/** Newest first: my posts, people I follow, and my friends. Cursor = last post id (UUIDv7 ids sort by time). */
export async function feed(me, before, limit = 10) {
  const cur = cursorSql(before);
  const rows = await q(
    pool,
    `${SELECT} WHERE ${VISIBLE}
       AND (p.author_id = ? OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ? AND status = 'accepted')
            OR p.author_id IN (SELECT addressee_id FROM friendships WHERE requester_id = ? AND status = 'accepted')
            OR p.author_id IN (SELECT requester_id FROM friendships WHERE addressee_id = ? AND status = 'accepted'))
       ${cur.sql} ORDER BY p.id DESC LIMIT ${limit + 1}`,
    [...sel(me), ...vis(me), ...bins(me, 4), ...cur.args],
  );
  return paginate(rows, me, limit);
}

/**
 * "Suggested for you": newest public posts from people I don't follow (and not me). The home screen shows these once the
 * posts from people I follow run out, so a brand-new account with nobody to follow still has something to look at.
 * Private accounts and anyone blocked either way never appear (the shared VISIBLE rule plus is_private = 0).
 */
export async function discover(me, before, limit = 10) {
  const cur = cursorSql(before);
  const rows = await q(
    pool,
    `${SELECT} WHERE ${VISIBLE} AND u.is_private = 0 AND p.audience = 'public' AND p.author_id <> ?
       AND p.author_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ? AND status = 'accepted')
       AND p.author_id NOT IN (SELECT addressee_id FROM friendships WHERE requester_id = ? AND status = 'accepted')
       AND p.author_id NOT IN (SELECT requester_id FROM friendships WHERE addressee_id = ? AND status = 'accepted')
       ${cur.sql} ORDER BY p.id DESC LIMIT ${limit + 1}`,
    [...sel(me), ...vis(me), ...bins(me, 4), ...cur.args],
  );
  return paginate(rows, me, limit);
}

/** One person's posts, newest first, honouring the same visibility rules as the feed. */
export async function userPosts(me, username, before, limit = 10) {
  const cur = cursorSql(before);
  const rows = await q(pool, `${SELECT} WHERE ${VISIBLE} AND u.username = ? ${cur.sql} ORDER BY p.id DESC LIMIT ${limit + 1}`, [...sel(me), ...vis(me), username.toLowerCase(), ...cur.args]);
  return paginate(rows, me, limit);
}

/** Short vertical videos from anyone I'm allowed to see. */
export async function reels(me, before, limit = 6) {
  const cur = cursorSql(before);
  const rows = await q(pool, `${SELECT} WHERE ${VISIBLE} AND p.kind = 'reel' ${cur.sql} ORDER BY p.id DESC LIMIT ${limit + 1}`, [...sel(me), ...vis(me), ...cur.args]);
  return paginate(rows, me, limit);
}

/** Recent photos and videos from public accounts, excluding mine. */
export async function explore(me, before, limit = 24) {
  const cur = cursorSql(before);
  const rows = await q(
    pool,
    `${SELECT} WHERE ${VISIBLE} AND u.is_private = 0 AND p.audience = 'public' AND p.author_id <> ? AND m.storage_key IS NOT NULL ${cur.sql}
      ORDER BY p.id DESC LIMIT ${limit + 1}`,
    [...sel(me), ...vis(me), toBin(me), ...cur.args],
  );
  return paginate(rows, me, limit);
}

export async function savedPosts(me, before, limit = 12) {
  const cur = cursorSql(before);
  const rows = await q(
    pool,
    `${SELECT} JOIN saved_posts sv ON sv.post_id = p.id AND sv.user_id = ?
      WHERE ${VISIBLE} ${cur.sql} ORDER BY p.id DESC LIMIT ${limit + 1}`,
    [...sel(me), toBin(me), ...vis(me), ...cur.args],
  );
  return paginate(rows, me, limit);
}

/** Posts that use one hashtag. */
export async function postsByTag(me, tag, before, limit = 24) {
  const cur = cursorSql(before);
  const rows = await q(
    pool,
    `${SELECT} JOIN post_hashtags ph ON ph.post_id = p.id JOIN hashtags h ON h.id = ph.hashtag_id
      WHERE ${VISIBLE} AND h.tag = ? ${cur.sql} ORDER BY p.id DESC LIMIT ${limit + 1}`,
    [...sel(me), ...vis(me), tag.toLowerCase(), ...cur.args],
  );
  return paginate(rows, me, limit);
}

/**
 * The "Tagged" tab of a profile: posts where this person's tag is approved. Two checks apply: the viewer must be allowed to
 * look at that profile's posts (private account rules), and the viewer must be allowed to see each post itself.
 * Being tagged never grants access to a post.
 */
export async function taggedPosts(me, username, before, limit = 12) {
  const [target] = await q(pool, `SELECT id, is_private FROM users WHERE username = ? AND status = 'active' AND deleted_at IS NULL`, [username.toLowerCase()]);
  if (!target) throw new AppError(404, 'not_found', 'No account with that username.');
  const targetId = fromBin(target.id);
  const rel = await relation(pool, me, targetId);
  if (rel.blocked) throw new AppError(404, 'not_found', 'No account with that username.');
  if (!(rel.self || !target.is_private || rel.iFollow || rel.friends)) throw new AppError(403, 'private_account', 'This account is private.');
  const cur = cursorSql(before);
  const rows = await q(
    pool,
    `${SELECT} JOIN post_tags pt ON pt.post_id = p.id AND pt.tagged_user_id = ? AND pt.status = 'approved'
      WHERE ${VISIBLE} ${cur.sql} ORDER BY p.id DESC LIMIT ${limit + 1}`,
    [...sel(me), toBin(targetId), ...vis(me), ...cur.args],
  );
  return paginate(rows, me, limit);
}

export async function searchTags(text) {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[%_\\]/g, '');
  if (!t) {
    // Nothing typed: trending hashtags, counted from live public posts of the last 30 days (private accounts never count).
    const hot = await q(
      pool,
      `SELECT h.tag, COUNT(*) AS n FROM post_hashtags ph
         JOIN hashtags h ON h.id = ph.hashtag_id JOIN posts p ON p.id = ph.post_id JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status = 'active' AND u.is_private = 0 AND p.audience = 'public' AND p.created_at > NOW(3) - INTERVAL 30 DAY
        GROUP BY h.id, h.tag ORDER BY n DESC, h.tag LIMIT 10`,
    );
    return hot.map((r) => ({ tag: r.tag, postCount: Number(r.n) }));
  }
  // Counts come from live, public posts of public accounts only, so a hashtag never reveals friends-only or private activity.
  const rows = await q(
    pool,
    `SELECT h.tag, COUNT(*) AS n FROM hashtags h
       JOIN post_hashtags ph ON ph.hashtag_id = h.id JOIN posts p ON p.id = ph.post_id JOIN users u ON u.id = p.author_id
      WHERE h.tag LIKE ? AND p.deleted_at IS NULL AND p.audience = 'public' AND u.is_private = 0 AND u.status = 'active' AND u.deleted_at IS NULL
      GROUP BY h.id, h.tag ORDER BY n DESC, h.tag LIMIT 8`,
    [`${t}%`],
  );
  return rows.map((r) => ({ tag: r.tag, postCount: Number(r.n) }));
}

export async function setSaved(me, id, saved) {
  await getPost(me, id);
  if (saved) await exec(pool, 'INSERT IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)', [toBin(me), toBin(id)]);
  else await exec(pool, 'DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?', [toBin(me), toBin(id)]);
  return { saved };
}

export async function deletePost(me, id) {
  await tx(async (c) => {
    const r = await exec(c, 'UPDATE posts SET deleted_at = NOW(3) WHERE id = ? AND author_id = ? AND deleted_at IS NULL', [toBin(id), toBin(me)]);
    if (!r.affectedRows) throw new AppError(404, 'not_found', 'Post not found.');
    await exec(c, 'UPDATE users SET posts_count = GREATEST(posts_count, 1) - 1 WHERE id = ?', [toBin(me)]);
    await dropTags(c, id);
  });
}

/** Idempotent like/unlike: the counter only moves when a row was really added or removed. */
export async function setLike(me, id, liked) {
  const post = await getPost(me, id);
  await tx(async (c) => {
    const r = liked
      ? await exec(c, 'INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)', [toBin(id), toBin(me)])
      : await exec(c, 'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [toBin(id), toBin(me)]);
    if (r.affectedRows) await exec(c, `UPDATE posts SET like_count = GREATEST(CAST(like_count AS SIGNED) ${liked ? '+ 1' : '- 1'}, 0) WHERE id = ?`, [toBin(id)]);
    if (r.affectedRows && liked) await notify(c, { recipient: post.author.id, actor: me, type: 'post_like', postId: id });
  });
  const p = await getPost(me, id);
  return { liked: p.liked, likeCount: p.likeCount };
}

export async function share(me, id) {
  await getPost(me, id);
  await exec(pool, 'UPDATE posts SET share_count = share_count + 1 WHERE id = ?', [toBin(id)]);
  return { shareCount: (await getPost(me, id)).shareCount };
}

// ---------------------------------------------------------------- comments

const commentDto = (r, me, postAuthor) => {
  const authorId = fromBin(r.author_id);
  return {
    id: fromBin(r.id),
    parentId: r.parent_id ? fromBin(r.parent_id) : null,
    body: r.body,
    replies: [],
    mine: authorId === me,
    canDelete: authorId === me || postAuthor === me,
    createdAt: r.created_at.toISOString(),
    author: { id: authorId, username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key) },
  };
};

/** Top-level comments oldest first, each with its replies (one level deep). Comments by people I have a block with are hidden. */
export async function listComments(me, id) {
  const post = await getPost(me, id);
  // "Restrict": comments from people the post's author restricted are shown only to that person and to the author.
  const hideRestricted = post.author.id !== me;
  const rows = await q(
    pool,
    `SELECT c.id, c.parent_id, c.author_id, c.body, c.created_at, u.username, u.full_name, u.avatar_key
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.post_id = ? AND c.deleted_at IS NULL AND u.deleted_at IS NULL AND ${NOT_BLOCKED('c.author_id')}
        ${hideRestricted ? 'AND (c.author_id = ? OR NOT EXISTS (SELECT 1 FROM restrictions r WHERE r.restrictor_id = ? AND r.restricted_id = c.author_id))' : ''}
      ORDER BY c.id ASC LIMIT 500`,
    [toBin(id), ...bins(me, 2), ...(hideRestricted ? [toBin(me), toBin(post.author.id)] : [])],
  );
  const top = [];
  const byId = new Map();
  for (const r of rows) {
    const c = commentDto(r, me, post.author.id);
    byId.set(c.id, c);
    if (!c.parentId) top.push(c);
  }
  for (const c of byId.values()) if (c.parentId) byId.get(c.parentId)?.replies.push(c);
  return top;
}

export async function addComment(me, id, body, parentId) {
  const post = await getPost(me, id);
  const cid = uuidv7();
  let parentAuthor = null;
  await tx(async (c) => {
    if (parentId) {
      const [p] = await q(c, 'SELECT author_id, parent_id FROM comments WHERE id = ? AND post_id = ? AND deleted_at IS NULL FOR UPDATE', [toBin(parentId), toBin(id)]);
      if (!p) throw new AppError(404, 'not_found', 'The comment you are replying to is gone.');
      if (p.parent_id) throw new AppError(422, 'reply_depth', 'Reply to the original comment instead.');
      parentAuthor = fromBin(p.author_id);
      const [bk] = await q(c, 'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [toBin(me), p.author_id, p.author_id, toBin(me)]);
      if (bk) throw new AppError(404, 'not_found', 'The comment you are replying to is gone.');
      await exec(c, 'UPDATE comments SET reply_count = reply_count + 1 WHERE id = ?', [toBin(parentId)]);
    }
    await exec(c, 'INSERT INTO comments (id, post_id, author_id, parent_id, body) VALUES (?, ?, ?, ?, ?)', [toBin(cid), toBin(id), toBin(me), parentId ? toBin(parentId) : null, body]);
    await exec(c, 'UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [toBin(id)]);
    const quiet = async (owner) => (await relation(c, owner, me)).iRestricted; // owner restricted me: no notification
    if (parentAuthor && !(await quiet(parentAuthor))) await notify(c, { recipient: parentAuthor, actor: me, type: 'comment_reply', postId: id, commentId: cid });
    if (post.author.id !== parentAuthor && !(await quiet(post.author.id))) await notify(c, { recipient: post.author.id, actor: me, type: 'comment', postId: id, commentId: cid });
  });
  // Build the answer from the row we just wrote, not from a re-listing that could be capped or filtered.
  const [row] = await q(pool, `SELECT c.id, c.parent_id, c.author_id, c.body, c.created_at, u.username, u.full_name, u.avatar_key FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`, [
    toBin(cid),
  ]);
  return commentDto(row, me, post.author.id);
}

/** The comment's author or the post's author can delete it. Deleting a top-level comment removes its replies too. */
export async function deleteComment(me, postId, commentId) {
  await tx(async (c) => {
    const [row] = await q(
      c,
      `SELECT c.author_id, c.parent_id, p.author_id AS post_author FROM comments c JOIN posts p ON p.id = c.post_id
        WHERE c.id = ? AND c.post_id = ? AND c.deleted_at IS NULL AND p.deleted_at IS NULL FOR UPDATE`,
      [toBin(commentId), toBin(postId)],
    );
    if (!row || (fromBin(row.author_id) !== me && fromBin(row.post_author) !== me)) throw new AppError(404, 'not_found', 'Comment not found.');
    let removed = 1;
    await exec(c, 'UPDATE comments SET deleted_at = NOW(3) WHERE id = ?', [toBin(commentId)]);
    if (row.parent_id) {
      await exec(c, 'UPDATE comments SET reply_count = GREATEST(reply_count, 1) - 1 WHERE id = ?', [row.parent_id]);
    } else {
      const r = await exec(c, 'UPDATE comments SET deleted_at = NOW(3) WHERE parent_id = ? AND deleted_at IS NULL', [toBin(commentId)]);
      removed += r.affectedRows;
    }
    await exec(c, 'UPDATE posts SET comment_count = GREATEST(CAST(comment_count AS SIGNED) - ?, 0) WHERE id = ?', [removed, toBin(postId)]);
  });
}
