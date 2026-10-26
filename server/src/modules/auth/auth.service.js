import { config } from '../../config/env.js';
import { exec, pool, q, tx } from '../../db/pool.js';
import { blindIndex, decryptField, emailAad, emailIndex, encryptField, CURRENT_KEY_VERSION, hashOtp, randomOtp, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, conflict, forbidden, tooMany, unauthorized } from '../../lib/errors.js';
import { fromBin, isUuid, toBin, uuidv7 } from '../../lib/ids.js';
import { deliverCode } from '../../lib/otp-delivery.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password.js';
import { mobileProblem, normalizePhone, phoneFromTyped } from '../../lib/phone.js';
import { signAccessToken, signTwoFactorTicket, signVerificationTicket, verifyTicket, verifyTwoFactorTicket } from '../../lib/tokens.js';
import { attemptsLeft, checkSecondFactor } from '../account/twofactor.service.js';
import { getProfile } from '../users/users.service.js';

// Dev only: also keep the plain code in verification_codes.dev_code so it can be read from the table. Never set in production.
const DEV_VISIBLE_CODES = config.OTP_DELIVERY === 'console' && !config.isProd;
const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_CODES_PER_HOUR = 5;
const MAX_FAILED_LOGINS = 10; // per account, per 15 minutes
const REFRESH_RACE_GRACE_SECONDS = 15; // two tabs refreshing at once

const phoneAad = (userId) => `users.phone:${userId}`;

const codeScope = (userId, channel, purpose = 'signup') => `${userId}:${channel}:${purpose}`;

const USER_COLUMNS = `id, username, email_ciphertext, email_key_version, status, password_hash, phone_ciphertext, phone_key_version,
  email_verified_at, phone_verified_at, deleted_at, totp_enabled_at, signup_channel`;

const MAX_ACCOUNTS_PER_PHONE = 5;

/** Sign-up needs ONE code, on the channel the person chose. Only an account still waiting for that code has anything pending. */
const pendingChannels = (u) => {
  if (u.status !== 'pending_verification') return [];
  return (u.signup_channel === 'email' ? u.email_verified_at : u.phone_verified_at) ? [] : [u.signup_channel];
};

// The email is optional: an account that signed up with only a phone has none (null).
const emailOf = (u) => (u.email_ciphertext ? decryptField(u.email_ciphertext, emailAad(fromBin(u.id)), u.email_key_version) : null);

const destinationFor = (u, channel) => (channel === 'email' ? emailOf(u) : decryptField(u.phone_ciphertext, phoneAad(fromBin(u.id)), u.phone_key_version));

async function logActivity(db, userId, action, metadata = {}) {
  await exec(db, 'INSERT INTO activity_log (user_id, action, metadata) VALUES (?, ?, ?)', [userId ? toBin(userId) : null, action, JSON.stringify(metadata)]);
}

/** Creates a fresh code, invalidating any earlier unused code for the same channel. Returns the plaintext code. */
async function createCode(db, userId, channel, purpose = 'signup') {
  const code = randomOtp();
  const uid = toBin(userId);
  await exec(
    db,
    `UPDATE verification_codes SET consumed_at = NOW(3)
      WHERE user_id = ? AND channel = ? AND purpose = ? AND consumed_at IS NULL`,
    [uid, channel, purpose],
  );
  await exec(
    db,
    `INSERT INTO verification_codes (user_id, channel, purpose, code_hash, dev_code, expires_at)
     VALUES (?, ?, ?, ?, ?, NOW(3) + INTERVAL ? MINUTE)`,
    [uid, channel, purpose, hashOtp(code, codeScope(userId, channel, purpose)), DEV_VISIBLE_CODES ? code : null, CODE_TTL_MINUTES],
  );
  return code;
}

/** Seconds until another code may be sent, or 0 when sending is allowed. */
async function sendWaitSeconds(db, userId, channel, purpose = 'signup') {
  const rows = await q(
    db,
    `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW(3)) AS last_age,
            COUNT(CASE WHEN created_at > NOW(3) - INTERVAL 1 HOUR THEN 1 END) AS hour_count
       FROM verification_codes WHERE user_id = ? AND channel = ? AND purpose = ?`,
    [toBin(userId), channel, purpose],
  );
  const { last_age, hour_count } = rows[0];
  if (Number(hour_count) >= MAX_CODES_PER_HOUR) return 3600;
  if (last_age !== null && Number(last_age) < RESEND_COOLDOWN_SECONDS) return RESEND_COOLDOWN_SECONDS - Number(last_age);
  return 0;
}

// ---------------------------------------------------------------- sessions

async function createSession(db, userId, meta, familyId = uuidv7()) {
  const sessionId = uuidv7();
  const refreshToken = randomToken();
  await exec(
    db,
    `INSERT INTO sessions (id, user_id, family_id, refresh_token_hash, user_agent, ip, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3) + INTERVAL ? DAY)`,
    [toBin(sessionId), toBin(userId), toBin(familyId), sha256(refreshToken), meta.userAgent?.slice(0, 300) ?? null, meta.ip?.slice(0, 45) ?? null, config.REFRESH_TOKEN_TTL_DAYS],
  );
  return {
    sessionId,
    tokens: { accessToken: signAccessToken(userId, sessionId), refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
  };
}

async function startSession(userId, meta) {
  await exec(pool, 'UPDATE users SET last_login_at = NOW(3) WHERE id = ?', [toBin(userId)]);
  const { tokens } = await createSession(pool, userId, meta);
  return { tokens, user: await getProfile(userId) };
}

export async function refreshSession(refreshToken, meta) {
  // Failures are returned (not thrown) so revocations still commit.
  const outcome = await tx(async (c) => {
    const rows = await q(
      c,
      `SELECT s.id, s.user_id, s.family_id, s.revoked_at, s.replaced_by,
              s.expires_at < NOW(3) AS expired,
              (s.revoked_at IS NOT NULL AND s.revoked_at > NOW(3) - INTERVAL ? SECOND) AS recently_rotated,
              u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = ? FOR UPDATE`,
      [REFRESH_RACE_GRACE_SECONDS, sha256(refreshToken)],
    );
    const s = rows[0];
    if (!s) return { ok: false, error: unauthorized('invalid_refresh', 'Sign in to continue.') };
    const userId = fromBin(s.user_id);

    if (s.revoked_at) {
      if (s.replaced_by && s.recently_rotated) {
        // Another request rotated this token a moment ago; the browser already holds the new cookie.
        return { ok: false, error: new AppError(409, 'refresh_conflict', 'Retry the request.') };
      }
      // An old token was replayed: assume theft and end every session in this chain.
      await exec(c, 'UPDATE sessions SET revoked_at = NOW(3) WHERE family_id = ? AND revoked_at IS NULL', [s.family_id]);
      await logActivity(c, userId, 'refresh_token_reuse');
      return { ok: false, error: unauthorized('session_revoked', 'For your security, sign in again.') };
    }
    if (s.expired) return { ok: false, error: unauthorized('session_expired', 'Your session expired. Sign in again.') };
    if (s.status !== 'active') {
      await exec(c, 'UPDATE sessions SET revoked_at = NOW(3) WHERE id = ?', [s.id]);
      return { ok: false, error: forbidden('account_inactive', 'This account is not active.') };
    }

    const next = await createSession(c, userId, meta, fromBin(s.family_id));
    await exec(c, 'UPDATE sessions SET revoked_at = NOW(3), replaced_by = ?, last_used_at = NOW(3) WHERE id = ?', [toBin(next.sessionId), s.id]);
    return { ok: true, userId, tokens: next.tokens };
  });

  if (!outcome.ok) throw outcome.error;
  return { tokens: outcome.tokens, user: await getProfile(outcome.userId) };
}

export async function logout(refreshToken) {
  if (!refreshToken) return;
  await exec(pool, 'UPDATE sessions SET revoked_at = NOW(3) WHERE refresh_token_hash = ? AND revoked_at IS NULL', [sha256(refreshToken)]);
}

export async function logoutAll(userId) {
  await exec(pool, 'UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [toBin(userId)]);
  await logActivity(pool, userId, 'logout_all');
}

// ---------------------------------------------------------------- sign up

function duplicateToField(err) {
  const e = err;
  if (e?.code !== 'ER_DUP_ENTRY') return null;
  const msg = e.sqlMessage ?? '';
  if (msg.includes('uq_users_username')) return { field: 'username', message: 'That username is taken.' };
  if (msg.includes('uq_users_email')) return { field: 'email', message: 'An account already uses this email.' };
  if (msg.includes('uq_users_phone_hash')) return { field: 'phone', message: 'An account already uses this phone number.' };
  return null;
}

export async function signup(input, meta) {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    throw new AppError(422, 'validation_error', 'Check the highlighted fields.', [{ field: 'phone', message: 'Enter a valid mobile number, including the country code.' }]);
  }
  const problem = mobileProblem(phone);
  if (problem) throw new AppError(422, 'validation_error', 'Check the highlighted fields.', [{ field: 'phone', message: problem }]);
  const phoneHash = blindIndex(phone);
  const emailHash = input.email ? emailIndex(input.email) : null;
  const passwordHash = await hashPassword(input.password);
  const userId = uuidv7();

  const code = await tx(async (c) => {
    // Free up details held by sign-ups that were never verified.
    await exec(
      c,
      `DELETE FROM users WHERE status = 'pending_verification' AND created_at < NOW(3) - INTERVAL 24 HOUR
          AND (username = ? OR email_hash = ?)`,
      [input.username, emailHash],
    );

    // Username and email are one-per-account. A mobile number may be shared by a few accounts (up to MAX_ACCOUNTS_PER_PHONE).
    const rows = await q(c, 'SELECT username, email_hash FROM users WHERE username = ? OR email_hash = ?', [input.username, emailHash]);
    const taken = [];
    if (rows.some((r) => r.username.toLowerCase() === input.username)) taken.push({ field: 'username', message: 'That username is taken.' });
    if (emailHash && rows.some((r) => r.email_hash && safeEqual(r.email_hash, emailHash))) taken.push({ field: 'email', message: 'An account already uses this email.' });
    const [{ n: onPhone }] = await q(c, 'SELECT COUNT(*) AS n FROM users WHERE phone_hash = ? AND deleted_at IS NULL', [phoneHash]);
    if (Number(onPhone) >= MAX_ACCOUNTS_PER_PHONE) taken.push({ field: 'phone', message: `This number already has the maximum of ${MAX_ACCOUNTS_PER_PHONE} accounts.` });
    if (taken.length) throw conflict('account_exists', 'Some of these details are already in use.', taken);

    try {
      await exec(
        c,
        `INSERT INTO users (id, username, full_name, email_ciphertext, email_hash, email_key_version, phone_ciphertext, phone_hash, phone_key_version, password_hash, date_of_birth, signup_channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [toBin(userId), input.username, input.fullName, input.email ? encryptField(input.email, emailAad(userId)) : null, emailHash, CURRENT_KEY_VERSION,
          encryptField(phone, phoneAad(userId)), phoneHash, CURRENT_KEY_VERSION, passwordHash, input.dateOfBirth, input.verifyVia],
      );
    } catch (err) {
      const field = duplicateToField(err); // lost a race with a concurrent sign-up
      if (field) throw conflict('account_exists', 'Some of these details are already in use.', [field]);
      throw err;
    }
    await exec(c, 'INSERT INTO user_settings (user_id) VALUES (?)', [toBin(userId)]);
    await logActivity(c, userId, 'signup', { ip: meta.ip });
    return createCode(c, userId, input.verifyVia); // one code, on the channel the person chose
  });

  const via = input.verifyVia;
  await deliverCode({ channel: via, to: via === 'email' ? input.email : phone, code });
  // Development only: show the code on screen too, so testers never have to hunt for a console window.
  const dev = DEV_VISIBLE_CODES ? { [via]: code } : undefined;
  return { ticket: signVerificationTicket(userId), pending: [via], ...(dev ? { dev } : {}) };
}

export async function checkAvailability(username, email) {
  const result = {};
  const notStale = `NOT (status = 'pending_verification' AND created_at < NOW(3) - INTERVAL 24 HOUR)`;
  if (username) result.username = (await q(pool, `SELECT 1 FROM users WHERE username = ? AND ${notStale}`, [username])).length === 0;
  if (email) result.email = (await q(pool, `SELECT 1 FROM users WHERE email_hash = ? AND ${notStale}`, [emailIndex(email)])).length === 0;
  return result;
}

// ---------------------------------------------------------------- verification

function ticketUser(ticket) {
  const { sub } = verifyTicket(ticket);
  if (!isUuid(sub)) throw unauthorized('invalid_token', 'Start sign-up again.');
  return sub;
}

export async function resendCode(ticket, channel) {
  const userId = ticketUser(ticket);
  const user = (await q(pool, `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [toBin(userId)]))[0];
  if (!user || user.deleted_at) throw unauthorized('invalid_token', 'Start sign-up again.');
  if (!pendingChannels(user).includes(channel)) throw conflict('already_verified', `Your ${channel} is already verified.`);

  const wait = await sendWaitSeconds(pool, userId, channel);
  if (wait > 0) throw tooMany(`Wait ${wait} seconds before requesting another code.`, wait);

  const code = await createCode(pool, userId, channel);
  await deliverCode({ channel, to: destinationFor(user, channel), code });
  return { cooldown: RESEND_COOLDOWN_SECONDS, ...(DEV_VISIBLE_CODES ? { dev: { [channel]: code } } : {}) };
}

export async function verifyCode(ticket, channel, code, meta) {
  const userId = ticketUser(ticket);
  const uid = toBin(userId);

  // Failures are returned (not thrown) so the attempt counter update still commits.
  const outcome = await tx(async (c) => {
    const user = (await q(c, `SELECT ${USER_COLUMNS} FROM users WHERE id = ? FOR UPDATE`, [uid]))[0];
    if (!user || user.deleted_at) return { ok: false, error: unauthorized('invalid_token', 'Start sign-up again.') };
    // A ticket alone never signs anyone in: a session is only issued in the same call that consumes the final code.
    if (!pendingChannels(user).includes(channel)) return { ok: false, error: conflict('already_verified', `Your ${channel} is already verified.`) };

    const row = (
      await q(
        c,
        `SELECT id, code_hash, attempts, max_attempts, expires_at < NOW(3) AS expired FROM verification_codes
        WHERE user_id = ? AND channel = ? AND purpose = 'signup' AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [uid, channel],
      )
    )[0];
    if (!row || row.expired) return { ok: false, error: new AppError(400, 'code_expired', 'This code has expired. Send a new one.') };
    if (row.attempts >= row.max_attempts) {
      return { ok: false, error: new AppError(429, 'too_many_attempts', 'Too many incorrect tries. Send a new code.') };
    }
    if (!safeEqual(row.code_hash, hashOtp(code, codeScope(userId, channel)))) {
      await exec(c, 'UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      const attemptsLeft = row.max_attempts - row.attempts - 1;
      return {
        ok: false,
        error: new AppError(400, 'invalid_code', attemptsLeft > 0 ? "That code isn't right. Check it and try again." : 'Too many incorrect tries. Send a new code.', { attemptsLeft }),
      };
    }

    await exec(c, 'UPDATE verification_codes SET consumed_at = NOW(3) WHERE id = ?', [row.id]);
    // The one code a sign-up needs has been proven: the contact is verified and the account goes live.
    const column = channel === 'email' ? 'email_verified_at' : 'phone_verified_at';
    await exec(c, `UPDATE users SET ${column} = NOW(3), status = 'active' WHERE id = ?`, [uid]);
    await logActivity(c, userId, `verified_${channel}`);
    return { ok: true, pending: [], activated: true };
  });

  if (!outcome.ok) throw outcome.error;
  if (!outcome.activated) return { status: 'pending', pending: outcome.pending };
  const session = await startSession(userId, meta);
  return { status: 'active', ...session };
}

// ---------------------------------------------------------------- sign in

const BAD_CREDENTIALS = () => unauthorized('invalid_credentials', "Those details don't match an account. Check them and try again.");

/** Every account a sign-in identifier points to: one for a username or email, a few for a mobile number shared between accounts. */
async function findCandidates(identifier) {
  if (identifier.includes('@')) return q(pool, `SELECT ${USER_COLUMNS} FROM users WHERE email_hash = ?`, [emailIndex(identifier)]);
  const phone = phoneFromTyped(identifier);
  if (phone) {
    const rows = await q(pool, `SELECT ${USER_COLUMNS} FROM users WHERE phone_hash = ? AND deleted_at IS NULL ORDER BY created_at LIMIT ${MAX_ACCOUNTS_PER_PHONE}`, [blindIndex(phone)]);
    if (rows.length || identifier.trim().startsWith('+')) return rows;
    // a bare 10-digit number that is nobody's phone may still be somebody's all-digit username
  }
  return q(pool, `SELECT ${USER_COLUMNS} FROM users WHERE username = ?`, [identifier.toLowerCase()]);
}

export async function login(identifier, password, meta) {
  const candidates = (await findCandidates(identifier)).filter((u) => !u.deleted_at);
  if (!candidates.length) {
    await burnPasswordCheck(password);
    throw BAD_CREDENTIALS();
  }

  // A mobile number can be shared by a few accounts: the password says which one is meant.
  const matches = [];
  let locked = 0;
  for (const u of candidates) {
    const [{ n }] = await q(
      pool,
      `SELECT COUNT(*) AS n FROM activity_log
        WHERE user_id = ? AND action = 'login_failed' AND created_at > NOW(3) - INTERVAL 15 MINUTE`,
      [u.id],
    );
    if (Number(n) >= MAX_FAILED_LOGINS) {
      locked++;
      continue;
    }
    if (await verifyPassword(u.password_hash, password)) matches.push(u);
    else await logActivity(pool, fromBin(u.id), 'login_failed', { ip: meta.ip });
  }
  if (!matches.length) {
    if (locked === candidates.length) throw tooMany('Too many failed attempts on this account. Try again in 15 minutes.', 900);
    throw BAD_CREDENTIALS();
  }
  if (matches.length > 1) throw conflict('multiple_accounts', 'More than one account with this number uses that password. Sign in with your username instead.');
  const user = matches[0];
  const userId = fromBin(user.id);

  if (user.status === 'suspended') throw forbidden('account_suspended', 'This account is suspended. Contact support for help.');

  if (user.status === 'pending_verification') {
    const pending = pendingChannels(user);
    for (const channel of pending) {
      if ((await sendWaitSeconds(pool, userId, channel)) === 0) {
        const code = await createCode(pool, userId, channel);
        await deliverCode({ channel, to: destinationFor(user, channel), code });
      }
    }
    throw forbidden('verification_required', 'Verify your account to finish signing up.', {
      ticket: signVerificationTicket(userId),
      pending,
    });
  }

  // Two-factor on: the password alone is not enough. No session, no reactivation yet: a ticket that only allows the next step.
  if (user.totp_enabled_at) return { twoFactorRequired: true, ticket: signTwoFactorTicket(userId) };

  if (user.status === 'deactivated') await exec(pool, `UPDATE users SET status = 'active' WHERE id = ?`, [user.id]);
  await logActivity(pool, userId, 'login', { ip: meta.ip });
  return startSession(userId, meta);
}

/** Second step of a two-factor sign-in: the ticket from the password step plus an authenticator code or a backup code. */
export async function loginWithSecondFactor(ticket, code, meta) {
  const { sub: userId } = verifyTwoFactorTicket(ticket);
  if (!isUuid(userId)) throw unauthorized('invalid_token', 'Sign in again.');
  const [user] = await q(pool, `SELECT status, deleted_at, totp_enabled_at FROM users WHERE id = ?`, [toBin(userId)]);
  if (!user || user.deleted_at || !user.totp_enabled_at || user.status === 'suspended') throw unauthorized('invalid_token', 'Sign in again.');
  if (!(await checkSecondFactor(userId, code))) {
    throw new AppError(400, 'invalid_code', 'That code isn’t right. Try again, or use a backup code.', { attemptsLeft: await attemptsLeft(userId) });
  }
  if (user.status === 'deactivated') await exec(pool, `UPDATE users SET status = 'active' WHERE id = ?`, [toBin(userId)]);
  await logActivity(pool, userId, 'login', { ip: meta.ip, twoFactor: true });
  return startSession(userId, meta);
}

// Forgot password / forgot username live in recovery.service.js (one flow: prove an email or phone with a code, then list or reset the accounts that use it).

/** Housekeeping: drop abandoned sign-ups, old codes and long-expired sessions. Runs hourly from index.js. */
export async function purgeStale() {
  await exec(pool, `DELETE FROM users WHERE status = 'pending_verification' AND created_at < NOW(3) - INTERVAL 24 HOUR`);
  await exec(pool, `DELETE FROM verification_codes WHERE created_at < NOW(3) - INTERVAL 1 DAY`);
  await exec(pool, `DELETE FROM recovery_requests WHERE created_at < NOW(3) - INTERVAL 1 DAY`);
  await exec(pool, `DELETE FROM sessions WHERE expires_at < NOW(3) - INTERVAL 7 DAY`);
}

/** Every upload key still referenced by a post, story, avatar or message. Used by the hourly orphan-file cleanup. */
export async function referencedMediaKeys() {
  const rows = await q(
    pool,
    `SELECT storage_key AS k FROM post_media
     UNION SELECT storage_key FROM stories WHERE expires_at > NOW(3) - INTERVAL 1 DAY
     UNION SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL
     UNION SELECT storage_key FROM messages WHERE storage_key IS NOT NULL`,
  );
  return new Set(rows.map((r) => r.k));
}
