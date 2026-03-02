-- 0007_schema_optimizations.sql
-- Schema improvements: soft-delete columns, composite indexes, text search indexes,
-- and feature_flags.description column.
-- Idempotent: safe to run multiple times.

-- ============================================================
-- 1. SOFT-DELETE: organizations.status
-- ============================================================
-- The DATA_MODEL doc says records are marked status='defunct' rather than
-- hard-deleted. Services already have status; organizations need it too.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Add CHECK constraint only if it doesn't exist yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_status_check'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_status_check
      CHECK (status IN ('active', 'inactive', 'defunct'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_organizations_status
  ON organizations(status);

-- ============================================================
-- 2. SOFT-DELETE: locations.status
-- ============================================================
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_status_check'
      AND conrelid = 'locations'::regclass
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_status_check
      CHECK (status IN ('active', 'inactive', 'defunct'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_locations_status
  ON locations(status);

-- ============================================================
-- 3. COMPOSITE INDEXES for common query patterns
-- ============================================================

-- Queue page: filter by status, sort by oldest first
CREATE INDEX IF NOT EXISTS idx_vq_status_created
  ON verification_queue(status, created_at ASC);

-- Host services page: filter by org + status
CREATE INDEX IF NOT EXISTS idx_services_org_status
  ON services(organization_id, status);

-- Host locations page: sort by name within org
CREATE INDEX IF NOT EXISTS idx_locations_org_name
  ON locations(organization_id, name);

-- ============================================================
-- 4. TEXT SEARCH INDEXES
-- ============================================================

-- organizations.description — org search page may filter on description text
CREATE INDEX IF NOT EXISTS idx_organizations_description
  ON organizations USING gin(to_tsvector('english', coalesce(description, '')));

-- locations.name — location search
CREATE INDEX IF NOT EXISTS idx_locations_name
  ON locations USING gin(to_tsvector('english', coalesce(name, '')));

-- ============================================================
-- 5. FEATURE FLAGS: description column
-- ============================================================
ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ============================================================
-- NOTE on verification_queue.assigned_to:
-- The convention is *_user_id for Entra Object IDs (e.g., submitted_by_user_id,
-- created_by_user_id). The assigned_to column diverges from this convention.
-- However, it is actively used in live API queries (community queue POST/PUT),
-- so renaming it here would break the running application. The column continues
-- to store an Entra Object ID and is functionally correct.
-- If a future migration renames it, the API routes must be updated in the same
-- deployment.
-- ============================================================
