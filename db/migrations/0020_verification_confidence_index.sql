-- ============================================================
-- MIGRATION: 0020_verification_confidence_index.sql
-- ============================================================
-- Adds a descending B-tree index on confidence_scores.verification_confidence.
--
-- Rationale: The search engine (src/services/search/engine.ts) uses
-- verification_confidence in both WHERE (>= threshold) and ORDER BY (DESC)
-- clauses on every search query. Without this index, these queries
-- require a sequential scan of the confidence_scores table.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_confidence_verification
  ON confidence_scores(verification_confidence DESC);

-- Also add services.updated_at for freshness-based queries
-- (admin dashboards, cron staleness checks).
CREATE INDEX IF NOT EXISTS idx_services_updated_at
  ON services(updated_at DESC);
