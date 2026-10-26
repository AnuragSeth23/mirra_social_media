import path from 'node:path';
import express, { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isUuid } from '../../lib/ids.js';
import { KEY_RE, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, UPLOAD_DIR, mediaSignatureOk, saveMedia } from '../../lib/media.js';
import { requireAuth } from '../../middleware/auth.js';
import { commentLimiter, postLimiter, uploadLimiter } from '../../middleware/user-limits.js';
import { validateBody } from '../../middleware/validate.js';
import * as svc from './posts.service.js';
import * as tagging from './tagging.js';

export const postsRouter = Router();
export const mediaRouter = Router();
postsRouter.use(requireAuth);

const wrap = (fn) => async (req, res, next) => {
  try {
    const data = await fn(req);
    data === undefined ? res.status(204).end() : res.json({ data });
  } catch (e) {
    next(e);
  }
};
const id = (v) => {
  if (typeof v !== 'string' || !isUuid(v)) throw new AppError(404, 'not_found', 'Not found.');
  return v;
};
const me = (req) => req.auth.userId;
const before = (req) => (typeof req.query.before === 'string' && isUuid(req.query.before) ? req.query.before : undefined);

// Photos and videos: raw bytes in the body (no multipart dependency). Served back from /api/v1/media/<key> with Range support.
// Two parsers so an image can never make the server buffer more than 5 MB before it is checked.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
mediaRouter.post(
  '/',
  requireAuth,
  uploadLimiter,
  express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
  express.raw({ type: VIDEO_TYPES, limit: MAX_VIDEO_BYTES }),
  wrap(async (req) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError(415, 'unsupported_media', 'Upload a JPG, PNG, WebP or GIF image, or an MP4 or WebM video.');
    return saveMedia(req.body);
  }),
);
// private: browsers may cache these, shared proxies and CDNs may not (a private account's photo must not be stored publicly).
// Files are served only with a valid, unexpired signature (see lib/media.js). The signed URL is created by the API
// only for people who may see the post, story or photo, so direct links cannot be guessed or reused later.
mediaRouter.get('/:key', (req, res, next) => {
  const { key } = req.params;
  if (!KEY_RE.test(key) || !mediaSignatureOk(key, req.query.e, req.query.s)) return next(new AppError(403, 'media_forbidden', 'This link is not valid or has expired.'));
  res.setHeader('Cache-Control', 'private, max-age=21600');
  res.sendFile(path.join(UPLOAD_DIR, key), { dotfiles: 'deny' }, (err) => {
    if (err) next(err.code === 'ENOENT' ? new AppError(404, 'not_found', 'Not found.') : err);
  });
});

const createSchema = z.object({
  caption: z.string().trim().max(2200, 'Keep it under 2,200 characters.').default(''),
  mediaKey: z.string().regex(KEY_RE).optional(),
  // A reel can be several photos and videos: [{ key, durationMs }]. A photo's time is 1-30 s (5 s when not given).
  items: z.array(z.object({ key: z.string().regex(KEY_RE), durationMs: z.number().int().min(1000, 'A photo must show for at least 1 second.').max(30_000, 'A photo can show for 30 seconds at most.').optional() })).max(10, 'A reel can have up to 10 photos and videos.').optional(),
  kind: z.enum(['post', 'reel']).default('post'),
  audience: z.enum(svc.AUDIENCES).optional(),
  tagUserIds: z.array(z.string().refine(isUuid, 'Invalid id.')).max(20, 'You can tag up to 20 people.').optional(),
}).strict();
const editSchema = z
  .object({
    caption: z.string().trim().max(2200, 'Keep it under 2,200 characters.').optional(),
    audience: z.enum(svc.AUDIENCES).optional(),
  })
  .strict()
  .refine((v) => v.caption !== undefined || v.audience !== undefined, 'Change the caption or the audience.');
const commentSchema = z.object({
  parentId: z.string().refine(isUuid, 'Invalid id.').optional(),
  body: z.string().trim().min(1, 'Write something first.').max(2200, 'Keep it under 2,200 characters.'),
});

postsRouter.get(
  '/feed',
  wrap((req) => svc.feed(me(req), before(req))),
);
postsRouter.get(
  '/discover',
  wrap((req) => svc.discover(me(req), before(req))),
);
postsRouter.get(
  '/reels',
  wrap((req) => svc.reels(me(req), before(req))),
);
postsRouter.get(
  '/explore',
  wrap((req) => svc.explore(me(req), before(req))),
);
postsRouter.get(
  '/saved',
  wrap((req) => svc.savedPosts(me(req), before(req))),
);
postsRouter.get(
  '/tags',
  wrap((req) => svc.searchTags(typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '')),
);
postsRouter.get(
  '/tag/:tag',
  wrap((req) => svc.postsByTag(me(req), String(req.params.tag).slice(0, 60), before(req))),
);
postsRouter.get(
  '/by/:username',
  wrap((req) => svc.userPosts(me(req), String(req.params.username), before(req))),
);
postsRouter.post(
  '/',
  postLimiter,
  validateBody(createSchema),
  wrap((req) => svc.createPost(me(req), req.body.caption, req.body.mediaKey, req.body.kind, req.body.audience, req.body.tagUserIds, req.body.items)),
);
postsRouter.get(
  '/tagged/:username',
  wrap((req) => svc.taggedPosts(me(req), String(req.params.username), before(req))),
);
postsRouter.get(
  '/tag-requests',
  wrap((req) => tagging.pendingTags(me(req))),
);
postsRouter.post(
  '/:id/tag/approve',
  wrap((req) => tagging.approveTag(me(req), id(req.params.id))),
);
postsRouter.post(
  '/:id/tag/remove',
  wrap((req) => tagging.removeTag(me(req), id(req.params.id), me(req))),
);
postsRouter.delete(
  '/:id/tags/:userId',
  wrap((req) => tagging.removeTag(me(req), id(req.params.id), id(req.params.userId))),
);
postsRouter.get(
  '/:id',
  wrap((req) => svc.getPost(me(req), id(req.params.id))),
);
postsRouter.patch(
  '/:id',
  postLimiter,
  validateBody(editSchema),
  wrap((req) => svc.editPost(me(req), id(req.params.id), req.body)),
);
postsRouter.delete(
  '/:id',
  wrap(async (req) => {
    await svc.deletePost(me(req), id(req.params.id));
  }),
);
postsRouter.put(
  '/:id/like',
  wrap((req) => svc.setLike(me(req), id(req.params.id), true)),
);
postsRouter.delete(
  '/:id/like',
  wrap((req) => svc.setLike(me(req), id(req.params.id), false)),
);
postsRouter.put(
  '/:id/save',
  wrap((req) => svc.setSaved(me(req), id(req.params.id), true)),
);
postsRouter.delete(
  '/:id/save',
  wrap((req) => svc.setSaved(me(req), id(req.params.id), false)),
);
postsRouter.post(
  '/:id/share',
  wrap((req) => svc.share(me(req), id(req.params.id))),
);
postsRouter.get(
  '/:id/comments',
  wrap((req) => svc.listComments(me(req), id(req.params.id))),
);
postsRouter.post(
  '/:id/comments',
  commentLimiter,
  validateBody(commentSchema),
  wrap((req) => svc.addComment(me(req), id(req.params.id), req.body.body, req.body.parentId)),
);
postsRouter.delete(
  '/:id/comments/:cid',
  wrap(async (req) => {
    await svc.deleteComment(me(req), id(req.params.id), id(req.params.cid));
  }),
);
