-- 0030_queue_triage.sql
-- Queue Triage with Anomaly Prioritization (§3)
--
-- Adds deterministic triage scoring for admin review queues.
-- Each submission gets a triage_priority (0–100) computed from:
--   traffic signal    — saved_services count (high saves → higher priority)
--   trust signal      — confidence_scores.score (low score → higher priority)
--   feedback signal   — recent negative feedback volume
--   staleness signal  — age of submission / last-verified date
--   crisis signal     — service has crisis-adjacent situation tags
--   sla_breach signal — SLA is breached or imminent
--
-- triage_explanations: short machine-readable list for UI "Why prioritized?"
-- No PII stored here. All signals are aggregate or structural.

-- ============================================================
-- 1. TRIAGE SCORES
-- ============================================================

CREATE TABLE IF NOT EXISTS triage_scores (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id         UUID        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,

  -- Composite priority (0–100, higher = more urgent)
  triage_priority       NUMERIC(5,2) NOT NULL DEFAULT 0
                          CHECK (triage_priority >= 0 AND triage_priority <= 100),

  -- Individual signal values (0–1 each after normalization, stored for audit)
  signal_traffic        NUMERIC(5,4) NOT NULL DEFAULT 0,
  signal_trust          NUMERIC(5,4) NOT NULL DEFAULT 0,
  signal_feedback       NUMERIC(5,4) NOT NULL DEFAULT 0,
  signal_staleness      NUMERIC(5,4) NOT NULL DEFAULT 0,
  signal_crisis         NUMERIC(5,4) NOT NULL DEFAULT 0,
  signal_sla_breach     NUMERIC(5,4) NOT NULL DEFAULT 0,

  -- Short explanation bullets (e.g. ['High saves count', 'Crisis-adjacent service'])
  triage_explanations   TEXT[]      NOT NULL DEFAULT '{}',

  -- When this score was computed
  scored_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One score per submission (upsert pattern)
  UNIQUE(submission_id)
);

COMMENT ON TABLE triage_scores IS
  'Deterministic anomaly-priority scores for admin queue triage (§3). '
  'No PII. All signals are aggregate or structural.';

COMMENT ON COLUMN triage_scores.triage_priority IS
  'Composite 0–100 score. Higher = more urgent. '
  'Weighted sum: traffic(20) + trust(25) + feedback(20) + staleness(15) + crisis(10) + sla_breach(10).';

COMMENT ON COLUMN triage_scores.triage_explanations IS
  'Short machine-readable bullets explaining why this submission was prioritized. '
  'Suitable for direct display in admin UI tooltip.';

-- ============================================================
-- 2. INDEXES
-- ============================================================

-- Primary queue ordering: high priority first, oldest first on tie
CREATE INDEX IF NOT EXISTS idx_triage_priority
  ON triage_scores(triage_priority DESC, scored_at ASC);

-- Join from submissions to their triage score (covered by UNIQUE but explicit)
CREATE INDEX IF NOT EXISTS idx_triage_submission_id
  ON triage_scores(submission_id);

-- Queue filtering: find recently scored entries for dashboard refresh
CREATE INDEX IF NOT EXISTS idx_triage_scored_at
  ON triage_scores(scored_at DESC);

-- Fast anomaly filter: only high-priority items (triage_priority >= 70)
CREATE INDEX IF NOT EXISTS idx_triage_high_priority
  ON triage_scores(submission_id)
  WHERE triage_priority >= 70;

-- ============================================================
-- 3. UPDATED_AT TRIGGER (conditional — safe if set_updated_at() is absent)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_triage_scores'
  ) THEN
    EXECUTE $t$
      CREATE TRIGGER trg_set_updated_at_triage_scores
        BEFORE UPDATE ON triage_scores
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    $t$;
  END IF;
END;
$$;
