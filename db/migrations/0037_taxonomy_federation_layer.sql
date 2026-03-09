-- Migration: 0037 — Taxonomy Federation Layer (Phase 3)
--
-- Five tables supporting multi-taxonomy awareness, crosswalk logic,
-- and automated tag derivation from external taxonomy codes.
-- See: hsds_211_integration_plan.md Phase 3.

-- 1. Taxonomy Registries — each row = one taxonomy vocabulary.
CREATE TABLE IF NOT EXISTS taxonomy_registries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                 -- e.g. 'AIRS/211 LA County', 'Open Eligibility'
  uri TEXT,                           -- canonical URI for this taxonomy
  version TEXT,                       -- '2025-01', 'v2.0'
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_taxonomy_registries_name ON taxonomy_registries (name);
CREATE INDEX idx_taxonomy_registries_status ON taxonomy_registries (status);

-- 2. Taxonomy Terms Extended — full external terms with hierarchy.
--    Complements the existing taxonomy_terms table (Zone C) which is
--    ORAN's own flat taxonomy used for search/scoring.
CREATE TABLE IF NOT EXISTS taxonomy_terms_ext (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_id UUID NOT NULL REFERENCES taxonomy_registries(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                 -- e.g. 'BD-1800.2000'
  term TEXT NOT NULL,                 -- e.g. 'Food Pantries'
  parent_code TEXT,
  description TEXT,
  uri TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_taxonomy_terms_ext_registry_code ON taxonomy_terms_ext (registry_id, code);
CREATE INDEX idx_taxonomy_terms_ext_parent ON taxonomy_terms_ext (registry_id, parent_code);
CREATE INDEX idx_taxonomy_terms_ext_term ON taxonomy_terms_ext (term);

-- 3. Canonical Concepts — ORAN's internal concept mapping layer.
--    Each concept maps to one ORAN taxonomy_terms row and can be
--    linked to multiple external terms via crosswalks.
CREATE TABLE IF NOT EXISTS canonical_concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key TEXT NOT NULL UNIQUE,   -- e.g. 'food_pantry', 'rental_assistance'
  label TEXT NOT NULL,
  description TEXT,
  oran_taxonomy_term_id UUID REFERENCES taxonomy_terms(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_canonical_concepts_term ON canonical_concepts (oran_taxonomy_term_id);

-- 4. Taxonomy Crosswalks — maps external taxonomy codes → canonical concepts.
CREATE TABLE IF NOT EXISTS taxonomy_crosswalks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_registry_id UUID NOT NULL REFERENCES taxonomy_registries(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  target_concept_id UUID NOT NULL REFERENCES canonical_concepts(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL DEFAULT 'exact',   -- 'exact', 'broader', 'narrower', 'related'
  confidence INTEGER NOT NULL DEFAULT 100,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_taxonomy_crosswalks_pair
  ON taxonomy_crosswalks (source_registry_id, source_code, target_concept_id);
CREATE INDEX idx_taxonomy_crosswalks_source
  ON taxonomy_crosswalks (source_registry_id, source_code);
CREATE INDEX idx_taxonomy_crosswalks_target
  ON taxonomy_crosswalks (target_concept_id);

-- 5. Concept Tag Derivations — audit log recording how a resource_tags
--    row was derived from an external code via a crosswalk.
CREATE TABLE IF NOT EXISTS concept_tag_derivations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id UUID REFERENCES source_records(id) ON DELETE SET NULL,
  source_registry_id UUID NOT NULL REFERENCES taxonomy_registries(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  crosswalk_id UUID REFERENCES taxonomy_crosswalks(id) ON DELETE SET NULL,
  concept_id UUID NOT NULL REFERENCES canonical_concepts(id) ON DELETE CASCADE,
  derived_tag_type TEXT NOT NULL DEFAULT 'category',
  derived_tag_value TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 100,
  entity_type TEXT NOT NULL,          -- 'service', 'organization'
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_concept_tag_derivations_entity
  ON concept_tag_derivations (entity_type, entity_id);
CREATE INDEX idx_concept_tag_derivations_source
  ON concept_tag_derivations (source_registry_id, source_code);
CREATE INDEX idx_concept_tag_derivations_concept
  ON concept_tag_derivations (concept_id);
