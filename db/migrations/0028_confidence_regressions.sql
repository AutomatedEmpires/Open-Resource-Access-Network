-- ============================================================
-- 0028 — Confidence Regressions audit/dedupe table
-- ============================================================
-- Dedicated audit table for trust-signal regression events.
-- Each row represents ONE detected regression event for a service
-- in a given 72-hour deduplication window.
--
-- The UNIQUE dedupe_key prevents duplicate alerts for the same
-- (entity, signal_type) pair within a 72-hour window.
--
-- The `submissions` table (submission_type = 'confidence_regression')
-- continues to serve as the admin-task mechanism; this table provides
-- the audit trail, status tracking, and the deduplication gate.
-- ============================================================

CREATE TABLE IF NOT EXISTS confidence_regressions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type    TEXT NOT NULL DEFAULT 'service'
    CHECK (entity_type IN ('service', 'organization')),
  entity_id      UUID NOT NULL,
  signal_type    TEXT NOT NULL
    CHECK (signal_type IN (
      'service_updated_after_verification',
      'feedback_severity',
      'score_staleness',
      'score_degraded'
    )),
  current_score  NUMERIC(5,2),
  current_band   TEXT
    CHECK (current_band IN ('HIGH', 'LIKELY', 'POSSIBLE')),
  reasons_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'suppressed')),
  -- 72-hour deduplication key: <entity_id>:<signal_type>:<window_id>
  -- UNIQUE prevents duplicate regression records within the same window.
  dedupe_key     TEXT NOT NULL,
  submission_id  UUID REFERENCES submissions(id) ON DELETE SET NULL,
  CONSTRAINT uq_confidence_regressions_dedupe UNIQUE (dedupe_key)
);

-- Service lookup: find all regressions for a specific service/org
CREATE INDEX idx_confidence_regressions_entity
  ON confidence_regressions(entity_type, entity_id);

-- Dashboards / triage: filter open regressions efficiently
CREATE INDEX idx_confidence_regressions_open_status
  ON confidence_regressions(status)
  WHERE status = 'open';

-- Chronological scan reports
CREATE INDEX idx_confidence_regressions_detected
  ON confidence_regressions(detected_at DESC);

COMMENT ON TABLE confidence_regressions IS
  'Audit table for detected confidence regression signals. Each row represents '
  'one signal detection event, deduped within a 72-hour window per '
  '(entity_id, signal_type) pair via the dedupe_key UNIQUE constraint.';

COMMENT ON COLUMN confidence_regressions.dedupe_key IS
  'Deduplication key: "<entity_id>:<signal_type>:<72h_window_id>". '
  'UNIQUE constraint prevents duplicate alerts for the same issue within a window.';

COMMENT ON COLUMN confidence_regressions.signal_type IS
  'Which regression trigger fired: '
  'service_updated_after_verification | feedback_severity | '
  'score_staleness | score_degraded';

COMMENT ON COLUMN confidence_regressions.status IS
  'Lifecycle status: open (new) | acknowledged (seen) | '
  'resolved (fixed) | suppressed (admin-snoozed).';
