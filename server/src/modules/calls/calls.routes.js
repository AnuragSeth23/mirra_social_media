import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { isId } from '../../lib/ids.js';
import { requireAuth } from '../../middleware/auth.js';
import { callLimiter } from '../../middleware/user-limits.js';
import { validateBody } from '../../middleware/validate.js';
import * as svc from './calls.service.js';

export const callsRouter = Router();
callsRouter.use(requireAuth);

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

const startSchema = z.object({ conversationId: z.string().refine(isId, 'Invalid id.'), kind: z.enum(['voice', 'video']) });
// One handshake note: an SDP offer/answer ({ type, sdp }) or an ICE candidate ({ candidate, sdpMid, sdpMLineIndex, ... }).
const signalSchema = z.object({ type: z.enum(['offer', 'answer', 'ice']), payload: z.record(z.string(), z.any()) });

callsRouter.post('/', callLimiter, validateBody(startSchema), wrap((req) => svc.start(req.auth.userId, req.body.conversationId, req.body.kind)));
callsRouter.get('/incoming', wrap((req) => svc.incoming(req.auth.userId))); // before '/:id'
callsRouter.get('/:id', wrap((req) => svc.get(req.auth.userId, id(req.params.id), Math.max(0, parseInt(String(req.query.after ?? '0'), 10) || 0))));
callsRouter.post('/:id/signal', validateBody(signalSchema), wrap((req) => svc.signal(req.auth.userId, id(req.params.id), req.body.type, req.body.payload)));
callsRouter.post('/:id/answer', wrap((req) => svc.answer(req.auth.userId, id(req.params.id))));
callsRouter.post('/:id/decline', wrap((req) => svc.end(req.auth.userId, id(req.params.id))));
callsRouter.post('/:id/end', wrap((req) => svc.end(req.auth.userId, id(req.params.id))));
