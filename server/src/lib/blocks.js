/**
 * SQL fragment: true when neither user has blocked the other. `col` is the SQL expression holding the other
 * person's id (for example `p.author_id`). Two placeholders, in order: me, me.
 */
export const NOT_BLOCKED = (col) => `NOT EXISTS (
  SELECT 1 FROM blocks bk
   WHERE (bk.blocker_id = ? AND bk.blocked_id = ${col}) OR (bk.blocker_id = ${col} AND bk.blocked_id = ?))`;

export const NOT_BLOCKED_PLACEHOLDERS = 2;
