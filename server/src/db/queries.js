// server/src/db/queries.js
// Phase 9 — save/load session queries against the schema in migrations/001_sessions.sql.
//
// Schema:
//   sessions(id SERIAL PK, share_id VARCHAR(12) UNIQUE, state_json JSONB,
//            created_at TIMESTAMPTZ, last_accessed TIMESTAMPTZ)
//
// All callers should treat a missing pool as a soft-fail (return null / throw a
// user-meaningful error) — the rest of the app stays functional without a DB.

import { getPool } from './pool.js';
import { nanoid } from 'nanoid';

/**
 * Insert a new session snapshot, returning its share_id.
 * @param {object} state    - full session payload (bodies, simTime, chatHistory, …)
 * @param {string|null} userId - Supabase user id (frontend §8.1) or null for anonymous
 * @returns {Promise<{ shareId: string }>}
 */
export async function saveSession(state, userId = null) {
  const pool = getPool();
  if (!pool) throw new Error('Database not configured');

  const shareId = nanoid(12);
  await pool.query(
    `INSERT INTO sessions (share_id, state_json, user_id, created_at, last_accessed)
     VALUES ($1, $2::jsonb, $3, NOW(), NOW())`,
    [shareId, JSON.stringify(state), userId]
  );
  return { shareId };
}

/**
 * Look up a session by its share_id. Touches last_accessed for cleanup heuristics.
 * @param {string} shareId
 * @returns {Promise<object|null>} the state_json, or null if not found
 */
export async function loadSession(shareId) {
  const pool = getPool();
  if (!pool) throw new Error('Database not configured');

  const { rows } = await pool.query(
    `UPDATE sessions
        SET last_accessed = NOW()
      WHERE share_id = $1
   RETURNING state_json`,
    [shareId]
  );
  return rows[0]?.state_json ?? null;
}

/**
 * Delete sessions older than the given number of days. Run as a cron.
 * @param {number} days
 */
export async function purgeOldSessions(days = 30) {
  const pool = getPool();
  if (!pool) return 0;
  const { rowCount } = await pool.query(
    `DELETE FROM sessions WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return rowCount;
}

/**
 * Idempotent schema bootstrap — runs once at server start.
 * Safe to call repeatedly; uses IF NOT EXISTS.
 */
export async function ensureSchema() {
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            SERIAL PRIMARY KEY,
      share_id      VARCHAR(12) UNIQUE NOT NULL,
      state_json    JSONB NOT NULL,
      user_id       UUID NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id UUID NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_share_id ON sessions(share_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON sessions(user_id);
  `);
  console.log('[DB] Schema ensured');
}
