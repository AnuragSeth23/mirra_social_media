import { Router } from 'express';
import { z } from 'zod';
import { KEY_RE } from '../../lib/media.js';
import { followLimiter } from '../../middleware/user-limits.js';
import { validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { isUuid } from '../../lib/ids.js';
import { connections, getProfile, incomingRequests, publicProfile, respondToRequest, search, setFollow, suggestions, updateProfile } from './users.service.js';

export const usersRouter = Router();

usersRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await getProfile(req.auth.userId) });
  } catch (err) {
    next(err);
  }
});

// Only web links: zod's .url() also accepts javascript: and data: URLs, which would run script when the link is clicked.
function isHttpUrl(v) {
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

const editSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name.').max(60, 'Use 60 characters or fewer.').optional(),
  bio: z.string().trim().max(150, 'Keep your bio under 150 characters.').optional(),
  website: z
    .string()
    .trim()
    .max(200)
    .refine(isHttpUrl, 'Enter a full link starting with http:// or https://')
    .nullable()
    .or(z.literal('').transform(() => null))
    .optional(),
  isPrivate: z.boolean().optional(),
  avatarKey: z.string().regex(KEY_RE).nullable().optional(),
});

usersRouter.patch('/me', requireAuth, validateBody(editSchema), async (req, res, next) => {
  try {
    res.json({ data: await updateProfile(req.auth.userId, req.body) });
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/search', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await search(req.auth.userId, typeof req.query.q === 'string' ? req.query.q.slice(0, 50) : '') });
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/requests', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await incomingRequests(req.auth.userId) });
  } catch (err) {
    next(err);
  }
});

for (const method of ['put', 'delete']) {
  usersRouter[method]('/requests/:followerId', requireAuth, async (req, res, next) => {
    try {
      if (!isUuid(req.params.followerId)) throw new AppError(404, 'not_found', 'Not found.');
      res.json({ data: await respondToRequest(req.auth.userId, req.params.followerId, method === 'put') });
    } catch (err) {
      next(err);
    }
  });
}

usersRouter.get('/suggestions', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await suggestions(req.auth.userId) });
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/by/:username', requireAuth, async (req, res, next) => {
  try {
    res.json({ data: await publicProfile(req.auth.userId, req.params.username) });
  } catch (err) {
    next(err);
  }
});

usersRouter.get('/by/:username/connections', requireAuth, async (req, res, next) => {
  try {
    const type = req.query.type === 'following' ? 'following' : 'followers';
    res.json({ data: await connections(req.auth.userId, req.params.username, type) });
  } catch (err) {
    next(err);
  }
});

for (const method of ['put', 'delete']) {
  usersRouter[method]('/:id/follow', requireAuth, followLimiter, async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new AppError(404, 'not_found', 'Account not found.');
      res.json({ data: { following: await setFollow(req.auth.userId, req.params.id, method === 'put') } });
    } catch (err) {
      next(err);
    }
  });
}
