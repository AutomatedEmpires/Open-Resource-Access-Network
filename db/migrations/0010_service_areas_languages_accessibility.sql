-- 0010_service_areas_languages_accessibility.sql
-- Adds HSDS-standard tables for service area coverage, language availability,
-- and physical accessibility — the "can I actually use this service?" dimension.
--
-- service_areas                    — Geographic coverage per service (county, ZIP, state, polygon)
-- languages                       — Languages available at a service or location
-- accessibility_for_disabilities  — Physical/sensory accessibility features at a location
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- SERVICE AREAS
-- ============================================================
-- Defines WHERE a service is available, distinct from where it is physically located.
-- A food bank at one address may serve a 3-county area.
-- Used by PostGIS spatial search to match seekers to eligible services.
CREATE TABLE IF NOT EXISTS service_areas (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name               TEXT,                   -- e.g., "King County", "ZIP 98101-98199"
  description        TEXT,
  extent             GEOMETRY(Polygon, 4326),-- PostGIS polygon boundary (nullable for non-spatial areas)
  extent_type        TEXT DEFAULT 'other'
                     CHECK (extent_type IN ('city', 'county', 'state', 'zip', 'nationwide', 'custom', 'other')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_areas_service
  ON service_areas(service_id);

CREATE INDEX IF NOT EXISTS idx_service_areas_extent
  ON service_areas USING gist(extent);

CREATE INDEX IF NOT EXISTS idx_service_areas_type
  ON service_areas(extent_type);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_service_areas'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_service_areas
      BEFORE UPDATE ON service_areas
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- LANGUAGES
-- ============================================================
-- Structured language availability per service or location.
-- Replaces the free-text services.interpretation_services field for querying.
-- ISO 639-1 two-letter codes (en, es, zh, vi, ko, tl, ar, ru, etc.)
CREATE TABLE IF NOT EXISTS languages (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id         UUID REFERENCES services(id) ON DELETE CASCADE,
  location_id        UUID REFERENCES locations(id) ON DELETE CASCADE,
  language           TEXT NOT NULL,          -- ISO 639-1 code: 'en', 'es', 'zh', etc.
  note               TEXT,                   -- e.g., "Interpreter available Mondays"
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  -- At least one parent must be set
  CONSTRAINT languages_parent_check CHECK (service_id IS NOT NULL OR location_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_languages_service
  ON languages(service_id);

CREATE INDEX IF NOT EXISTS idx_languages_location
  ON languages(location_id);

CREATE INDEX IF NOT EXISTS idx_languages_language
  ON languages(language);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_languages'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_languages
      BEFORE UPDATE ON languages
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- ACCESSIBILITY FOR DISABILITIES
-- ============================================================
-- Physical/sensory accessibility features at a location.
-- Used by the chat pipeline to match seekers who specify accessibility needs.
-- ORAN's vision: "Keyboard navigable, screen-reader friendly, mobile-first,
-- low-bandwidth tolerant" — this extends accessibility to physical locations.
CREATE TABLE IF NOT EXISTS accessibility_for_disabilities (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id        UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  accessibility      TEXT NOT NULL,          -- Feature tag: 'wheelchair', 'hearing_loop', 'braille',
                                             -- 'elevator', 'accessible_parking', 'sign_language',
                                             -- 'large_print', 'service_animal_friendly', 'other'
  details            TEXT,                   -- Free-text description of the accommodation
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_accessibility_location
  ON accessibility_for_disabilities(location_id);

CREATE INDEX IF NOT EXISTS idx_accessibility_feature
  ON accessibility_for_disabilities(accessibility);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_accessibility'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_accessibility
      BEFORE UPDATE ON accessibility_for_disabilities
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
