import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { tooMany } from '../lib/errors.js';

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.rateLimitsOff,
    handler: (_req, _res, next) => next(tooMany(message, Math.ceil(windowMs / 1000))),
  });

// Per-IP limits. Behind multiple app instances, give these a shared Redis store (rate-limit-redis).
export const apiLimiter = make(15 * 60_000, 2000, 'Too many requests. Slow down and try again shortly.');
export const loginLimiter = make(15 * 60_000, 20, 'Too many sign-in attempts. Try again in a few minutes.');
export const signupLimiter = make(60 * 60_000, 10, 'Too many sign-ups from this network. Try again later.');
export const codeLimiter = make(15 * 60_000, 30, 'Too many verification attempts. Try again in a few minutes.');
export const lookupLimiter = make(60_000, 60, 'Too many checks. Wait a moment.');
