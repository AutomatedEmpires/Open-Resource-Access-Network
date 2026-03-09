-- ============================================================
-- 0040 — Chat Quota Window
-- ============================================================
-- 24-hour rolling quota window for chat.
-- Keyed by 'user:<userId>' for authenticated users (cross-device)
-- or 'device:<deviceId>' for anonymous sessions.
-- On increment both keys are written when a userId is known,
-- so that logout-then-reuse on the same device is prevented and
-- quota is enforced across all devices for signed-in accounts.
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_quota_windows (
  key           TEXT        PRIMARY KEY,
  message_count INT         NOT NULL DEFAULT 0,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speed up cleanup sweeps and quota-reset checks
CREATE INDEX IF NOT EXISTS idx_cqw_reset_at ON chat_quota_windows(reset_at);
