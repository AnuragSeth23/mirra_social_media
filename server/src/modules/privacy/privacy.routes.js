import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import * as svc from './privacy.service.js';

export const privacyRouter = Router();
privacyRouter.use(requireAuth);

// Built from the field table, so an unknown key, a wrong value or a field the table does not list (for example "role",
// "user_id" or "status") is refused instead of being written: no mass assignment.
const shape = { isPrivate: z.boolean().optional() };
for (const [key, f] of Object.entries(svc.FIELDS)) shape[key] = (f.bool ? z.boolean() : z.enum(f.values)).optional();
const schema = z.object(shape).strict();

const wrap = (fn) => async (req, res, next) => {
  try {
    res.json({ data: await fn(req) });
  } catch (e) {
    next(e);
  }
};

privacyRouter.get('/', wrap((req) => svc.getPrivacy(req.auth.userId)));
privacyRouter.patch('/', validateBody(schema), wrap((req) => svc.updatePrivacy(req.auth.userId, req.body)));
