// server/src/db/pool.js
// Phase 9 — PostgreSQL connection pool.
// In Phases 0–8 this module is imported but never called (DATABASE_URL is unset).

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      console.warn('[DB] DATABASE_URL not set — database features disabled');
      return null;
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}
