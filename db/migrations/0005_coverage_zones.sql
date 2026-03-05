-- 0005_coverage_zones.sql
-- Coverage zones table for community admin zone management and coverage routing.
-- Uses PostGIS polygon geometry for zone boundaries.
-- Referenced by: docs/governance/ROLES_PERMISSIONS.md, /coverage and /zone-management pages.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS coverage_zones (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT NOT NULL,
  description        TEXT,
  geometry           GEOMETRY(Polygon, 4326),      -- PostGIS polygon for zone boundary
  assigned_user_id   TEXT,                          -- Community admin Microsoft Entra Object ID
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,                          -- Entra Object ID (pseudonymous)
  updated_by_user_id TEXT                           -- Entra Object ID (pseudonymous)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_coverage_zones_assigned
  ON coverage_zones(assigned_user_id);

CREATE INDEX IF NOT EXISTS idx_coverage_zones_geometry
  ON coverage_zones USING gist(geometry);

CREATE INDEX IF NOT EXISTS idx_coverage_zones_status
  ON coverage_zones(status);

-- updated_at trigger (requires set_updated_at() from 0001)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_coverage_zones'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_coverage_zones
      BEFORE UPDATE ON coverage_zones
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
