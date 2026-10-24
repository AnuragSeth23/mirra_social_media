/*
 * Time-based one-time passwords (TOTP, RFC 6238), the "6-digit code that changes every 30 seconds" used by Google
 * Authenticator, Microsoft Authenticator, Authy and others. Built on Node's own crypto; nothing is sent to any service.
 */
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('not base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), as the text people type or scan into their authenticator app. */
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}

export const stepAt = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);
export const codeForStep = (secret, step) => hotp(base32Decode(secret), step);

/** Returns the 30-second step the code belongs to (this one, or one either side to allow for clock drift), or null. */
export function matchStep(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const secretBuf = base32Decode(secret);
  const want = Buffer.from(code);
  for (const drift of [0, -1, 1]) {
    const step = stepAt(now) + drift;
    const have = Buffer.from(hotp(secretBuf, step));
    if (crypto.timingSafeEqual(have, want)) return step;
  }
  return null;
}

export const otpauthUrl = (secret, account, issuer = 'SocialAmbak') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
