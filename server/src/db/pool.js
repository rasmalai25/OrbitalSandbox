// server/src/db/pool.js
// Phase 9 — PostgreSQL connection pool.
// Returns null if DATABASE_URL is unset; callers fall back to localStorage / no-op.

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

let pool = null;
let poolAttempted = false;

export function getPool() {
  if (pool) return pool;
  if (poolAttempted) return null; // failed previously — don't keep retrying
  poolAttempted = true;

  if (!process.env.DATABASE_URL) {
    console.warn('[DB] DATABASE_URL not set — session save/load will fall back to localStorage');
    return null;
  }

  // Supabase requires SSL but does not validate the cert chain on the free tier.
  // Setting `ssl: false` for plain local Postgres dev via DATABASE_SSL=off.
  const ssl = process.env.DATABASE_SSL === 'off'
    ? false
    : { rejectUnauthorized: false };

  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
    pool.on('error', err => console.error('[DB] Pool error:', err));
    console.log('[DB] Pool initialised');
    return pool;
  } catch (err) {
    console.error('[DB] Failed to create pool:', err);
    return null;
  }
}

/** Returns true if a DB connection is available. */
export function isDbAvailable() {
  return !!getPool();
}
