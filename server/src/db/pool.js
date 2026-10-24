import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

export const pool = mysql.createPool({
  uri: config.DATABASE_URL,
  connectionLimit: 20,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30_000,
  connectTimeout: 5_000,
  timezone: 'Z', // DATETIME values are read and written as UTC
  charset: 'utf8mb4_0900_ai_ci',
  supportBigNumbers: true,
});

// Make NOW() and CURRENT_TIMESTAMP defaults UTC on every pooled connection.
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** SELECT helper: returns rows. Values are bound with ? placeholders and escaped by the driver. */
export async function q(db, sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

/** INSERT/UPDATE/DELETE helper: returns affectedRows, insertId, etc. */
export async function exec(db, sql, params = []) {
  const [result] = await db.query(sql, params);
  return result;
}

/** Run fn inside a transaction; commits on success, rolls back on any error. */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
