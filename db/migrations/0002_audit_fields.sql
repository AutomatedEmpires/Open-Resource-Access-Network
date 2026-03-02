-- 0002_audit_fields.sql
-- Normalize timestamps + actor fields across tables.
-- Safe to run multiple times (uses IF NOT EXISTS patterns where possible).

-- ============================================================
-- COLUMN NORMALIZATION: created_at / updated_at
-- ============================================================

-- service_at_location
ALTER TABLE service_at_location
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- phones
ALTER TABLE phones
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- addresses
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- schedules
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- taxonomy_terms
ALTER TABLE taxonomy_terms
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- service_taxonomy
ALTER TABLE service_taxonomy
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- confidence_scores
ALTER TABLE confidence_scores
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- seeker_feedback
ALTER TABLE seeker_feedback
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================
-- COLUMN NORMALIZATION: created_by_user_id / updated_by_user_id
-- NOTE: These are pseudonymous IDs (e.g., Microsoft Entra object ID). Nullable.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE service_at_location
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE phones
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE taxonomy_terms
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE service_taxonomy
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE verification_queue
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE seeker_feedback
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT;

-- ============================================================
-- VERIFICATION QUEUE: submitted_by naming consistency
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'verification_queue'
      AND column_name = 'submitted_by'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'verification_queue'
      AND column_name = 'submitted_by_user_id'
  ) THEN
    ALTER TABLE verification_queue RENAME COLUMN submitted_by TO submitted_by_user_id;
  END IF;
END $$;

-- ============================================================
-- updated_at triggers for newly-added updated_at columns
-- Requires set_updated_at() from 0001_updated_at_triggers.sql
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_service_at_location') THEN
    CREATE TRIGGER trg_set_updated_at_service_at_location
      BEFORE UPDATE ON service_at_location
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_phones') THEN
    CREATE TRIGGER trg_set_updated_at_phones
      BEFORE UPDATE ON phones
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_addresses') THEN
    CREATE TRIGGER trg_set_updated_at_addresses
      BEFORE UPDATE ON addresses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_schedules') THEN
    CREATE TRIGGER trg_set_updated_at_schedules
      BEFORE UPDATE ON schedules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_taxonomy_terms') THEN
    CREATE TRIGGER trg_set_updated_at_taxonomy_terms
      BEFORE UPDATE ON taxonomy_terms
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_service_taxonomy') THEN
    CREATE TRIGGER trg_set_updated_at_service_taxonomy
      BEFORE UPDATE ON service_taxonomy
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_confidence_scores') THEN
    CREATE TRIGGER trg_set_updated_at_confidence_scores
      BEFORE UPDATE ON confidence_scores
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_seeker_feedback') THEN
    CREATE TRIGGER trg_set_updated_at_seeker_feedback
      BEFORE UPDATE ON seeker_feedback
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
