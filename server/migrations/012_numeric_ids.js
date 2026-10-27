/*
 * IDs become plain numbers (1, 2, 3, ...) with AUTO_INCREMENT instead of UUID text.
 * Every existing row keeps its place: rows are numbered per table in their old (time-ordered) id order, and every column that
 * pointed at an old id is rewritten to the new number. Nothing is deleted except values that were bound to the old ids and cannot be moved:
 * two-factor backup codes and pending OTP/recovery codes (users get new ones).
 *
 * Steps: (1) build old->new maps, (2) re-encrypt the fields whose encryption is bound to the user id (email, phone, 2FA secret),
 * (3) drop all foreign keys (MySQL will not change a key column's type while a key uses it), (4) rewrite ids and references as text numbers,
 * (5) change the columns to BIGINT UNSIGNED, (6) rebuild pair keys, (7) add the same foreign keys back (this checks every row).
 * MySQL commits DDL implicitly, so run it on a copy first. A failure part-way needs a restore, not a re-run.
 */
import { CURRENT_KEY_VERSION, decryptField, encryptField } from '../src/lib/crypto.js';

const POLY = { user: 'users', post: 'posts', comment: 'comments', story: 'stories', message: 'messages', conversation: 'conversations' };
const ID = (t) => `\`${t}\``;

export default async function up(db) {
  const q = async (sql, params) => (await db.query(sql, params))[0];
  const one = async (sql, params) => (await q(sql, params))[0];

  const users = await one("SELECT data_type AS ty FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'id'");
  if (users.ty !== 'char') return; // already numeric

  const entities = (await q("SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND data_type = 'char' ORDER BY table_name")).map((r) => r.t);
  const fks = await q(`SELECT k.constraint_name AS name, k.table_name AS tbl, k.column_name AS col, k.referenced_table_name AS ref, k.referenced_column_name AS refcol, k.ordinal_position AS pos, r.delete_rule AS del, r.update_rule AS upd
    FROM information_schema.key_column_usage k
    JOIN information_schema.referential_constraints r ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name AND r.table_name = k.table_name
    WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name, k.constraint_name`);
  if (fks.some((f) => f.pos !== 1)) throw new Error('A composite foreign key was found; this migration expects single-column keys.');

  // every char(36) column must be accounted for, so nothing keeps an old id by accident
  const ent = new Set(entities);
  const refs = fks.filter((f) => ent.has(f.ref)).map((f) => ({ tbl: f.tbl, col: f.col, ref: f.ref }));
  refs.push({ tbl: 'sessions', col: 'replaced_by', ref: 'sessions' });
  const poly = [
    { tbl: 'reports', col: 'target_id', typeCol: 'target_type' },
    { tbl: 'activity_log', col: 'target_id', typeCol: 'target_type' },
  ];
  const own = entities.map((t) => `${t}.id`);
  const handled = new Set([...own, ...refs.map((r) => `${r.tbl}.${r.col}`), ...poly.map((p) => `${p.tbl}.${p.col}`), 'sessions.family_id']);
  const chars = await q("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND column_type = 'char(36)'");
  const loose = chars.map((c) => `${c.t}.${c.c}`).filter((n) => !handled.has(n));
  if (loose.length) throw new Error(`Unhandled id columns: ${loose.join(', ')}`);

  const nullable = new Map((await q("SELECT table_name AS t, column_name AS c, is_nullable AS n FROM information_schema.columns WHERE table_schema = DATABASE()")).map((r) => [`${r.t}.${r.c}`, r.n === 'YES']));
  const onUpdate = new Map();
  for (const r of await q("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND extra LIKE '%on update%'")) (onUpdate.get(r.t) ?? onUpdate.set(r.t, []).get(r.t)).push(r.c);
  const keep = (t) => (onUpdate.get(t) ?? []).map((c) => `, ${ID(t)}.${ID(c)} = ${ID(t)}.${ID(c)}`).join(''); // an id rewrite is not an "edit"

  // (1) old -> new maps, numbered in old-id order (UUIDv7 is time-ordered, so oldest row = 1)
  for (const t of entities) {
    await q(`DROP TABLE IF EXISTS _map_${t}`);
    await q(`CREATE TABLE _map_${t} (old CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, new BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, UNIQUE KEY (new)) ENGINE=InnoDB`);
    await q(`INSERT INTO _map_${t} (old) SELECT id FROM ${ID(t)} ORDER BY id`);
  }

  // things bound to the old ids that cannot be moved
  await q('DELETE FROM backup_codes');
  await q('DELETE FROM verification_codes');
  await q('DELETE FROM recovery_requests');

  // (2) re-encrypt with the new id as associated data
  const people = await q(`SELECT u.id AS oldId, m.new AS newId, u.email_ciphertext, u.email_key_version, u.phone_ciphertext, u.phone_key_version, u.totp_secret_enc
    FROM users u JOIN _map_users m ON m.old = u.id`);
  for (const p of people) {
    const email = p.email_ciphertext ? encryptField(decryptField(p.email_ciphertext, `users.email:${p.oldId}`, p.email_key_version), `users.email:${p.newId}`) : null;
    const phone = encryptField(decryptField(p.phone_ciphertext, `users.phone:${p.oldId}`, p.phone_key_version), `users.phone:${p.newId}`);
    const totp = p.totp_secret_enc ? encryptField(decryptField(p.totp_secret_enc, `users.totp:${p.oldId}`), `users.totp:${p.newId}`) : null;
    await q(`UPDATE users SET email_ciphertext = ?, email_key_version = ?, phone_ciphertext = ?, phone_key_version = ?, totp_secret_enc = ?${keep('users')} WHERE id = ?`, [email, CURRENT_KEY_VERSION, phone, CURRENT_KEY_VERSION, totp, p.oldId]);
  }

  // (3) drop every foreign key
  for (const f of fks) await q(`ALTER TABLE ${ID(f.tbl)} DROP FOREIGN KEY ${ID(f.name)}`);

  // (4) rewrite ids and references as numbers (still text columns at this point)
  const through = (t, col, ref) => `UPDATE ${ID(t)} JOIN ${ID(`_map_${ref}`)} m ON m.old = ${ID(t)}.${ID(col)} SET ${ID(t)}.${ID(col)} = CAST(m.new AS CHAR)${keep(t)}`;
  for (const r of refs) await q(through(r.tbl, r.col, r.ref));
  for (const p of poly) for (const [type, table] of Object.entries(POLY)) {
    if (!ent.has(table)) continue;
    await q(`UPDATE ${ID(p.tbl)} JOIN ${ID(`_map_${table}`)} m ON m.old = ${ID(p.tbl)}.${ID(p.col)} SET ${ID(p.tbl)}.${ID(p.col)} = CAST(m.new AS CHAR) WHERE ${ID(p.tbl)}.${ID(p.typeCol)} = ?`, [type]);
  }
  for (const t of entities) await q(`UPDATE ${ID(t)} JOIN ${ID(`_map_${t}`)} m ON m.old = ${ID(t)}.id SET ${ID(t)}.id = CAST(m.new AS CHAR)${keep(t)}`);
  // a refresh-token family used to have its own random id; now any one of its sessions' ids names it
  await q('UPDATE sessions s JOIN (SELECT family_id AS fam, MIN(id) AS pick FROM sessions GROUP BY family_id) g ON g.fam = s.family_id SET s.family_id = g.pick');

  // values that point at rows that no longer exist (never keys, but be strict): drop or null them
  for (const r of [...refs, ...poly.map((p) => ({ tbl: p.tbl, col: p.col }))]) {
    const bad = `${ID(r.col)} IS NOT NULL AND ${ID(r.col)} NOT REGEXP '^[0-9]+$'`;
    if (nullable.get(`${r.tbl}.${r.col}`)) await q(`UPDATE ${ID(r.tbl)} SET ${ID(r.col)} = NULL WHERE ${bad}`);
    else await q(`DELETE FROM ${ID(r.tbl)} WHERE ${bad}`);
  }
  await q("UPDATE sessions SET family_id = id WHERE family_id NOT REGEXP '^[0-9]+$'");

  // (5) change the column types
  const alters = new Map();
  const add = (t, sql) => (alters.get(t) ?? alters.set(t, []).get(t)).push(sql);
  for (const t of entities) add(t, `MODIFY ${ID('id')} BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`);
  for (const r of [...refs, ...poly, { tbl: 'sessions', col: 'family_id' }]) add(r.tbl, `MODIFY ${ID(r.col)} BIGINT UNSIGNED ${nullable.get(`${r.tbl}.${r.col}`) ? 'NULL' : 'NOT NULL'}`);
  for (const [t, parts] of alters) await q(`ALTER TABLE ${ID(t)} ${parts.join(', ')}`);
  for (const t of entities) {
    const { top } = await one(`SELECT COALESCE(MAX(id), 0) + 1 AS top FROM ${ID(t)}`);
    await q(`ALTER TABLE ${ID(t)} AUTO_INCREMENT = ${Number(top)}`);
  }

  // (6) pair keys are "<smaller id>_<larger id>", now compared as numbers
  await q("UPDATE friendships SET pair_key = CONCAT(LEAST(requester_id, addressee_id), '_', GREATEST(requester_id, addressee_id))");
  await q(`UPDATE conversations c JOIN (SELECT conversation_id AS cid, MIN(user_id) AS a, MAX(user_id) AS b FROM conversation_members GROUP BY conversation_id HAVING COUNT(*) = 2) m ON m.cid = c.id
    SET c.dm_key = CONCAT(m.a, '_', m.b) WHERE c.dm_key IS NOT NULL`);
  await q('ALTER TABLE friendships MODIFY pair_key VARCHAR(41) CHARACTER SET ascii COLLATE ascii_bin NOT NULL');
  await q('ALTER TABLE conversations MODIFY dm_key VARCHAR(41) CHARACTER SET ascii COLLATE ascii_bin NULL');

  // (7) the same foreign keys again
  for (const f of fks) await q(`ALTER TABLE ${ID(f.tbl)} ADD CONSTRAINT ${ID(f.name)} FOREIGN KEY (${ID(f.col)}) REFERENCES ${ID(f.ref)} (${ID(f.refcol)}) ON DELETE ${f.del} ON UPDATE ${f.upd}`);

  for (const t of entities) await q(`DROP TABLE _map_${t}`);
}
