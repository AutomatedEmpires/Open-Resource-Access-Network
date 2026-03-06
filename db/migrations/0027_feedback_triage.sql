-- ============================================================
-- 0027 — Feedback triage columns (Phase 5 / Idea 14)
-- ============================================================
-- Adds LLM triage results to seeker_feedback rows.
-- Triage runs asynchronously after the feedback is stored.
-- Only the comment text is sent to the LLM — no user identity.
-- ============================================================

ALTER TABLE seeker_feedback
  ADD COLUMN IF NOT EXISTS triage_category TEXT
    CHECK (triage_category IN (
      'record_outdated',
      'service_closed',
      'incorrect_phone',
      'incorrect_address',
      'incorrect_hours',
      'positive',
      'out_of_scope',
      'other'
    )),
  ADD COLUMN IF NOT EXISTS triage_result JSONB;

COMMENT ON COLUMN seeker_feedback.triage_category IS
  'LLM-classified action category for the feedback comment (Phase 5 / Idea 14). NULL if not yet triaged or no comment.';
COMMENT ON COLUMN seeker_feedback.triage_result IS
  'Full triage result JSONB from gpt-4o-mini (category, urgency, extractedFields). No user PII.';

CREATE INDEX IF NOT EXISTS idx_feedback_triage_category
  ON seeker_feedback(triage_category)
  WHERE triage_category IS NOT NULL;
