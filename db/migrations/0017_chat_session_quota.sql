-- 0017_chat_session_quota.sql
-- Adds message_count to chat_sessions for persistent per-session quota tracking.
-- Previously quota was in-memory only and lost on restart / eviction.

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS message_count INT NOT NULL DEFAULT 0;

-- Index for efficient quota lookups by session ID (already PK, but adding
-- a partial index for active sessions to speed up pruning if needed later).
CREATE INDEX IF NOT EXISTS idx_chat_sessions_active
  ON chat_sessions(started_at DESC)
  WHERE ended_at IS NULL;
