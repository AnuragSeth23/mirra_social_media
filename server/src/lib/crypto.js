import crypto from 'node:crypto';
import { config } from '../config/env.js';

/*
 * Field-level encryption for sensitive values (phone numbers, emails, 2FA secrets).
 * AES-256-GCM with a random 96-bit IV. Layout: iv(12) | tag(16) | ciphertext.
 * Everything stored in the database (ciphertexts, blind indexes, token/code hashes) is a lowercase hex string in a plain
 * CHAR/VARCHAR column, so it reads like password_hash in any client instead of showing as BLOB.
 * The associated data binds a ciphertext to its row, so ciphertexts cannot be swapped between users.
 * Keys are versioned so they can be rotated: add a new version, re-encrypt in a background job.
 */
const ENC_KEYS = { 1: Buffer.from(config.PHONE_ENC_KEY, 'hex') };
export const CURRENT_KEY_VERSION = 1;

function keyFor(version) {
  const key = ENC_KEYS[version];
  if (!key) throw new Error(`No encryption key for version ${version}`);
  return key;
}

export function encryptField(plaintext, aad, version = CURRENT_KEY_VERSION) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(version), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('hex');
}

export function decryptField(stored, aad, version = CURRENT_KEY_VERSION) {
  const blob = Buffer.from(stored, 'hex');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(version), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Deterministic keyed hash ("blind index") so an encrypted value can still be looked up and kept unique. */
export function blindIndex(value) {
  return crypto.createHmac('sha256', Buffer.from(config.PHONE_HASH_KEY, 'hex')).update(value).digest('hex');
}

/**
 * Email is stored encrypted too (users.email_ciphertext, AAD bound to the user id) with this blind index for lookup/uniqueness.
 * The "email:" prefix keeps it from ever colliding with a phone blind index made with the same HMAC key.
 */
export const emailAad = (userId) => `users.email:${userId}`;
export const emailIndex = (email) => blindIndex(`email:${email.trim().toLowerCase()}`);

export function hashOtp(code, scope) {
  return crypto.createHmac('sha256', Buffer.from(config.OTP_HASH_KEY, 'hex')).update(`${scope}:${code}`).digest('hex');
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const randomOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
