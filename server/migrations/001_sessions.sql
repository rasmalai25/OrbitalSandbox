-- Phase 9 — schema for shareable saved sessions.
-- Run once against the target Postgres database (e.g. via Supabase SQL editor).
-- The server also runs an idempotent CREATE TABLE IF NOT EXISTS at boot
-- via ensureSchema() in db/queries.js, so applying this manually is optional
-- but recommended for production where the server account may not have
-- CREATE TABLE rights.

CREATE TABLE IF NOT EXISTS sessions (
  id            SERIAL PRIMARY KEY,
  share_id      VARCHAR(12) UNIQUE NOT NULL,    -- URL slug, e.g. "xK9mP2aLqR7v"
  state_json    JSONB NOT NULL,                  -- full session snapshot
  user_id       UUID NULL,                       -- nullable: anon sessions stay anon (frontend §8.1)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_share_id ON sessions(share_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON sessions(user_id);

-- Migration shim — applied tables created by earlier deploys may lack user_id
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id UUID NULL;

-- Optional: auto-purge sessions untouched for 30 days. Run as a Supabase cron.
-- DELETE FROM sessions WHERE last_accessed < NOW() - INTERVAL '30 days';
