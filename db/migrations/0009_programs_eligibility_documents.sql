-- 0009_programs_eligibility_documents.sql
-- Adds HSDS-standard tables missing from the initial schema:
--   programs           — Service groupings by funding/program (SNAP, WIC, Section 8, etc.)
--   eligibility        — Structured eligibility criteria per service
--   required_documents — Documents/proofs seekers need to bring
--
-- These tables are critical for ORAN's confidence scoring:
--   - eligibility_match sub-score (40% weight) depends on structured eligibility data
--   - constraint_fit sub-score (15% weight) depends on required_documents for actionability
-- Idempotent: safe to run multiple times.

-- ============================================================
-- PROGRAMS
-- ============================================================
-- Groups services under named funding streams (e.g., SNAP, WIC, Head Start,
-- Section 8, Medicaid). services.program_id references this table.
CREATE TABLE IF NOT EXISTS programs (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  alternate_name     TEXT,
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_programs_organization
  ON programs(organization_id);

CREATE INDEX IF NOT EXISTS idx_programs_name
  ON programs USING gin(to_tsvector('english', name));

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_programs'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_programs
      BEFORE UPDATE ON programs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Add FK from services.program_id → programs.id (if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'services_program_id_fkey'
      AND conrelid = 'services'::regclass
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_program_id_fkey
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- ELIGIBILITY
-- ============================================================
-- Structured eligibility criteria per service. Each row is one criterion.
-- Examples: "Age 18+", "Income below 200% FPL", "Must be a veteran",
--           "Residents of King County only"
-- The chat pipeline uses these for the eligibility_match sub-score.
CREATE TABLE IF NOT EXISTS eligibility (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  description        TEXT NOT NULL,          -- Human-readable: "Must be 18 or older"
  minimum_age        INT,                    -- Structured: minimum age (NULL = no minimum)
  maximum_age        INT,                    -- Structured: maximum age (NULL = no maximum)
  eligible_values    TEXT[],                 -- Structured tags: {'veteran', 'senior', 'family', 'youth', 'disabled'}
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_eligibility_service
  ON eligibility(service_id);

-- GIN index on eligible_values array for tag-based filtering
CREATE INDEX IF NOT EXISTS idx_eligibility_values
  ON eligibility USING gin(eligible_values);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_eligibility'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_eligibility
      BEFORE UPDATE ON eligibility
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- REQUIRED DOCUMENTS
-- ============================================================
-- Documents a seeker must bring to access a service.
-- Examples: "Photo ID", "Proof of income", "Proof of residency",
--           "Social Security card", "Birth certificate"
-- Directly feeds the constraint_fit sub-score for actionability.
CREATE TABLE IF NOT EXISTS required_documents (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  document           TEXT NOT NULL,          -- e.g., "Photo ID", "Proof of income"
  type               TEXT,                   -- Category: 'identification', 'income', 'residency', 'medical', 'other'
  uri                TEXT,                   -- Link to downloadable form or instructions
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_required_documents_service
  ON required_documents(service_id);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_required_documents'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_required_documents
      BEFORE UPDATE ON required_documents
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
