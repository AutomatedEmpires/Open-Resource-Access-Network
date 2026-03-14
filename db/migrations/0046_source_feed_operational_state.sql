-- ============================================================
-- Migration 0046: Source Feed Operational State
-- ============================================================
-- Adds durable rollout state for pollable source feeds so operators can:
--   - choose publication mode per feed
--   - emergency-pause a feed without deleting it
--   - narrow or exclude 211 data owners for canary and replay runs
--   - persist sync attempt windows and checkpoint cursors
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS source_feed_states (
  source_feed_id                    UUID PRIMARY KEY REFERENCES source_feeds(id) ON DELETE CASCADE,
  publication_mode                  TEXT NOT NULL DEFAULT 'review_required' CHECK (
                                      publication_mode IN ('canonical_only', 'review_required', 'auto_publish')
                                    ),
  emergency_pause                   BOOLEAN NOT NULL DEFAULT false,
  included_data_owners              JSONB NOT NULL DEFAULT '[]',
  excluded_data_owners              JSONB NOT NULL DEFAULT '[]',
  max_organizations_per_poll        INT CHECK (max_organizations_per_poll IS NULL OR max_organizations_per_poll > 0),
  checkpoint_cursor                 TEXT,
  replay_from_cursor                TEXT,
  last_attempt_status               TEXT NOT NULL DEFAULT 'idle' CHECK (
                                      last_attempt_status IN ('idle', 'running', 'succeeded', 'failed')
                                    ),
  last_attempt_started_at           TIMESTAMPTZ,
  last_attempt_completed_at         TIMESTAMPTZ,
  last_successful_sync_started_at   TIMESTAMPTZ,
  last_successful_sync_completed_at TIMESTAMPTZ,
  last_attempt_summary              JSONB NOT NULL DEFAULT '{}',
  notes                             TEXT,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_feed_states_publication_mode
  ON source_feed_states(publication_mode);

CREATE INDEX IF NOT EXISTS idx_source_feed_states_emergency_pause
  ON source_feed_states(emergency_pause)
  WHERE emergency_pause = true;

CREATE INDEX IF NOT EXISTS idx_source_feed_states_last_attempt_status
  ON source_feed_states(last_attempt_status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_source_feed_states') THEN
    CREATE TRIGGER trg_set_updated_at_source_feed_states
      BEFORE UPDATE ON source_feed_states
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO source_feed_states (source_feed_id)
SELECT sf.id
FROM source_feeds sf
WHERE NOT EXISTS (
  SELECT 1 FROM source_feed_states sfs WHERE sfs.source_feed_id = sf.id
);

COMMIT;
