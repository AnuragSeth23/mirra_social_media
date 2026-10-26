import { config } from '../../config/env.js';
import { exec, pool, q, tx } from '../../db/pool.js';
import { blindIndex, decryptField, emailAad, emailIndex, hashOtp, randomOtp, safeEqual } from '../../lib/crypto.js';
import { AppError, unauthorized } from '../../lib/errors.js';
import { fromBin, isUuid, toBin, uuidv7 } from '../../lib/ids.js';
import { mediaUrl } from '../../lib/media.js';
import { deliverCode } from '../../lib/otp-delivery.js';
import { hashPassword } from '../../lib/password.js';
import { maskEmail, maskPhone, phoneFromTyped } from '../../lib/phone.js';
import { signRecoveryTicket, verifyRecoveryTicket } from '../../lib/tokens.js';

/*
 * Forgot password and forgot username: one flow, like Instagram / Facebook.
 *   1. start   — type a username, email or mobile number. The code goes to the email or phone (for a username you choose which).
 *   2. verify  — enter the 6-digit code. That proves the contact, and returns EVERY account that uses it (a mobile number can be shared).
 *   3. reset   — pick one of those accounts and set a new password (or just note the username and sign in).
 * A request belongs to the contact, not to one account (see recovery_requests). Nothing here reveals whether an account exists:
 * an unknown identifier gets the same answers and the same try-limits as a real one (it gets a request nobody can complete).
 */
const DEV_VISIBLE_CODES = config.OTP_DELIVERY === 'console' && !config.isProd;
const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_REQUESTS_PER_HOUR = 5;
const RESET_WINDOW_MINUTES = 15; // after the code is proven, this long to choose an account and set the password

const OPEN = `u.status IN ('active', 'deactivated') AND u.deleted_at IS NULL`; // accounts that can be recovered
const hashColumn = (channel) => (channel === 'email' ? 'email_hash' : 'phone_hash');
const codeScope = (requestId) => `recover:${requestId}`;
const BAD_CODE = () => new AppError(400, 'invalid_code', "That code isn't right or has expired. Check it, or ask for a new one.");

const accountsFor = (db, channel, hash) =>
  q(db, `SELECT u.id, u.username, u.full_name, u.avatar_key, u.created_at FROM users u WHERE u.${hashColumn(channel)} = ? AND ${OPEN} ORDER BY u.created_at`, [hash]);

const toAccount = (r) => ({ id: fromBin(r.id), username: r.username, fullName: r.full_name, avatarUrl: mediaUrl(r.avatar_key), joined: r.created_at.toISOString() });

/** Works out which email or mobile number the code goes to, from what the person typed. */
async function resolveContact(identifier, channelPref) {
  const text = identifier.trim();
  if (text.includes('@')) {
    const email = text.toLowerCase();
    return { channel: 'email', plain: email, hash: emailIndex(email), shown: maskEmail(email) };
  }
  const phone = phoneFromTyped(text);
  if (phone) {
    const hash = blindIndex(phone);
    // a bare 10-digit number that nobody uses as a phone may still be somebody's all-digit username
    if (text.startsWith('+') || (await accountsFor(pool, 'phone', hash)).length) return { channel: 'phone', plain: phone, hash, shown: maskPhone(phone) };
  }
  // A username: the code goes to the email or phone saved on that account, whichever the person picked.
  const channel = channelPref ?? 'email';
  const [u] = await q(
    pool,
    `SELECT u.id, u.email_ciphertext, u.email_key_version, u.email_hash, u.phone_ciphertext, u.phone_key_version, u.phone_hash FROM users u WHERE u.username = ? AND ${OPEN}`,
    [text.toLowerCase()],
  );
  // No such account, or it has no email (the email is optional) and the email was picked: nothing to send, and the answer looks the same.
  if (!u || (channel === 'email' && !u.email_ciphertext)) return { channel, plain: null, hash: null, shown: null };
  const id = fromBin(u.id);
  return channel === 'email'
    ? { channel, plain: decryptField(u.email_ciphertext, emailAad(id), u.email_key_version), hash: u.email_hash, shown: null }
    : { channel, plain: decryptField(u.phone_ciphertext, `users.phone:${id}`, u.phone_key_version), hash: u.phone_hash, shown: null };
}

function requestIdOf(ticket) {
  const { sub } = verifyRecoveryTicket(ticket);
  if (!isUuid(sub)) throw unauthorized('invalid_token', 'Start again.');
  return sub;
}

export async function start(identifier, channelPref) {
  const contact = await resolveContact(identifier, channelPref);
  const known = !!contact.hash && (await accountsFor(pool, contact.channel, contact.hash)).length > 0;

  let id = uuidv7();
  let dev = { note: 'No account matches that username, email or phone, so no code was sent.' };

  if (known) {
    const [recent] = await q(
      pool,
      `SELECT id, dev_code, expires_at > NOW(3) AS live, created_at > NOW(3) - INTERVAL ? SECOND AS cooling FROM recovery_requests
        WHERE channel = ? AND contact_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [RESEND_COOLDOWN_SECONDS, contact.channel, contact.hash],
    );
    const [{ n }] = await q(pool, `SELECT COUNT(*) AS n FROM recovery_requests WHERE channel = ? AND contact_hash = ? AND created_at > NOW(3) - INTERVAL 1 HOUR`, [contact.channel, contact.hash]);
    const capped = Number(n) >= MAX_REQUESTS_PER_HOUR;

    if (recent?.live && (recent.cooling || capped)) {
      // A code went out a moment ago (or too many were asked for this hour): reuse that request instead of sending another.
      id = recent.id;
      dev = { code: recent.dev_code ?? undefined, note: 'A code was sent a moment ago. Use that one (a new one can be requested after a minute).' };
    } else if (capped) {
      dev = { note: 'Too many codes were requested for this contact. Try again in an hour.' };
      await createRequest(id, contact.channel, blindIndex(`unused:${id}`), randomOtp(), false);
    } else {
      const code = randomOtp();
      await createRequest(id, contact.channel, contact.hash, code, true);
      await deliverCode({ channel: contact.channel, to: contact.plain, code });
      dev = { code };
    }
  } else {
    // Unknown identifier: a request nobody can complete, so the answers and the try-limits look exactly like a real one.
    await createRequest(id, contact.channel, blindIndex(`unknown:${id}`), randomOtp(), false);
  }

  return { sent: true, ticket: signRecoveryTicket(id), channel: contact.channel, destination: contact.shown, ...(DEV_VISIBLE_CODES ? { dev } : {}) };
}

const createRequest = (id, channel, contactHash, code, keepDevCode) =>
  exec(
    pool,
    `INSERT INTO recovery_requests (id, channel, contact_hash, code_hash, dev_code, expires_at) VALUES (?, ?, ?, ?, ?, NOW(3) + INTERVAL ? MINUTE)`,
    [id, channel, contactHash, hashOtp(code, codeScope(id)), keepDevCode && DEV_VISIBLE_CODES ? code : null, CODE_TTL_MINUTES],
  );

/** Checks the code. A correct code proves the contact and returns every account that uses it. */
export async function verify(ticket, code) {
  const rid = requestIdOf(ticket);

  // Failures are returned (not thrown) so the attempt counter update still commits.
  const outcome = await tx(async (c) => {
    const row = (
      await q(
        c,
        `SELECT channel, contact_hash, code_hash, attempts, max_attempts, expires_at < NOW(3) AS expired, verified_at FROM recovery_requests WHERE id = ? FOR UPDATE`,
        [rid],
      )
    )[0];
    if (!row || (row.expired && !row.verified_at)) return { error: BAD_CODE() };
    if (row.attempts >= row.max_attempts) return { error: new AppError(429, 'too_many_attempts', 'Too many incorrect tries. Ask for a new code.') };
    if (!safeEqual(row.code_hash, hashOtp(code, codeScope(rid)))) {
      await exec(c, 'UPDATE recovery_requests SET attempts = attempts + 1 WHERE id = ?', [rid]);
      return { error: new AppError(400, 'invalid_code', "That code isn't right. Check it and try again.", { attemptsLeft: Math.max(row.max_attempts - row.attempts - 1, 0) }) };
    }
    await exec(c, 'UPDATE recovery_requests SET verified_at = COALESCE(verified_at, NOW(3)) WHERE id = ?', [rid]);
    return { row };
  });
  if (outcome.error) throw outcome.error;

  const accounts = await accountsFor(pool, outcome.row.channel, outcome.row.contact_hash);
  return { channel: outcome.row.channel, accounts: accounts.map(toAccount) };
}

/** Sets a new password for one of the accounts that use the verified contact, and signs that account out everywhere. */
export async function resetPassword(ticket, userId, password) {
  const rid = requestIdOf(ticket);
  const [req] = await q(
    pool,
    `SELECT channel, contact_hash, verified_at > NOW(3) - INTERVAL ? MINUTE AS fresh FROM recovery_requests WHERE id = ? AND verified_at IS NOT NULL`,
    [RESET_WINDOW_MINUTES, rid],
  );
  if (!req || !req.fresh) throw new AppError(401, 'recovery_expired', 'This reset timed out. Start again.');

  const [user] = await q(pool, `SELECT u.id, u.username FROM users u WHERE u.id = ? AND u.${hashColumn(req.channel)} = ? AND ${OPEN}`, [toBin(userId), req.contact_hash]);
  if (!user) throw new AppError(403, 'not_allowed', "That account isn't linked to the email or number you verified.");
  // Only someone who proved the contact learns the password rules about this account.
  if (password.toLowerCase().includes(user.username)) {
    throw new AppError(422, 'validation_error', 'Check the highlighted fields.', [{ field: 'password', message: "Your password can't contain your username." }]);
  }

  const passwordHash = await hashPassword(password);
  const verifiedColumn = req.channel === 'email' ? 'email_verified_at' : 'phone_verified_at';
  await tx(async (c) => {
    await exec(c, `UPDATE users SET password_hash = ?, password_changed_at = NOW(3), ${verifiedColumn} = COALESCE(${verifiedColumn}, NOW(3)) WHERE id = ?`, [passwordHash, user.id]);
    await exec(c, 'UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [user.id]);
    await exec(c, 'INSERT INTO activity_log (user_id, action, metadata) VALUES (?, ?, ?)', [user.id, 'password_reset', JSON.stringify({ via: req.channel })]);
  });
  return { reset: true, username: user.username };
}
