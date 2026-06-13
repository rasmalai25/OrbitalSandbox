// server/src/db/queries.js
// Phase 9 — save/load session queries.

import { getPool } from './pool.js';

export async function saveSession(sessionId, data) {
  const pool = getPool();
  if (!pool) return { error: 'DB not configured' };
  const { rows } = await pool.query(
    `INSERT INTO sessions (id, data, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()
     RETURNING id`,
    [sessionId, JSON.stringify(data)]
  );
  return rows[0];
}

export async function loadSession(sessionId) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query('SELECT data FROM sessions WHERE id = $1', [sessionId]);
  return rows[0]?.data ?? null;
}

export async function deleteSession(sessionId) {
  const pool = getPool();
  if (!pool) return;
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
