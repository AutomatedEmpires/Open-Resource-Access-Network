-- ============================================================
-- Migration 0033: Canonical Federation Layer
-- ============================================================
-- Phase 2 of the HSDS / 211 integration plan.
--
-- Normalizes source assertions (source_records) into a canonical
-- model that can feed ORAN live tables and publish to HSDS.
--
-- Introduces:
--   - canonical_organizations: normalized org entities
--   - canonical_services: normalized service entities
--   - canonical_locations: normalized location entities with PostGIS
--   - canonical_service_locations: service ↔ location junction
--   - canonical_provenance: field-level lineage from source assertions
--
-- The entity_identifiers table (0032) is reused for canonical
-- entity cross-references — no redundant canonical_identifiers table.
--
-- See: hsds_211_integration_plan.md (Phase 2), docs/DATA_MODEL.md
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CANONICAL ORGANIZATIONS
-- ============================================================
-- Normalized organization entities derived from source_records.
-- Each row represents a single real-world organization, potentially
-- assembled from assertions across multiple source systems.

CREATE TABLE IF NOT EXISTS canonical_organizations (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Core fields (HSDS-aligned)
  name                       TEXT NOT NULL,
  alternate_name             TEXT,
  description                TEXT,
  url                        TEXT,
  email                      TEXT,
  phone                      TEXT,
  tax_status                 TEXT,
  tax_id                     TEXT,
  year_incorporated          INT,
  legal_status               TEXT,

  -- ORAN lifecycle
  lifecycle_status           TEXT NOT NULL DEFAULT 'draft' CHECK (
                               lifecycle_status IN (
                                 'draft', 'active', 'superseded',
                                 'withdrawn', 'archived'
                               )
                             ),
  publication_status         TEXT NOT NULL DEFAULT 'unpublished' CHECK (
                               publication_status IN (
                                 'unpublished', 'pending_review',
                                 'approved', 'published', 'retracted'
                               )
                             ),

  -- Source trust summary
  winning_source_system_id   UUID REFERENCES source_systems(id) ON DELETE SET NULL,
  source_count               INT NOT NULL DEFAULT 1,
  source_confidence_summary  JSONB NOT NULL DEFAULT '{}',

  -- Link to live table (populated by Phase 5 publish)
  published_organization_id  UUID,

  -- Timestamps
  first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canonical_orgs_lifecycle ON canonical_organizations(lifecycle_status);
CREATE INDEX idx_canonical_orgs_publication ON canonical_organizations(publication_status);
CREATE INDEX idx_canonical_orgs_winning_source ON canonical_organizations(winning_source_system_id);
CREATE INDEX idx_canonical_orgs_name ON canonical_organizations USING gin(to_tsvector('english', name));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_canonical_organizations') THEN
    CREATE TRIGGER trg_set_updated_at_canonical_organizations
      BEFORE UPDATE ON canonical_organizations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. CANONICAL SERVICES
-- ============================================================
-- Normalized service entities, always belonging to a canonical org.

CREATE TABLE IF NOT EXISTS canonical_services (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_organization_id  UUID NOT NULL REFERENCES canonical_organizations(id) ON DELETE CASCADE,

  -- Core fields (HSDS-aligned)
  name                       TEXT NOT NULL,
  alternate_name             TEXT,
  description                TEXT,
  url                        TEXT,
  email                      TEXT,
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (
                               status IN ('active', 'inactive', 'defunct')
                             ),
  interpretation_services    TEXT,
  application_process        TEXT,
  wait_time                  TEXT,
  fees                       TEXT,
  accreditations             TEXT,
  licenses                   TEXT,

  -- ORAN lifecycle
  lifecycle_status           TEXT NOT NULL DEFAULT 'draft' CHECK (
                               lifecycle_status IN (
                                 'draft', 'active', 'superseded',
                                 'withdrawn', 'archived'
                               )
                             ),
  publication_status         TEXT NOT NULL DEFAULT 'unpublished' CHECK (
                               publication_status IN (
                                 'unpublished', 'pending_review',
                                 'approved', 'published', 'retracted'
                               )
                             ),

  -- Source trust summary
  winning_source_system_id   UUID REFERENCES source_systems(id) ON DELETE SET NULL,
  source_count               INT NOT NULL DEFAULT 1,
  source_confidence_summary  JSONB NOT NULL DEFAULT '{}',

  -- Link to live table (populated by Phase 5 publish)
  published_service_id       UUID,

  -- Timestamps
  first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canonical_services_org ON canonical_services(canonical_organization_id);
CREATE INDEX idx_canonical_services_lifecycle ON canonical_services(lifecycle_status);
CREATE INDEX idx_canonical_services_publication ON canonical_services(publication_status);
CREATE INDEX idx_canonical_services_name ON canonical_services USING gin(to_tsvector('english', name));
CREATE INDEX idx_canonical_services_winning_source ON canonical_services(winning_source_system_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_canonical_services') THEN
    CREATE TRIGGER trg_set_updated_at_canonical_services
      BEFORE UPDATE ON canonical_services
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 3. CANONICAL LOCATIONS
-- ============================================================
-- Normalized location entities with PostGIS geometry.

CREATE TABLE IF NOT EXISTS canonical_locations (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_organization_id  UUID NOT NULL REFERENCES canonical_organizations(id) ON DELETE CASCADE,

  -- Core fields (HSDS-aligned)
  name                       TEXT,
  alternate_name             TEXT,
  description                TEXT,
  transportation             TEXT,
  latitude                   DOUBLE PRECISION,
  longitude                  DOUBLE PRECISION,
  geom                       GEOMETRY(Point, 4326),

  -- Address fields (denormalized for query convenience)
  address_line1              TEXT,
  address_line2              TEXT,
  address_city               TEXT,
  address_region             TEXT,
  address_postal_code        TEXT,
  address_country            TEXT DEFAULT 'US',

  -- ORAN lifecycle
  lifecycle_status           TEXT NOT NULL DEFAULT 'draft' CHECK (
                               lifecycle_status IN (
                                 'draft', 'active', 'superseded',
                                 'withdrawn', 'archived'
                               )
                             ),
  publication_status         TEXT NOT NULL DEFAULT 'unpublished' CHECK (
                               publication_status IN (
                                 'unpublished', 'pending_review',
                                 'approved', 'published', 'retracted'
                               )
                             ),

  -- Source trust summary
  winning_source_system_id   UUID REFERENCES source_systems(id) ON DELETE SET NULL,
  source_count               INT NOT NULL DEFAULT 1,
  source_confidence_summary  JSONB NOT NULL DEFAULT '{}',

  -- Link to live table (populated by Phase 5 publish)
  published_location_id      UUID,

  -- Timestamps
  first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canonical_locations_org ON canonical_locations(canonical_organization_id);
CREATE INDEX idx_canonical_locations_lifecycle ON canonical_locations(lifecycle_status);
CREATE INDEX idx_canonical_locations_publication ON canonical_locations(publication_status);
CREATE INDEX idx_canonical_locations_geom ON canonical_locations USING gist(geom);
CREATE INDEX idx_canonical_locations_winning_source ON canonical_locations(winning_source_system_id);

-- PostGIS auto-sync trigger (mirrors pattern from 0000_initial_schema.sql)
CREATE OR REPLACE FUNCTION sync_canonical_location_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_canonical_location_geom') THEN
    CREATE TRIGGER trg_sync_canonical_location_geom
      BEFORE INSERT OR UPDATE ON canonical_locations
      FOR EACH ROW EXECUTE FUNCTION sync_canonical_location_geom();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_canonical_locations') THEN
    CREATE TRIGGER trg_set_updated_at_canonical_locations
      BEFORE UPDATE ON canonical_locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 4. CANONICAL SERVICE LOCATIONS (Junction)
-- ============================================================
-- Many-to-many: which canonical services are at which canonical locations.

CREATE TABLE IF NOT EXISTS canonical_service_locations (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_service_id       UUID NOT NULL REFERENCES canonical_services(id) ON DELETE CASCADE,
  canonical_location_id      UUID NOT NULL REFERENCES canonical_locations(id) ON DELETE CASCADE,
  description                TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_canonical_service_locations_pair
  ON canonical_service_locations(canonical_service_id, canonical_location_id);

CREATE INDEX idx_canonical_service_locations_location
  ON canonical_service_locations(canonical_location_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_canonical_service_locations') THEN
    CREATE TRIGGER trg_set_updated_at_canonical_service_locations
      BEFORE UPDATE ON canonical_service_locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 5. CANONICAL PROVENANCE (Field-level Lineage)
-- ============================================================
-- Tracks which source_record asserted which field value for a
-- canonical entity, with confidence hints and decision status.
-- This is the core mechanism for Phase 4 entity resolution and
-- multi-source conflict comparison.

CREATE TABLE IF NOT EXISTS canonical_provenance (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Polymorphic entity reference
  canonical_entity_type      TEXT NOT NULL CHECK (
                               canonical_entity_type IN (
                                 'organization', 'service', 'location'
                               )
                             ),
  canonical_entity_id        UUID NOT NULL,

  -- Field and value
  field_name                 TEXT NOT NULL,
  asserted_value             JSONB,

  -- Source linkage
  source_record_id           UUID REFERENCES source_records(id) ON DELETE SET NULL,
  evidence_id                TEXT,
  selector_or_hint           TEXT,

  -- Confidence and decision
  confidence_hint            INT DEFAULT 0 CHECK (confidence_hint BETWEEN 0 AND 100),
  decision_status            TEXT NOT NULL DEFAULT 'candidate' CHECK (
                               decision_status IN (
                                 'candidate', 'accepted', 'superseded', 'rejected'
                               )
                             ),

  -- Timestamps
  decided_at                 TIMESTAMPTZ,
  decided_by                 TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query pattern: "what are all provenance records for this entity?"
CREATE INDEX idx_canonical_provenance_entity
  ON canonical_provenance(canonical_entity_type, canonical_entity_id);

-- "Which fields are still candidates for this entity?"
CREATE INDEX idx_canonical_provenance_decision
  ON canonical_provenance(canonical_entity_type, canonical_entity_id, decision_status);

-- "Which source_record contributed to canonical entities?"
CREATE INDEX idx_canonical_provenance_source_record
  ON canonical_provenance(source_record_id) WHERE source_record_id IS NOT NULL;

-- "What is the accepted provenance for a specific field?"
CREATE INDEX idx_canonical_provenance_field_accepted
  ON canonical_provenance(canonical_entity_type, canonical_entity_id, field_name)
  WHERE decision_status = 'accepted';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_canonical_provenance') THEN
    CREATE TRIGGER trg_set_updated_at_canonical_provenance
      BEFORE UPDATE ON canonical_provenance
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMIT;
