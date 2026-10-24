import crypto from 'node:crypto';

/*
 * IDs are UUIDv7 strings in the app and BINARY(16) in MySQL.
 * v7 puts a millisecond timestamp first, so new rows land at the end of InnoDB's clustered index
 * (fast inserts, no random page splits), while staying unguessable and safe to expose.
 */
export function uuidv7() {
  const b = crypto.randomBytes(16);
  const ms = Date.now();
  b.writeUIntBE(ms, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return fromBin(b);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toBin(id) {
  if (!UUID_RE.test(id)) throw new Error('Invalid id');
  return Buffer.from(id.replace(/-/g, ''), 'hex');
}

export function fromBin(buf) {
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isUuid = (v) => UUID_RE.test(v);
