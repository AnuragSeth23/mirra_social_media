/*
 * IDs are plain numbers (1, 2, 3, ...): BIGINT UNSIGNED AUTO_INCREMENT in MySQL, so they read the same in any database client.
 * In the app and in JSON they are strings of digits. IDs are identifiers, not secrets, so they are not encrypted; every endpoint
 * checks who may see a row, so a guessable id is not a way in.
 * (toBin/fromBin keep the names from when ids were BINARY(16): they validate an id on the way in and give a string on the way out.)
 */
const ID_RE = /^[1-9]\d{0,17}$/;

export const isId = (v) => (typeof v === 'string' || typeof v === 'number') && ID_RE.test(String(v));

/** App id -> value to store/compare in the database. */
export function toBin(id) {
  if (!isId(id)) throw new Error('Invalid id');
  return String(id);
}

/** Database value -> app id. */
export const fromBin = (value) => String(value);

/** The smaller id first, compared as numbers: the key that names a pair of people ("12_40"). */
export const pairOf = (a, b) => (BigInt(a) < BigInt(b) ? `${a}_${b}` : `${b}_${a}`);
