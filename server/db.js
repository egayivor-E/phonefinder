/**
 * Database layer — PostgreSQL (Supabase recommended for production).
 *
 *  - Production: set DATABASE_URL to your Supabase connection string.
 *  - Local dev:  no env needed — automatically uses an in-memory PostgreSQL
 *    (pg-mem), perfect for testing. Data resets when the server stops.
 *
 * Query helpers accept '?' placeholders (auto-converted to $1..$n).
 */
const url = process.env.DATABASE_URL || '';
let pool;

if (url && !url.startsWith('pgmem')) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: url.replace(/[?&]pgbouncer=true/g, ''),
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (e) => console.error('Database pool error:', e.message));
} else {
  try {
    const { newDb } = require('pg-mem');
    const pg = newDb().adapters.createPg();
    pool = new pg.Pool();
    console.log('ℹ️  DATABASE_URL not set — using in-memory PostgreSQL (local testing only).');
  } catch {
    console.error('DATABASE_URL is required in production (Supabase connection string).');
    process.exit(1);
  }
}

function execute(sql, params = []) {
  let i = 0;
  const q = sql.replace(/\?/g, () => `$${++i}`);
  return pool.query(q, params);
}

const all = async (sql, ...params) => (await execute(sql, params)).rows;
const get = async (sql, ...params) => (await execute(sql, params)).rows[0];
const run = async (sql, ...params) => {
  const r = await execute(sql, params);
  return { rowCount: r.rowCount, rows: r.rows };
};

async function initSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
       id            BIGSERIAL PRIMARY KEY,
       email         TEXT UNIQUE NOT NULL,
       password_hash TEXT NOT NULL,
       created_at    TIMESTAMPTZ DEFAULT now(),
       org_id        BIGINT,
       role          TEXT NOT NULL DEFAULT 'member',
       consent_at    TIMESTAMPTZ
     )`,
    `CREATE TABLE IF NOT EXISTS orgs (
       id          BIGSERIAL PRIMARY KEY,
       name        TEXT NOT NULL,
       invite_code TEXT UNIQUE NOT NULL,
       created_at  TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS devices (
       id            TEXT PRIMARY KEY,
       user_id       BIGINT NOT NULL REFERENCES users(id),
       name          TEXT NOT NULL,
       model         TEXT,
       created_at    TIMESTAMPTZ DEFAULT now(),
       locked        SMALLINT NOT NULL DEFAULT 0,
       lock_message  TEXT,
       lock_contact  TEXT,
       lock_pin_hash TEXT,
       wiped_at      TIMESTAMPTZ
     )`,
    `CREATE TABLE IF NOT EXISTS locations (
       id        BIGSERIAL PRIMARY KEY,
       device_id TEXT NOT NULL REFERENCES devices(id),
       lat       DOUBLE PRECISION NOT NULL,
       lng       DOUBLE PRECISION NOT NULL,
       accuracy  DOUBLE PRECISION,
       battery   DOUBLE PRECISION,
       charging  SMALLINT DEFAULT 0,
       ts        TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_loc_device ON locations(device_id, ts)`,
    `CREATE TABLE IF NOT EXISTS commands (
       id         BIGSERIAL PRIMARY KEY,
       device_id  TEXT NOT NULL,
       type       TEXT NOT NULL,
       payload    TEXT,
       created_at TIMESTAMPTZ DEFAULT now(),
       delivered  SMALLINT DEFAULT 0
     )`,
    `CREATE TABLE IF NOT EXISTS audit_log (
       id        BIGSERIAL PRIMARY KEY,
       actor_id  BIGINT,
       action    TEXT NOT NULL,
       device_id TEXT,
       ts        TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS geofences (
       id         BIGSERIAL PRIMARY KEY,
       org_id     BIGINT NOT NULL REFERENCES orgs(id),
       name       TEXT NOT NULL,
       lat        DOUBLE PRECISION NOT NULL,
       lng        DOUBLE PRECISION NOT NULL,
       radius_m   DOUBLE PRECISION NOT NULL,
       mode       TEXT NOT NULL DEFAULT 'both',
       created_by BIGINT,
       created_at TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS fence_state (
       device_id TEXT NOT NULL,
       fence_id  BIGINT NOT NULL,
       inside    SMALLINT NOT NULL,
       since     TIMESTAMPTZ DEFAULT now(),
       PRIMARY KEY (device_id, fence_id)
     )`,
    `CREATE TABLE IF NOT EXISTS fence_events (
       id        BIGSERIAL PRIMARY KEY,
       org_id    BIGINT NOT NULL,
       fence_id  BIGINT,
       device_id TEXT,
       kind      TEXT NOT NULL,
       ts        TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_fence_events_org ON fence_events(org_id, id)`,
  ];
  for (const s of stmts) await pool.query(s);
}

module.exports = { all, get, run, initSchema };
