import { exec, pool, q } from '../../db/pool.js';
import { AppError, unauthorized } from '../../lib/errors.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password.js';

export async function getSettings(me) {
  await exec(pool, 'INSERT IGNORE INTO user_settings (user_id) VALUES (?)', [toBin(me)]);
  const [r] = await q(pool, 'SELECT messages_from, notify_likes, notify_comments, notify_follows, notify_messages FROM user_settings WHERE user_id = ?', [toBin(me)]);
  return { messagesFrom: r.messages_from, notifyLikes: !!r.notify_likes, notifyComments: !!r.notify_comments, notifyFollows: !!r.notify_follows, notifyMessages: !!r.notify_messages };
}

export async function updateSettings(me, patch) {
  const map = {
    messagesFrom: 'messages_from',
    notifyLikes: 'notify_likes',
    notifyComments: 'notify_comments',
    notifyFollows: 'notify_follows',
    notifyMessages: 'notify_messages',
  };
  const sets = [];
  const args = [];
  for (const k of Object.keys(map))
    if (patch[k] !== undefined) {
      sets.push(`${map[k]} = ?`);
      args.push(patch[k]);
    }
  await exec(pool, 'INSERT IGNORE INTO user_settings (user_id) VALUES (?)', [toBin(me)]);
  if (sets.length) await exec(pool, `UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = ?`, [...args, toBin(me)]);
  return getSettings(me);
}

export async function checkPassword(me, password) {
  const [u] = await q(pool, 'SELECT password_hash, username FROM users WHERE id = ? AND deleted_at IS NULL', [toBin(me)]);
  if (!u) throw unauthorized();
  if (!(await verifyPassword(u.password_hash, password))) {
    await burnPasswordCheck(password);
    throw new AppError(403, 'wrong_password', 'That password is not right.');
  }
  return u;
}

/** Changes the password after checking the current one, and signs out every other device (this one stays signed in). */
export async function changePassword(me, sessionId, current, next) {
  const u = await checkPassword(me, current);
  if (next.toLowerCase().includes(u.username))
    throw new AppError(422, 'validation_error', 'Check the highlighted fields.', [{ field: 'password', message: "Your password can't contain your username." }]);
  if (next === current) throw new AppError(422, 'validation_error', 'Check the highlighted fields.', [{ field: 'password', message: 'Choose a password you have not just used.' }]);
  await exec(pool, 'UPDATE users SET password_hash = ?, password_changed_at = NOW(3) WHERE id = ?', [await hashPassword(next), toBin(me)]);
  await exec(pool, 'UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', [toBin(me), toBin(sessionId)]);
  await exec(pool, "INSERT INTO activity_log (user_id, action) VALUES (?, 'password_changed')", [toBin(me)]);
  return { changed: true };
}

/** Hides the account everywhere and signs it out. Signing in again brings it back. */
export async function deactivate(me, password) {
  await checkPassword(me, password);
  await exec(pool, "UPDATE users SET status = 'deactivated' WHERE id = ? AND status = 'active'", [toBin(me)]);
  await exec(pool, 'UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [toBin(me)]);
  await exec(pool, "INSERT INTO activity_log (user_id, action) VALUES (?, 'deactivated')", [toBin(me)]);
  return { deactivated: true };
}

// ---------------------------------------------------------------- active sessions

/** "Chrome on Windows" from a browser's user-agent text (good enough for people to recognise their own devices). */
function describeAgent(ua) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system';
  return `${browser} on ${os}`;
}

const maskIp = (ip) => (!ip ? null : ip.includes(':') ? ip.replace(/(:[0-9a-f]*){2}$/i, ':••••') : ip.replace(/\.\d+$/, '.•••'));

/** The signed-in devices of this account: one row per device (a refreshed session replaces its old row). */
export async function listSessions(me, currentSessionId) {
  const rows = await q(
    pool,
    `SELECT id, user_agent, ip, created_at, last_used_at FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW(3) ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT 50`,
    [toBin(me)],
  );
  return rows.map((r) => ({
    id: fromBin(r.id),
    device: describeAgent(r.user_agent),
    ip: maskIp(r.ip),
    createdAt: r.created_at.toISOString(),
    lastUsedAt: (r.last_used_at ?? r.created_at).toISOString(),
    current: fromBin(r.id) === currentSessionId,
  }));
}

/** Signs out one device. The row must belong to me (anything else answers "not found"), and its whole refresh chain ends. */
export async function revokeSession(me, sessionId) {
  const r = await exec(
    pool,
    `UPDATE sessions SET revoked_at = NOW(3)
      WHERE user_id = ? AND revoked_at IS NULL AND family_id = (SELECT family_id FROM (SELECT family_id FROM sessions WHERE id = ? AND user_id = ?) x)`,
    [toBin(me), toBin(sessionId), toBin(me)],
  );
  if (!r.affectedRows) throw new AppError(404, 'not_found', 'Session not found.');
  return { revoked: true };
}

/** Signs out every other device and keeps this one. */
export async function revokeOtherSessions(me, currentSessionId) {
  const r = await exec(
    pool,
    `UPDATE sessions SET revoked_at = NOW(3)
      WHERE user_id = ? AND revoked_at IS NULL AND family_id <> (SELECT family_id FROM (SELECT family_id FROM sessions WHERE id = ? AND user_id = ?) x)`,
    [toBin(me), toBin(currentSessionId), toBin(me)],
  );
  return { revokedCount: r.affectedRows };
}
