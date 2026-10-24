import { z } from 'zod';
import { Router } from 'express';
import { config } from '../../config/env.js';
import { requireAuth, requireClientHeader } from '../../middleware/auth.js';
import { codeLimiter, loginLimiter, lookupLimiter, signupLimiter } from '../../middleware/rate-limit.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { availabilitySchema, emailSchema, forgotSchema, loginSchema, resetSchema, resendSchema, signupSchema, usernameSchema, verifySchema } from './auth.schemas.js';
import * as auth from './auth.service.js';

export const authRouter = Router();

const COOKIE = 'socialambak_rt';
const cookieOptions = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict',
  path: '/api/v1/auth',
};

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

function sendSession(res, status, s) {
  res.cookie(COOKIE, s.tokens.refreshToken, { ...cookieOptions, maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
  res.status(status).json({ data: { user: s.user, accessToken: s.tokens.accessToken, expiresIn: s.tokens.expiresIn } });
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

authRouter.post(
  '/signup',
  signupLimiter,
  validateBody(signupSchema),
  wrap(async (req, res) => {
    res.status(201).json({ data: await auth.signup(req.body, meta(req)) });
  }),
);

authRouter.get(
  '/availability',
  lookupLimiter,
  validateQuery(availabilitySchema),
  wrap(async (_req, res) => {
    const q = res.locals.query;
    const username = q.username ? usernameSchema.safeParse(q.username) : undefined;
    const email = q.email ? emailSchema.safeParse(q.email) : undefined;
    const result = await auth.checkAvailability(username?.success ? username.data : undefined, email?.success ? email.data : undefined);
    // Invalid formats are reported as unavailable along with the reason.
    res.json({
      data: {
        ...result,
        ...(username && !username.success ? { username: false, usernameReason: username.error.issues[0]?.message } : {}),
        ...(email && !email.success ? { email: false, emailReason: email.error.issues[0]?.message } : {}),
      },
    });
  }),
);

authRouter.post(
  '/verify',
  codeLimiter,
  validateBody(verifySchema),
  wrap(async (req, res) => {
    const result = await auth.verifyCode(req.body.ticket, req.body.channel, req.body.code, meta(req));
    if (result.status === 'pending') return res.json({ data: { status: 'pending', pending: result.pending } });
    sendSession(res, 200, result);
  }),
);

authRouter.post(
  '/resend',
  codeLimiter,
  validateBody(resendSchema),
  wrap(async (req, res) => {
    res.json({ data: await auth.resendCode(req.body.ticket, req.body.channel) });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  wrap(async (req, res) => {
    const result = await auth.login(req.body.identifier, req.body.password, meta(req));
  if (result.twoFactorRequired) return res.json({ data: result }); // no session yet: the second step comes next
  sendSession(res, 200, result);
  }),
);

authRouter.post(
  '/forgot',
  codeLimiter,
  validateBody(forgotSchema),
  wrap(async (req, res) => {
    res.json({ data: await auth.forgotPassword(req.body.identifier) });
  }),
);

authRouter.post(
  '/reset',
  codeLimiter,
  validateBody(resetSchema),
  wrap(async (req, res) => {
    const result = await auth.resetPassword(req.body.identifier, req.body.code, req.body.password);
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ data: result });
  }),
);

authRouter.post(
  '/2fa',
  codeLimiter,
  validateBody(z.object({ ticket: z.string().min(10).max(1000), code: z.string().trim().min(6).max(14) }).strict()),
  wrap(async (req, res) => {
    sendSession(res, 200, await auth.loginWithSecondFactor(req.body.ticket, req.body.code, meta(req)));
  }),
);

authRouter.post(
  '/refresh',
  requireClientHeader,
  wrap(async (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: { code: 'no_session', message: 'Sign in to continue.' } });
    try {
      sendSession(res, 200, await auth.refreshSession(token, meta(req)));
    } catch (err) {
      if (err.status === 401) res.clearCookie(COOKIE, cookieOptions);
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  requireClientHeader,
  wrap(async (req, res) => {
    await auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  }),
);

authRouter.post(
  '/logout-all',
  requireClientHeader,
  requireAuth,
  wrap(async (req, res) => {
    await auth.logoutAll(req.auth.userId);
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  }),
);
