import { Router } from 'express';
import { z } from 'zod';
import { pool, q } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, isId } from '../../lib/ids.js';
import { requireAuth } from '../../middleware/auth.js';
import { friendLimiter } from '../../middleware/user-limits.js';
import { validateBody } from '../../middleware/validate.js';
import * as svc from './friends.service.js';

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

const wrap = (fn) => async (req, res, next) => {
  try {
    res.json({ data: await fn(req) });
  } catch (e) {
    next(e);
  }
};
const id = (v) => {
  if (typeof v !== 'string' || !isId(v)) throw new AppError(404, 'not_found', 'Not found.');
  return v;
};
const me = (req) => req.auth.userId;

const requestSchema = z.object({ userId: z.string().refine(isId, 'Invalid id.') }).strict();

friendsRouter.get('/', wrap((req) => svc.friendsOf(me(req), me(req))));
friendsRouter.get('/requests', wrap((req) => svc.requests(me(req), req.query.direction === 'outgoing' ? 'outgoing' : 'incoming')));
friendsRouter.get(
  '/of/:username',
  wrap(async (req) => {
    const [u] = await q(pool, `SELECT id FROM users WHERE username = ? AND status = 'active' AND deleted_at IS NULL`, [String(req.params.username).toLowerCase()]);
    if (!u) throw new AppError(404, 'not_found', 'No account with that username.');
    return svc.friendsOf(me(req), fromBin(u.id));
  }),
);
friendsRouter.post('/requests', friendLimiter, validateBody(requestSchema), wrap((req) => svc.sendRequest(me(req), req.body.userId)));
friendsRouter.post('/requests/:userId/accept', friendLimiter, wrap((req) => svc.accept(me(req), id(req.params.userId))));
friendsRouter.post('/requests/:userId/reject', friendLimiter, wrap((req) => svc.reject(me(req), id(req.params.userId))));
friendsRouter.delete('/requests/:userId', friendLimiter, wrap((req) => svc.cancel(me(req), id(req.params.userId))));
friendsRouter.delete('/:userId', friendLimiter, wrap((req) => svc.unfriend(me(req), id(req.params.userId))));
