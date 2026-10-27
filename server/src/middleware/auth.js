import { exec, pool, q } from '../db/pool.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { isId, toBin } from '../lib/ids.js';
import { verifyAccessToken } from '../lib/tokens.js';

/**
 * Verifies the Bearer access token, then confirms the session is still live and the account active.
 * The session check makes "log out everywhere" and suspensions take effect immediately
 * (a primary-key lookup; cache it in Redis when traffic warrants).
 */
export const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const claims = verifyAccessToken(header.slice(7));
    if (!isId(claims.sub) || !isId(claims.sid)) throw unauthorized('invalid_token');
    const rows = await q(
      pool,
      `SELECT u.status FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > NOW(3) AND u.deleted_at IS NULL`,
      [toBin(claims.sid), toBin(claims.sub)],
    );
    if (!rows[0]) throw unauthorized('session_revoked', 'You were signed out. Sign in again.');
    if (rows[0].status !== 'active') throw forbidden('account_inactive', 'This account is not active.');
    req.auth = { userId: claims.sub, sessionId: claims.sid };
    // "Active now": remember the last time this account was used (at most once a minute; a failure here never blocks the request).
    exec(pool, 'UPDATE users SET last_active_at = NOW(3) WHERE id = ? AND (last_active_at IS NULL OR last_active_at < NOW(3) - INTERVAL 60 SECOND)', [toBin(claims.sub)]).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Endpoints authenticated by the refresh cookie require this custom header.
 * Browsers can't attach custom headers cross-site without a CORS preflight, which our CORS policy
 * only grants to CLIENT_ORIGIN — together with SameSite=Strict this blocks CSRF.
 */
export const requireClientHeader = (req, _res, next) => {
  if (req.get('x-socialambak-client') !== 'web') return next(forbidden('missing_client_header', 'Request blocked.'));
  next();
};
