import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { unauthorized } from './errors.js';

const ISSUER = 'socialambak';
const AUDIENCE = 'socialambak-app';

export function signAccessToken(userId, sessionId) {
  return jwt.sign({ sid: sessionId, typ: 'access' }, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Short-lived ticket that lets an unverified account submit its verification codes — nothing else. */
export function signVerificationTicket(userId) {
  return jwt.sign({ typ: 'verify' }, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: '30m',
  });
}

/** Proves the password step was passed; the only thing it allows is submitting the second-step code. 5 minutes. */
export function signTwoFactorTicket(userId) {
  return jwt.sign({ typ: '2fa' }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', subject: userId, issuer: ISSUER, audience: AUDIENCE, expiresIn: '5m' });
}

/** Names one account-recovery request (its id is the subject). It proves nothing by itself: the code must still be verified server side. */
export function signRecoveryTicket(requestId) {
  return jwt.sign({ typ: 'recover' }, config.JWT_ACCESS_SECRET, { algorithm: 'HS256', subject: requestId, issuer: ISSUER, audience: AUDIENCE, expiresIn: '30m' });
}

function verifyToken(token, typ, expiredCode) {
  try {
    const claims = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (claims.typ !== typ) throw new Error('wrong token type');
    return claims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw unauthorized(expiredCode, 'Your session expired.');
    throw unauthorized('invalid_token', 'Sign in to continue.');
  }
}

export const verifyAccessToken = (t) => verifyToken(t, 'access', 'token_expired');
export const verifyTicket = (t) => verifyToken(t, 'verify', 'ticket_expired');
export const verifyTwoFactorTicket = (t) => verifyToken(t, '2fa', 'ticket_expired');
export const verifyRecoveryTicket = (t) => verifyToken(t, 'recover', 'ticket_expired');
