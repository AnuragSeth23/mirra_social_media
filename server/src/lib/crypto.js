import crypto from 'node:crypto';
import { config } from '../config/env.js';

/*
 * Field-level encryption for sensitive values (phone numbers).
 * AES-256-GCM with a random 96-bit IV. Stored layout: iv(12) | tag(16) | ciphertext.
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
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptField(blob, aad, version = CURRENT_KEY_VERSION) {
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
  return crypto.createHmac('sha256', Buffer.from(config.PHONE_HASH_KEY, 'hex')).update(value).digest();
}

export function hashOtp(code, scope) {
  return crypto.createHmac('sha256', Buffer.from(config.OTP_HASH_KEY, 'hex')).update(`${scope}:${code}`).digest();
}

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest();
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const randomOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
export const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
