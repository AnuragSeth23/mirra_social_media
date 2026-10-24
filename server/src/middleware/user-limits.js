import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { tooMany } from '../lib/errors.js';

/** Per-account limits (not per IP), so one noisy user cannot spam while everyone behind the same network stays fine. Use after requireAuth. */
const perUser = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.rateLimitsOff,
    keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, _res, next) => next(tooMany(message, Math.ceil(windowMs / 1000))),
  });

const HOUR = 60 * 60_000;
export const uploadLimiter = perUser(HOUR, 120, 'You have uploaded a lot just now. Try again in a while.');
export const postLimiter = perUser(HOUR, 120, 'You are posting very fast. Try again in a while.');
export const commentLimiter = perUser(HOUR, 300, 'You are commenting very fast. Try again in a while.');
export const messageLimiter = perUser(HOUR, 1000, 'You are sending messages very fast. Try again in a while.');
export const followLimiter = perUser(HOUR, 400, 'You are following people very fast. Try again in a while.');
export const friendLimiter = perUser(HOUR, 200, 'You are sending friend requests very fast. Try again in a while.');
export const reportLimiter = perUser(HOUR, 30, 'You have sent a lot of reports. Try again later.');
