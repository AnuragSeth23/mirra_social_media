import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isUuid } from '../../lib/ids.js';
import { requireAuth } from '../../middleware/auth.js';
import { reportLimiter } from '../../middleware/user-limits.js';
import { validateBody } from '../../middleware/validate.js';
import * as svc from './safety.service.js';

export const safetyRouter = Router();
safetyRouter.use(requireAuth);

const wrap = (fn) => async (req, res, next) => {
  try {
    res.json({ data: await fn(req) });
  } catch (e) {
    next(e);
  }
};
const id = (v) => {
  if (typeof v !== 'string' || !isUuid(v)) throw new AppError(404, 'not_found', 'Not found.');
  return v;
};

const reportSchema = z.object({
  targetType: z.enum(['user', 'post', 'comment', 'message']),
  targetId: z.string().refine(isUuid, 'Invalid id.'),
  reason: z.enum(svc.REPORT_REASONS),
  details: z.string().trim().max(1000, 'Keep details under 1,000 characters.').optional(),
});

safetyRouter.get(
  '/restricted',
  wrap((req) => svc.restrictedList(req.auth.userId)),
);
safetyRouter.put(
  '/restrict/:id',
  wrap((req) => svc.restrict(req.auth.userId, id(req.params.id))),
);
safetyRouter.delete(
  '/restrict/:id',
  wrap((req) => svc.unrestrict(req.auth.userId, id(req.params.id))),
);
safetyRouter.get(
  '/blocked',
  wrap((req) => svc.blockedList(req.auth.userId)),
);
safetyRouter.put(
  '/block/:id',
  wrap((req) => svc.block(req.auth.userId, id(req.params.id))),
);
safetyRouter.delete(
  '/block/:id',
  wrap((req) => svc.unblock(req.auth.userId, id(req.params.id))),
);
safetyRouter.post(
  '/report',
  reportLimiter,
  validateBody(reportSchema),
  wrap((req) => svc.report(req.auth.userId, req.body.targetType, req.body.targetId, req.body.reason, req.body.details || null)),
);
