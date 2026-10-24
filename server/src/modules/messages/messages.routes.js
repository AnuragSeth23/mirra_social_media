import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isUuid } from '../../lib/ids.js';
import { requireAuth } from '../../middleware/auth.js';
import { messageLimiter } from '../../middleware/user-limits.js';
import { validateBody } from '../../middleware/validate.js';
import * as svc from './messages.service.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

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
const sendSchema = z.object({ body: z.string().trim().min(1, 'Write a message first.').max(4000, 'That message is too long.') });

messagesRouter.get(
  '/',
  wrap((req) => svc.conversations(req.auth.userId, req.query.folder === 'requests' ? 'requests' : 'inbox')),
);
messagesRouter.get(
  '/unread-count',
  wrap((req) => svc.unreadTotal(req.auth.userId)),
);
messagesRouter.post(
  '/with/:userId',
  wrap((req) => svc.openWith(req.auth.userId, id(req.params.userId))),
);
messagesRouter.post(
  '/:id/accept',
  wrap((req) => svc.acceptRequest(req.auth.userId, id(req.params.id))),
);
messagesRouter.post(
  '/:id/decline',
  wrap((req) => svc.declineRequest(req.auth.userId, id(req.params.id))),
);
messagesRouter.get(
  '/:id',
  wrap((req) => svc.thread(req.auth.userId, id(req.params.id), typeof req.query.after === 'string' && isUuid(req.query.after) ? req.query.after : undefined)),
);
messagesRouter.post(
  '/:id',
  messageLimiter,
  validateBody(sendSchema),
  wrap((req) => svc.send(req.auth.userId, id(req.params.id), req.body.body)),
);
