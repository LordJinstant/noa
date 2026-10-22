'use strict';

/**
 * Copy NOA's SQLite database (users.db) into Supabase Postgres.
 *
 * JSON files (admins.json, posts.json, certificates, AI, class history)
 * are not in SQLite and are left where they are.
 *
 * Usage (from the folder that contains server.js):
 *   npm install pg better-sqlite3
 *   # .env must contain DATABASE_URL (Supabase session/direct URI, port 5432)
 *   node migrate-sqlite-to-postgres.js
 *   node migrate-sqlite-to-postgres.js ./users.db
 *   node migrate-sqlite-to-postgres.js ./users.db --replace
 *
 * --replace truncates the Postgres tables first. Without it, the script
 * refuses to run if Postgres already has users.
 *
 * The script boots server.js with NOA_SCHEMA_ONLY=1 so the same CREATE TABLE
 * statements build the Postgres schema before rows are copied.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();

const TABLES = [
  'users',
  'staff_follows',
  'assessments',
  'quizzes',
  'quiz_questions',
  'quiz_attempts',
  'quiz_retake_allows',
  'quiz_retakes',
  'staff_ratings',
  'msg_channels',
  'msg_messages',
  'msg_channel_reads',
  'msg_mutes'
];

const CONFLICT = {
  users: ['id'],
  staff_follows: ['id'],
  assessments: ['id'],
  quizzes: ['id'],
  quiz_questions: ['id'],
  quiz_attempts: ['id'],
  quiz_retake_allows: ['quiz_id', 'student_id'],
  quiz_retakes: ['quiz_id', 'student_id'],
  staff_ratings: ['id'],
  msg_channels: ['id'],
  msg_messages: ['id'],
  msg_channel_reads: ['user_key', 'channel_id'],
  msg_mutes: ['user_id']
};

function quoteIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error('Unexpected column name: ' + name);
  }
  return '"' + name.toLowerCase() + '"';
}

function ensureSchema() {
  console.log('Creating Postgres schema (NOA_SCHEMA_ONLY)…');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, { NOA_SCHEMA_ONLY: '1' }),
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error('Schema setup failed (exit ' + result.status + ').');
    process.exit(result.status || 1);
  }
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--');
  const replace = args.indexOf('--replace') !== -1;
  const fileArg = args.find(a => a !== '--replace');
  const sqlitePath = path.resolve(fileArg || process.env.SQLITE_PATH || process.env.USERS_DB || path.join(__dirname, 'users.db'));
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';

  if (!databaseUrl) {
    console.error('Set DATABASE_URL to your Supabase Postgres URI before migrating.');
    process.exit(1);
  }
  if (!fs.existsSync(sqlitePath)) {
    console.error('SQLite file not found: ' + sqlitePath);
    process.exit(1);
  }

  let BetterSqlite;
  try {
    BetterSqlite = require('better-sqlite3');
  } catch (e) {
    console.error('Install better-sqlite3 to read the old file: npm install better-sqlite3');
    process.exit(1);
  }
  const { Pool } = require('pg');

  ensureSchema();

  const sqlite = new BetterSqlite(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/i.test(databaseUrl) ? false : { rejectUnauthorized: false },
    max: 1,
    application_name: 'noa-sqlite-migrate'
  });

  const existing = new Set();
  const reg = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  reg.rows.forEach(r => existing.add(r.tablename));

  const userCount = existing.has('users')
    ? Number((await pool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c)
    : 0;
  if (userCount > 0 && !replace) {
    console.error('Postgres already has ' + userCount + ' user row(s). Re-run with --replace to overwrite table data.');
    await pool.end();
    sqlite.close();
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (replace) {
      const present = TABLES.filter(t => existing.has(t));
      if (present.length) {
        console.log('Truncating ' + present.join(', '));
        await client.query('TRUNCATE ' + present.map(quoteIdent).join(', ') + ' RESTART IDENTITY CASCADE');
      }
    }

    for (const table of TABLES) {
      const sqliteHas = sqlite.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(table);
      if (!sqliteHas) {
        console.log('skip ' + table + ' (not in SQLite)');
        continue;
      }
      if (!existing.has(table)) {
        console.log('skip ' + table + ' (not in Postgres)');
        continue;
      }

      const sqliteCols = sqlite.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name);
      const pgColsRes = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [table]
      );
      const pgCols = new Set(pgColsRes.rows.map(r => r.column_name));
      const cols = sqliteCols.filter(c => pgCols.has(c.toLowerCase()));
      const skipped = sqliteCols.filter(c => !pgCols.has(c.toLowerCase()));
      if (!cols.length) {
        console.log('skip ' + table + ' (no shared columns)');
        continue;
      }

      const rows = sqlite.prepare('SELECT ' + cols.map(c => '"' + c.replace(/"/g, '') + '"').join(', ') + ' FROM ' + table).all();
      console.log(table + ': ' + rows.length + ' row(s)' + (skipped.length ? ' (skipped columns ' + skipped.join(', ') + ')' : ''));
      if (!rows.length) continue;

      const colSql = cols.map(c => quoteIdent(c)).join(', ');
      const conflict = (CONFLICT[table] || []).filter(c => cols.some(col => col.toLowerCase() === c));
      const onConflict = conflict.length
        ? ' ON CONFLICT (' + conflict.map(quoteIdent).join(', ') + ') DO NOTHING'
        : '';

      const width = cols.length;
      const batchSize = Math.max(1, Math.floor(5000 / width));
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const values = [];
        const groups = batch.map((row, rowIndex) => {
          const placeholders = cols.map((col, colIndex) => {
            values.push(row[col] === undefined ? null : row[col]);
            return '$' + (rowIndex * width + colIndex + 1);
          });
          return '(' + placeholders.join(', ') + ')';
        });
        await client.query(
          'INSERT INTO ' + quoteIdent(table) + ' (' + colSql + ') VALUES ' + groups.join(', ') + onConflict,
          values
        );
      }

      if (pgCols.has('id')) {
        await client.query(
          "SELECT setval(pg_get_serial_sequence('" + table + "', 'id'), " +
          "GREATEST(COALESCE((SELECT MAX(id) FROM " + quoteIdent(table) + "), 1), 1), " +
          "(SELECT MAX(id) IS NOT NULL FROM " + quoteIdent(table) + "))"
        );
      }
    }

    await client.query('COMMIT');
    console.log('Migration finished.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});