import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isId } from '../../lib/ids.js';
import { KEY_RE } from '../../lib/media.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import * as svc from './stories.service.js';

export const storiesRouter = Router();
storiesRouter.use(requireAuth);

const wrap = (fn) => async (req, res, next) => {
  try {
    const data = await fn(req);
    data === undefined ? res.status(204).end() : res.json({ data });
  } catch (e) {
    next(e);
  }
};
const id = (v) => {
  if (typeof v !== 'string' || !isId(v)) throw new AppError(404, 'not_found', 'Not found.');
  return v;
};

const createSchema = z.object({ mediaKey: z.string().regex(KEY_RE), caption: z.string().trim().max(300).optional() });

storiesRouter.get(
  '/',
  wrap((req) => svc.tray(req.auth.userId)),
);
storiesRouter.post(
  '/',
  validateBody(createSchema),
  wrap((req) => svc.createStory(req.auth.userId, req.body.mediaKey, req.body.caption ?? null)),
);
storiesRouter.post(
  '/:id/view',
  wrap(async (req) => {
    await svc.markViewed(req.auth.userId, id(req.params.id));
  }),
);
storiesRouter.delete(
  '/:id',
  wrap(async (req) => {
    await svc.deleteStory(req.auth.userId, id(req.params.id));
  }),
);
