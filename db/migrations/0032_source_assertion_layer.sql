-- ============================================================
-- Migration 0032: Source Assertion Layer
-- ============================================================
-- Implements the unified source assertion model for HSDS / 211
-- federation. Every intake path (HSDS feeds, 211 APIs, partner
-- exports, government open data, allowlisted scrape, manual /
-- user submissions) funnels through a single assertion layer
-- before reaching canonical ORAN tables.
--
-- Also introduces:
--   - source_systems: unified source registry (subsumes ingestion_sources)
--   - source_feeds: individual endpoints/files per source
--   - source_records: immutable assertion layer
--   - source_record_taxonomy: preserved external taxonomy per record
--   - entity_identifiers: cross-database reference IDs
--   - hsds_export_snapshots: pre-computed HSDS-compatible JSON
--   - lifecycle_events: status change audit trail
--
-- See: ADR-0007, hsds_211_unify.md, hsds_211_integration_plan.md
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SOURCE SYSTEMS (Unified Source Registry)
-- ============================================================
-- Subsumes the role of ingestion_sources with a superset design.
-- Each row represents a named data source family or publisher.

CREATE TABLE IF NOT EXISTS source_systems (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  family            TEXT NOT NULL CHECK (
                      family IN (
                        'hsds_api',
                        'hsds_tabular',
                        'partner_api',
                        'partner_export',
                        'government_open_data',
                        'allowlisted_scrape',
                        'manual'
                      )
                    ),
  homepage_url      TEXT,
  license_notes     TEXT,
  terms_url         TEXT,
  trust_tier        TEXT NOT NULL DEFAULT 'quarantine' CHECK (
                      trust_tier IN (
                        'verified_publisher',
                        'trusted_partner',
                        'community',
                        'quarantine',
                        'blocked'
                      )
                    ),
  hsds_profile_uri  TEXT,                   -- set when source is HSDS-native
  domain_rules      JSONB NOT NULL DEFAULT '[]',  -- migrated from ingestion_sources
  crawl_policy      JSONB NOT NULL DEFAULT '{}',  -- migrated from ingestion_sources
  jurisdiction_scope JSONB NOT NULL DEFAULT '{}',
  contact_info      JSONB NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,

  -- Back-reference for migration traceability
  legacy_ingestion_source_id UUID,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_systems_family ON source_systems(family);
CREATE INDEX idx_source_systems_trust ON source_systems(trust_tier);
CREATE INDEX idx_source_systems_active ON source_systems(is_active) WHERE is_active = true;
CREATE UNIQUE INDEX idx_source_systems_name ON source_systems(name);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_source_systems') THEN
    CREATE TRIGGER trg_set_updated_at_source_systems
      BEFORE UPDATE ON source_systems
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. SOURCE FEEDS (Endpoints / Files per Source)
-- ============================================================
-- One source system may have multiple feeds (API endpoints,
-- CSV export URLs, regional sub-feeds, etc.).

CREATE TABLE IF NOT EXISTS source_feeds (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_system_id  UUID NOT NULL REFERENCES source_systems(id) ON DELETE CASCADE,
  feed_name         TEXT NOT NULL,
  feed_type         TEXT NOT NULL CHECK (
                      feed_type IN (
                        'api', 'csv', 'json', 'jsonl', 'xml',
                        'arcgis', 'scrape_seed', 'manual_entry'
                      )
                    ),
  base_url          TEXT,
  healthcheck_url   TEXT,
  auth_type         TEXT DEFAULT 'none' CHECK (
                      auth_type IN ('none', 'api_key', 'oauth2', 'basic', 'custom')
                    ),
  profile_uri       TEXT,                   -- HSDS profile URI if different from system-level
  jurisdiction_scope JSONB NOT NULL DEFAULT '{}',
  refresh_interval_hours INT DEFAULT 24 CHECK (refresh_interval_hours > 0),
  last_polled_at    TIMESTAMPTZ,
  last_success_at   TIMESTAMPTZ,
  last_error        TEXT,
  error_count       INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_feeds_system ON source_feeds(source_system_id);
CREATE INDEX idx_source_feeds_active ON source_feeds(is_active) WHERE is_active = true;
CREATE INDEX idx_source_feeds_type ON source_feeds(feed_type);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_source_feeds') THEN
    CREATE TRIGGER trg_set_updated_at_source_feeds
      BEFORE UPDATE ON source_feeds
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 3. SOURCE RECORDS (Immutable Assertion Layer)
-- ============================================================
-- Every piece of inbound data lands here first, regardless of
-- intake path. No intake path may bypass this table and write
-- directly to canonical ORAN tables.

CREATE TABLE IF NOT EXISTS source_records (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_feed_id    UUID NOT NULL REFERENCES source_feeds(id) ON DELETE CASCADE,
  source_record_type TEXT NOT NULL CHECK (
                      source_record_type IN (
                        'organization', 'service', 'location',
                        'taxonomy', 'taxonomy_term', 'mixed_bundle'
                      )
                    ),
  source_record_id  TEXT NOT NULL,          -- the ID from the source system
  source_version    TEXT,                   -- version/revision from source if available
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  canonical_source_url TEXT,                -- deep link back to original
  payload_sha256    TEXT NOT NULL,           -- content-addressable dedup
  raw_payload       JSONB NOT NULL,          -- original data exactly as received
  parsed_payload    JSONB,                   -- normalized parse of raw data

  -- Linkage to existing ORAN evidence
  evidence_id       TEXT,                   -- FK to evidence_snapshots.evidence_id
  correlation_id    TEXT,                   -- correlation to ingestion job

  -- Provenance signals
  source_license    TEXT,
  source_confidence_signals JSONB NOT NULL DEFAULT '{}',

  -- Processing state
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (
                      processing_status IN (
                        'pending', 'processing', 'normalized',
                        'published', 'rejected', 'error'
                      )
                    ),
  processing_error  TEXT,
  processed_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deduplicate: same feed + same record type + same source ID + same content
CREATE UNIQUE INDEX idx_source_records_dedup
  ON source_records(source_feed_id, source_record_type, source_record_id, payload_sha256);

CREATE INDEX idx_source_records_feed ON source_records(source_feed_id);
CREATE INDEX idx_source_records_type ON source_records(source_record_type);
CREATE INDEX idx_source_records_status ON source_records(processing_status);
CREATE INDEX idx_source_records_fetched ON source_records(fetched_at DESC);
CREATE INDEX idx_source_records_source_id ON source_records(source_record_id);
CREATE INDEX idx_source_records_correlation ON source_records(correlation_id);

-- ============================================================
-- 4. SOURCE RECORD TAXONOMY (Preserved External Taxonomy)
-- ============================================================
-- When an inbound record carries taxonomy codes (HSDS taxonomy_term,
-- AIRS codes, etc.), preserve them here. These are NEVER overwritten
-- by ORAN's internal tagging — they are the source's original
-- classification, kept for round-trip fidelity and export.

CREATE TABLE IF NOT EXISTS source_record_taxonomy (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_record_id  UUID NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  taxonomy_name     TEXT NOT NULL,           -- e.g., 'airs_211', 'open_eligibility', 'hsds'
  term_code         TEXT NOT NULL,           -- the raw code from the source
  term_name         TEXT,                    -- human-readable name if provided
  term_uri          TEXT,                    -- URI/permalink if provided
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_src_taxonomy_record ON source_record_taxonomy(source_record_id);
CREATE INDEX idx_src_taxonomy_code ON source_record_taxonomy(taxonomy_name, term_code);

-- ============================================================
-- 5. ENTITY IDENTIFIERS (Cross-Database Reference IDs)
-- ============================================================
-- Links ORAN entities to their identifiers in external systems.
-- The ORAN UUID is registered as scheme='oran'. Every external ID
-- (HSDS, 211, SAMHSA, Data.gov, etc.) also appears here.
-- When a listing changes status in ORAN, all linked identifiers
-- reflect that status atomically.

CREATE TABLE IF NOT EXISTS entity_identifiers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type       TEXT NOT NULL CHECK (
                      entity_type IN ('organization', 'service', 'location')
                    ),
  entity_id         UUID NOT NULL,           -- FK to organizations/services/locations
  identifier_scheme TEXT NOT NULL,           -- 'oran', 'hsds', '211_la', 'samhsa', 'ein', etc.
  identifier_value  TEXT NOT NULL,           -- the actual external ID
  source_system_id  UUID REFERENCES source_systems(id) ON DELETE SET NULL,
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  confidence        INT DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (
                      status IN ('active', 'expired', 'superseded', 'removed')
                    ),
  status_changed_at TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One identifier per scheme per entity
CREATE UNIQUE INDEX idx_entity_ids_unique
  ON entity_identifiers(entity_type, entity_id, identifier_scheme, identifier_value);

CREATE INDEX idx_entity_ids_entity ON entity_identifiers(entity_type, entity_id);
CREATE INDEX idx_entity_ids_scheme ON entity_identifiers(identifier_scheme, identifier_value);
CREATE INDEX idx_entity_ids_source ON entity_identifiers(source_system_id);
CREATE INDEX idx_entity_ids_status ON entity_identifiers(status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_entity_identifiers') THEN
    CREATE TRIGGER trg_set_updated_at_entity_identifiers
      BEFORE UPDATE ON entity_identifiers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 6. HSDS EXPORT SNAPSHOTS
-- ============================================================
-- Pre-computed HSDS-compatible JSON for each published service.
-- Generated when a listing is published or updated.
-- Serves the HSDS read-only API without real-time transformation.

CREATE TABLE IF NOT EXISTS hsds_export_snapshots (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type       TEXT NOT NULL CHECK (
                      entity_type IN ('organization', 'service', 'location')
                    ),
  entity_id         UUID NOT NULL,
  snapshot_version  INT NOT NULL DEFAULT 1,
  hsds_payload      JSONB NOT NULL,          -- the HSDS-compatible JSON
  profile_uri       TEXT,                    -- which HSDS profile this conforms to
  status            TEXT NOT NULL DEFAULT 'current' CHECK (
                      status IN ('current', 'superseded', 'withdrawn')
                    ),
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one current snapshot per entity
CREATE UNIQUE INDEX idx_hsds_snapshots_current
  ON hsds_export_snapshots(entity_type, entity_id)
  WHERE status = 'current';

CREATE INDEX idx_hsds_snapshots_entity ON hsds_export_snapshots(entity_type, entity_id);
CREATE INDEX idx_hsds_snapshots_status ON hsds_export_snapshots(status);

-- ============================================================
-- 7. LIFECYCLE EVENTS (Status Change Audit Trail)
-- ============================================================
-- Tracks every material status change for cross-database
-- propagation. When ORAN changes a listing status, this table
-- is the event source for updating entity_identifiers,
-- invalidating HSDS snapshots, and triggering external notifications.

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type       TEXT NOT NULL CHECK (
                      entity_type IN ('organization', 'service', 'location')
                    ),
  entity_id         UUID NOT NULL,
  event_type        TEXT NOT NULL CHECK (
                      event_type IN (
                        'created', 'published', 'updated', 'verified',
                        'verification_lost', 'expired', 'removed',
                        'merged', 'status_changed'
                      )
                    ),
  from_status       TEXT,
  to_status         TEXT,
  actor_type        TEXT NOT NULL DEFAULT 'system' CHECK (
                      actor_type IN ('system', 'human', 'ingestion_agent')
                    ),
  actor_id          TEXT,
  reason            TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  -- Which identifiers were affected (snapshot after propagation)
  identifiers_affected INT NOT NULL DEFAULT 0,
  snapshots_invalidated INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lifecycle_entity ON lifecycle_events(entity_type, entity_id);
CREATE INDEX idx_lifecycle_type ON lifecycle_events(event_type);
CREATE INDEX idx_lifecycle_created ON lifecycle_events(created_at DESC);

-- ============================================================
-- 8. MIGRATE ingestion_sources → source_systems
-- ============================================================
-- Copy existing ingestion_sources rows into source_systems so the
-- unified registry starts pre-populated. The legacy FK column
-- preserves traceability.

INSERT INTO source_systems (
  name,
  family,
  homepage_url,
  trust_tier,
  domain_rules,
  crawl_policy,
  is_active,
  notes,
  legacy_ingestion_source_id
)
SELECT
  isc.name,
  'allowlisted_scrape',
  NULL,
  CASE isc.trust_level
    WHEN 'vetted'      THEN 'trusted_partner'
    WHEN 'community'   THEN 'community'
    WHEN 'quarantine'  THEN 'quarantine'
    WHEN 'blocked'     THEN 'blocked'
    ELSE 'quarantine'
  END,
  jsonb_build_array(jsonb_build_object(
    'type', isc.pattern_type,
    'value', isc.pattern
  )),
  jsonb_build_object(
    'maxDepth', isc.max_depth,
    'crawlFrequencyDays', isc.crawl_frequency
  ),
  isc.is_active,
  isc.notes,
  isc.id
FROM ingestion_sources isc
WHERE NOT EXISTS (
  SELECT 1 FROM source_systems ss
  WHERE ss.legacy_ingestion_source_id = isc.id
);

-- Create a default manual feed for each manual source system
-- (the system requires at least one feed per source for assertions)
INSERT INTO source_feeds (
  source_system_id,
  feed_name,
  feed_type,
  is_active
)
SELECT
  ss.id,
  ss.name || ' (default)',
  CASE ss.family
    WHEN 'allowlisted_scrape' THEN 'scrape_seed'
    WHEN 'manual'             THEN 'manual_entry'
    ELSE 'api'
  END,
  ss.is_active
FROM source_systems ss
WHERE NOT EXISTS (
  SELECT 1 FROM source_feeds sf
  WHERE sf.source_system_id = ss.id
);

-- ============================================================
-- 9. ADD source_system_id FK TO ingestion_jobs
-- ============================================================
-- New column alongside existing source_id for backward compat.
-- Code will transition to using source_system_id over time.

ALTER TABLE ingestion_jobs
  ADD COLUMN IF NOT EXISTS source_system_id UUID REFERENCES source_systems(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source_system
  ON ingestion_jobs(source_system_id);

-- Backfill: link existing jobs to their migrated source_systems
UPDATE ingestion_jobs j
SET source_system_id = ss.id
FROM source_systems ss
WHERE ss.legacy_ingestion_source_id = j.source_id
  AND j.source_system_id IS NULL;

COMMIT;
