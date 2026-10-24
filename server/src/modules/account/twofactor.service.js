/*
 * Two-factor sign-in with an authenticator app (TOTP) plus one-time backup codes.
 *
 *   setup    : makes a new secret and stores it ENCRYPTED (AES-256-GCM, tied to this user). It is not active yet.
 *   enable   : the user types a code from the app to prove it works; only then is 2FA switched on, and 10 backup codes are shown ONCE.
 *   sign-in  : after the password is right, a second step asks for an app code or a backup code (see auth.service.js).
 *   disable  : needs the password AND a valid code.
 * Secrets are never stored or logged in plain text; backup codes are stored only as keyed hashes and each works once.
 * A code cannot be used twice (the 30-second step is remembered), and wrong tries are limited per account.
 */
import QRCode from 'qrcode';
import { decryptField, encryptField, hashOtp, safeEqual } from '../../lib/crypto.js';
import { exec, pool, q } from '../../db/pool.js';
import { AppError, conflict, tooMany } from '../../lib/errors.js';
import { toBin } from '../../lib/ids.js';
import { generateSecret, matchStep, otpauthUrl } from '../../lib/totp.js';
import crypto from 'node:crypto';

const aad = (userId) => `users.totp:${userId}`;
const BACKUP_COUNT = 10;
const MAX_FAILURES = 5; // wrong second-step codes per account per 10 minutes

async function row(userId) {
  const [u] = await q(pool, 'SELECT username, totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE id = ? AND deleted_at IS NULL', [toBin(userId)]);
  return u;
}
const secretOf = (userId, u) => decryptField(u.totp_secret_enc, aad(userId));
const normalise = (code) => String(code).replace(/[\s-]/g, '').toUpperCase();
const backupHash = (userId, code) => hashOtp(normalise(code), `backup:${userId}`);

export async function status(userId) {
  const u = await row(userId);
  const [left] = await q(pool, 'SELECT COUNT(*) AS n FROM backup_codes WHERE user_id = ? AND used_at IS NULL', [toBin(userId)]);
  return { enabled: !!u.totp_enabled_at, backupCodesLeft: u.totp_enabled_at ? Number(left.n) : 0 };
}

export async function setup(userId) {
  const u = await row(userId);
  if (u.totp_enabled_at) throw conflict('already_enabled', 'Two-factor authentication is already on.');
  const secret = generateSecret();
  await exec(pool, 'UPDATE users SET totp_secret_enc = ?, totp_last_step = NULL WHERE id = ?', [encryptField(secret, aad(userId)), toBin(userId)]);
  const url = otpauthUrl(secret, u.username);
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

function newBackupCodes() {
  // 10 characters from an easy-to-read alphabet, shown as xxxxx-xxxxx.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: BACKUP_COUNT }, () => {
    const raw = Array.from({ length: 10 }, () => chars[crypto.randomInt(chars.length)]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

async function storeBackupCodes(userId) {
  const codes = newBackupCodes();
  await exec(pool, 'DELETE FROM backup_codes WHERE user_id = ?', [toBin(userId)]);
  for (const c of codes) await exec(pool, 'INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)', [toBin(userId), backupHash(userId, c)]);
  return codes;
}

export async function enable(userId, code) {
  const u = await row(userId);
  if (u.totp_enabled_at) throw conflict('already_enabled', 'Two-factor authentication is already on.');
  if (!u.totp_secret_enc) throw new AppError(422, 'setup_first', 'Start the setup first.');
  const step = matchStep(secretOf(userId, u), String(code));
  if (step === null) throw new AppError(400, 'invalid_code', 'That code isn’t right. Check your authenticator app and try again.');
  await exec(pool, 'UPDATE users SET totp_enabled_at = NOW(3), totp_last_step = ? WHERE id = ?', [step, toBin(userId)]);
  await exec(pool, "INSERT INTO activity_log (user_id, action) VALUES (?, 'two_factor_enabled')", [toBin(userId)]);
  return { enabled: true, backupCodes: await storeBackupCodes(userId) };
}

async function recentFailures(userId) {
  const [r] = await q(pool, "SELECT COUNT(*) AS n FROM activity_log WHERE user_id = ? AND action = 'two_factor_failed' AND created_at > NOW(3) - INTERVAL 10 MINUTE", [toBin(userId)]);
  return Number(r.n);
}

/**
 * Checks a second-step code (authenticator code or backup code). Returns true/false, counts failures and refuses
 * after too many. A successful authenticator code cannot be used again.
 */
export async function checkSecondFactor(userId, code) {
  if ((await recentFailures(userId)) >= MAX_FAILURES) throw tooMany('Too many wrong codes. Try again in 10 minutes.', 600);
  const u = await row(userId);
  if (!u?.totp_enabled_at) return false;
  const typed = normalise(code);
  let ok = false;
  if (/^\d{6}$/.test(typed)) {
    const step = matchStep(secretOf(userId, u), typed);
    // the step must be newer than the last accepted one: the same code cannot be replayed
    if (step !== null && (u.totp_last_step === null || BigInt(step) > BigInt(u.totp_last_step))) {
      const r = await exec(pool, 'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)', [step, toBin(userId), step]);
      ok = r.affectedRows === 1;
    }
  } else if (/^[A-Z2-9]{10}$/.test(typed)) {
    const hash = backupHash(userId, typed);
    const rows = await q(pool, 'SELECT id, code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL', [toBin(userId)]);
    const hit = rows.find((r) => safeEqual(r.code_hash, hash));
    if (hit) ok = (await exec(pool, 'UPDATE backup_codes SET used_at = NOW(3) WHERE id = ? AND used_at IS NULL', [hit.id])).affectedRows === 1;
  }
  if (!ok) await exec(pool, "INSERT INTO activity_log (user_id, action) VALUES (?, 'two_factor_failed')", [toBin(userId)]);
  return ok;
}

export async function attemptsLeft(userId) {
  return Math.max(MAX_FAILURES - (await recentFailures(userId)), 0);
}

export async function disable(userId, code) {
  if (!(await checkSecondFactor(userId, code))) throw new AppError(400, 'invalid_code', 'That code isn’t right.');
  await exec(pool, 'UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?', [toBin(userId)]);
  await exec(pool, 'DELETE FROM backup_codes WHERE user_id = ?', [toBin(userId)]);
  await exec(pool, "INSERT INTO activity_log (user_id, action) VALUES (?, 'two_factor_disabled')", [toBin(userId)]);
  return { enabled: false };
}

export async function regenerateBackupCodes(userId, code) {
  if (!(await checkSecondFactor(userId, code))) throw new AppError(400, 'invalid_code', 'That code isn’t right.');
  return { backupCodes: await storeBackupCodes(userId) };
}

