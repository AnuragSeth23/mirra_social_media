import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

/*
 * Applies migrations/*.sql in name order and records them in schema_migrations.
 * Note: MySQL commits DDL implicitly, so a migration that fails halfway is NOT rolled back.
 * Keep one logical change per file, and test on a copy of production data before running there.
 */
const dir = path.resolve(process.cwd(), 'migrations');

async function main() {
  const conn = await mysql.createConnection({ uri: config.DATABASE_URL, multipleStatements: true, timezone: 'Z' });
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') || f.endsWith('.js')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      try {
        // .sql files run as written; .js files export a default async function (conn) for changes SQL cannot express
        if (file.endsWith('.js')) await (await import(pathToFileURL(path.join(dir, file)).href)).default(conn);
        else await conn.query(await readFile(path.join(dir, file), 'utf8'));
        await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        console.log(`applied ${file}`);
      } catch (err) {
        console.error(`failed ${file}:`, err.message);
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    await conn.end();
  }
}

main();
