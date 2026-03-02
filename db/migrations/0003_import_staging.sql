-- 0003_import_staging.sql
-- Import pipeline staging tables (schema only).
-- The application/importer wiring is implemented separately.

CREATE TABLE IF NOT EXISTS import_batches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_key       TEXT UNIQUE NOT NULL,
  imported_by_user_id TEXT,
  source          TEXT NOT NULL DEFAULT 'csv',
  status          TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('validated', 'staged', 'published', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_import_batches') THEN
    CREATE TRIGGER trg_set_updated_at_import_batches
      BEFORE UPDATE ON import_batches
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Generic status enum via CHECK constraints (kept text for portability)

CREATE TABLE IF NOT EXISTS staging_organizations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  organization_id UUID,
  import_status   TEXT NOT NULL DEFAULT 'pending' CHECK (import_status IN ('pending', 'approved', 'rejected')),
  import_diff     JSONB,
  name            TEXT NOT NULL,
  description     TEXT,
  url             TEXT,
  email           TEXT,
  tax_status      TEXT,
  tax_id          TEXT,
  year_incorporated INT,
  legal_status    TEXT,
  logo_url        TEXT,
  uri             TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_stg_org_batch ON staging_organizations(import_batch_id);

CREATE TABLE IF NOT EXISTS staging_locations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  location_id     UUID,
  organization_id UUID,
  import_status   TEXT NOT NULL DEFAULT 'pending' CHECK (import_status IN ('pending', 'approved', 'rejected')),
  import_diff     JSONB,
  name            TEXT,
  alternate_name  TEXT,
  description     TEXT,
  transportation  TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_stg_loc_batch ON staging_locations(import_batch_id);

CREATE TABLE IF NOT EXISTS staging_services (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  service_id      UUID,
  organization_id UUID,
  program_id      UUID,
  import_status   TEXT NOT NULL DEFAULT 'pending' CHECK (import_status IN ('pending', 'approved', 'rejected')),
  import_diff     JSONB,
  name            TEXT NOT NULL,
  alternate_name  TEXT,
  description     TEXT,
  url             TEXT,
  email           TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'defunct')),
  interpretation_services TEXT,
  application_process TEXT,
  wait_time       TEXT,
  fees            TEXT,
  accreditations  TEXT,
  licenses        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_stg_svc_batch ON staging_services(import_batch_id);

-- ============================================================
-- updated_at triggers for staging tables
-- Requires set_updated_at() from 0001_updated_at_triggers.sql
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_staging_organizations') THEN
    CREATE TRIGGER trg_set_updated_at_staging_organizations
      BEFORE UPDATE ON staging_organizations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_staging_locations') THEN
    CREATE TRIGGER trg_set_updated_at_staging_locations
      BEFORE UPDATE ON staging_locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_staging_services') THEN
    CREATE TRIGGER trg_set_updated_at_staging_services
      BEFORE UPDATE ON staging_services
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Optional: link tables could be staged later. Start with core triad.
