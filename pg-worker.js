'use strict';

/**
 * Runs Postgres queries off the main thread.
 * The parent blocks on a SharedArrayBuffer so server.js can keep its sync DB calls.
 */

const { workerData } = require('worker_threads');
const { Pool, types } = require('pg');

if (!workerData || !workerData.sab) {
  console.error('pg-worker.js is started by pg-sqlite.js, not directly.');
  process.exit(1);
}

// bigint (COUNT/SUM) and numeric come back as strings by default.
types.setTypeParser(20, (v) => (v == null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v == null ? null : Number(v)));

const HEADER = 8;
const STATE = 0;
const LENGTH = 1;
const IDLE = 0;
const REQUEST = 1;
const OK = 2;
const ERR = 3;
const READY = 10;

const int32 = new Int32Array(workerData.sab);
const bytes = new Uint8Array(workerData.sab);

function sslOption(connectionString) {
  if (process.env.DATABASE_SSL === 'disable') return false;
  if (/sslmode=disable/i.test(connectionString)) return false;
  const local = /\/\/(?:[^@/]+@)?(localhost|127\.0\.0\.1)(?::|\/|$)/i.test(connectionString);
  if (local && !/sslmode=require/i.test(connectionString)) return false;
  return { rejectUnauthorized: false };
}

function writeJson(obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  if (buf.length > bytes.length - HEADER) {
    throw new Error('Result is larger than the Postgres buffer. Raise NOA_PG_BUFFER_MB.');
  }
  bytes.set(buf, HEADER);
  Atomics.store(int32, LENGTH, buf.length);
}

function readJson() {
  const len = Atomics.load(int32, LENGTH);
  if (!len) return null;
  const json = Buffer.from(bytes.subarray(HEADER, HEADER + len)).toString('utf8');
  return JSON.parse(json);
}

function signal(state) {
  Atomics.store(int32, STATE, state);
  Atomics.notify(int32, STATE, 1);
}

const pool = new Pool({
  connectionString: workerData.connectionString,
  ssl: sslOption(workerData.connectionString),
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  application_name: 'noa-server'
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err.message);
});

async function serve() {
  try {
    const probe = await pool.query('SELECT 1 AS ok');
    if (!probe || !probe.rows) throw new Error('Empty probe result');
  } catch (e) {
    try {
      writeJson({ ok: false, error: e.message, code: e.code || '' });
    } catch (writeErr) {}
    signal(ERR);
    try { await pool.end(); } catch (endErr) {}
    return;
  }

  signal(READY);
  while (Atomics.load(int32, STATE) === READY) {
    Atomics.wait(int32, STATE, READY, 1000);
  }

  while (true) {
    let state = Atomics.load(int32, STATE);
    while (state !== REQUEST) {
      Atomics.wait(int32, STATE, state, 1000);
      state = Atomics.load(int32, STATE);
    }

    let sql = '';
    try {
      const msg = readJson();
      sql = msg && msg.sql ? String(msg.sql) : '';
      if (!sql) throw new Error('Empty SQL');
      const result = await pool.query(sql);
      writeJson({
        ok: true,
        rows: result.rows || [],
        rowCount: result.rowCount == null ? 0 : result.rowCount
      });
      signal(OK);
    } catch (e) {
      try {
        writeJson({ ok: false, error: e.message || String(e), code: e.code || '' });
      } catch (writeErr) {
        try {
          writeJson({ ok: false, error: 'Query failed and the error payload did not fit', code: '' });
        } catch (e2) {}
      }
      signal(ERR);
    }

    state = Atomics.load(int32, STATE);
    while (state === OK || state === ERR) {
      Atomics.wait(int32, STATE, state, 1000);
      state = Atomics.load(int32, STATE);
    }
  }
}

serve().catch(async (e) => {
  console.error('Postgres worker crashed:', e && e.message ? e.message : e);
  try {
    writeJson({ ok: false, error: e.message || String(e), code: '' });
    signal(ERR);
  } catch (err) {}
  try { await pool.end(); } catch (endErr) {}
  process.exit(1);
});