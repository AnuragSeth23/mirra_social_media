import { isUuid } from '../../lib/ids.js';
import { AppError } from '../../lib/errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { loginLimiter } from '../../middleware/rate-limit.js';
import { validateBody } from '../../middleware/validate.js';
import { passwordSchema } from '../auth/auth.schemas.js';
import * as svc from './account.service.js';
import * as twofactor from './twofactor.service.js';

export const accountRouter = Router();
accountRouter.use(requireAuth);

const wrap = (fn) => async (req, res, next) => {
  try {
    res.json({ data: await fn(req, res) });
  } catch (e) {
    next(e);
  }
};

const settingsSchema = z.object({
  messagesFrom: z.enum(['everyone', 'following', 'friends', 'nobody']).optional(),
  notifyLikes: z.boolean().optional(),
  notifyComments: z.boolean().optional(),
  notifyFollows: z.boolean().optional(),
  notifyMessages: z.boolean().optional(),
});
const changeSchema = z.object({ current: z.string().min(1, 'Enter your current password.').max(128), password: passwordSchema });
const deactivateSchema = z.object({ password: z.string().min(1, 'Enter your password.').max(128) });

accountRouter.get(
  '/settings',
  wrap((req) => svc.getSettings(req.auth.userId)),
);
accountRouter.patch(
  '/settings',
  validateBody(settingsSchema),
  wrap((req) => svc.updateSettings(req.auth.userId, req.body)),
);
accountRouter.post(
  '/change-password',
  loginLimiter,
  validateBody(changeSchema),
  wrap((req) => svc.changePassword(req.auth.userId, req.auth.sessionId, req.body.current, req.body.password)),
);
accountRouter.post(
  '/deactivate',
  loginLimiter,
  validateBody(deactivateSchema),
  wrap(async (req, res) => {
    const r = await svc.deactivate(req.auth.userId, req.body.password);
    res.clearCookie('socialambak_rt', { path: '/api/v1/auth' });
    return r;
  }),
);

// ---------------------------------------------------------------- sessions and two-factor sign-in

const codeSchema = z.object({ code: z.string().trim().min(6).max(14) }).strict();
const passwordAndCode = z.object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(14) }).strict();

accountRouter.get('/sessions', wrap((req) => svc.listSessions(req.auth.userId, req.auth.sessionId)));
accountRouter.post('/sessions/revoke-others', wrap((req) => svc.revokeOtherSessions(req.auth.userId, req.auth.sessionId)));
accountRouter.delete('/sessions/:id', wrap((req) => {
  if (!isUuid(req.params.id)) throw new AppError(404, 'not_found', 'Session not found.');
  return svc.revokeSession(req.auth.userId, req.params.id);
}));

accountRouter.get('/2fa', wrap((req) => twofactor.status(req.auth.userId)));
accountRouter.post('/2fa/setup', loginLimiter, wrap((req) => twofactor.setup(req.auth.userId)));
accountRouter.post('/2fa/enable', loginLimiter, validateBody(codeSchema), wrap((req) => twofactor.enable(req.auth.userId, req.body.code)));
accountRouter.post('/2fa/disable', loginLimiter, validateBody(passwordAndCode), wrap(async (req) => {
  await svc.checkPassword(req.auth.userId, req.body.password);
  return twofactor.disable(req.auth.userId, req.body.code);
}));
accountRouter.post('/2fa/backup-codes', loginLimiter, validateBody(passwordAndCode), wrap(async (req) => {
  await svc.checkPassword(req.auth.userId, req.body.password);
  return twofactor.regenerateBackupCodes(req.auth.userId, req.body.code);
}));
