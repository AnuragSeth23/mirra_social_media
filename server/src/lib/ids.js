import crypto from 'node:crypto';

/*
 * IDs are UUIDv7 strings in the app and lowercase UUID text (CHAR(36)) in MySQL, so they are readable in any database client
 * and can be searched with WHERE id = '019...'. IDs are identifiers, not secrets, so they are not encrypted.
 * v7 puts a millisecond timestamp first, so new rows land at the end of InnoDB's clustered index
 * (fast inserts, no random page splits), while staying unguessable and safe to expose.
 */
const bytesToUuid = (b) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function uuidv7() {
  const b = crypto.randomBytes(16);
  const ms = Date.now();
  b.writeUIntBE(ms, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(b);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** App id -> value to store/compare in the database. (The name dates from when ids were BINARY(16); it still validates the id.) */
export function toBin(id) {
  if (!UUID_RE.test(id)) throw new Error('Invalid id');
  return id.toLowerCase();
}

/** Database value -> app id. Accepts the CHAR(36) text, or raw 16 bytes. */
export function fromBin(value) {
  return Buffer.isBuffer(value) ? bytesToUuid(value) : String(value).toLowerCase();
}

export const isUuid = (v) => UUID_RE.test(v);
