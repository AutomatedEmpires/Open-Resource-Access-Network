-- ORAN Ingestion Tables Migration
-- 0002_ingestion_tables.sql
-- Tables for the ingestion agent pipeline and candidate review workflow.

-- ============================================================
-- INGESTION SOURCES (Source Registry)
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_sources (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  pattern           TEXT NOT NULL,
  pattern_type      TEXT NOT NULL DEFAULT 'domain' CHECK (pattern_type IN ('domain', 'url_prefix', 'regex')),
  trust_level       TEXT NOT NULL DEFAULT 'quarantine' CHECK (
                      trust_level IN ('vetted', 'community', 'quarantine', 'blocked')
                    ),
  max_depth         INT NOT NULL DEFAULT 2 CHECK (max_depth >= 0 AND max_depth <= 10),
  crawl_frequency   INT NOT NULL DEFAULT 7 CHECK (crawl_frequency > 0), -- days
  owner_org_id      UUID REFERENCES organizations(id) ON DELETE SET NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  flags             JSONB NOT NULL DEFAULT '{}',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_sources_pattern ON ingestion_sources(pattern);
CREATE INDEX idx_ingestion_sources_trust ON ingestion_sources(trust_level);
CREATE INDEX idx_ingestion_sources_active ON ingestion_sources(is_active) WHERE is_active = true;

-- ============================================================
-- INGESTION JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  correlation_id        TEXT NOT NULL UNIQUE,
  job_type              TEXT NOT NULL CHECK (job_type IN ('crawl', 'single_url', 'recrawl', 'verify')),
  source_id             UUID REFERENCES ingestion_sources(id) ON DELETE SET NULL,
  seed_url              TEXT,
  status                TEXT NOT NULL DEFAULT 'queued' CHECK (
                          status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
                        ),
  priority              INT NOT NULL DEFAULT 0,
  max_urls              INT DEFAULT 100,
  current_depth         INT DEFAULT 0,
  stats_urls_discovered INT NOT NULL DEFAULT 0,
  stats_urls_fetched    INT NOT NULL DEFAULT 0,
  stats_candidates_extracted INT NOT NULL DEFAULT 0,
  stats_candidates_verified INT NOT NULL DEFAULT 0,
  stats_errors_count    INT NOT NULL DEFAULT 0,
  error_message         TEXT,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_correlation ON ingestion_jobs(correlation_id);
CREATE INDEX idx_ingestion_jobs_source ON ingestion_jobs(source_id);
CREATE INDEX idx_ingestion_jobs_priority ON ingestion_jobs(priority DESC, created_at ASC)
  WHERE status = 'queued';

-- ============================================================
-- EVIDENCE SNAPSHOTS
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evidence_id           TEXT NOT NULL UNIQUE,
  canonical_url         TEXT NOT NULL,
  fetched_at            TIMESTAMPTZ NOT NULL,
  http_status           INT NOT NULL,
  content_hash_sha256   TEXT NOT NULL,
  content_length        INT NOT NULL DEFAULT 0,
  content_type          TEXT,
  blob_storage_key      TEXT,
  html_raw              TEXT,
  text_extracted        TEXT,
  title                 TEXT,
  meta_description      TEXT,
  language              TEXT,
  job_id                UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  correlation_id        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_canonical_url ON evidence_snapshots(canonical_url);
CREATE INDEX idx_evidence_content_hash ON evidence_snapshots(content_hash_sha256);
CREATE INDEX idx_evidence_job ON evidence_snapshots(job_id);
CREATE INDEX idx_evidence_fetched ON evidence_snapshots(fetched_at DESC);

-- ============================================================
-- EXTRACTED CANDIDATES
-- ============================================================
CREATE TABLE IF NOT EXISTS extracted_candidates (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id          TEXT NOT NULL UNIQUE,
  extraction_id         TEXT NOT NULL UNIQUE,
  extract_key_sha256    TEXT NOT NULL,
  extracted_at          TIMESTAMPTZ NOT NULL,

  -- Extracted fields (denormalized for query performance)
  organization_name     TEXT NOT NULL,
  service_name          TEXT NOT NULL,
  description           TEXT,
  website_url           TEXT,
  phone                 TEXT,
  phones                JSONB DEFAULT '[]',
  address_line1         TEXT,
  address_line2         TEXT,
  address_city          TEXT,
  address_region        TEXT,
  address_postal_code   TEXT,
  address_country       TEXT DEFAULT 'US',
  is_remote_service     BOOLEAN DEFAULT false,

  -- Review workflow
  review_status         TEXT NOT NULL DEFAULT 'pending' CHECK (
                          review_status IN ('pending', 'in_review', 'verified', 'rejected',
                                            'escalated', 'published', 'archived')
                        ),
  assigned_to_role      TEXT CHECK (assigned_to_role IN ('community_admin', 'oran_admin')),
  assigned_to_user_id   TEXT,
  assigned_at           TIMESTAMPTZ,

  -- Jurisdiction (for routing)
  jurisdiction_state    TEXT,
  jurisdiction_county   TEXT,
  jurisdiction_city     TEXT,
  jurisdiction_kind     TEXT DEFAULT 'municipal' CHECK (
                          jurisdiction_kind IN ('county', 'municipal', 'state', 'federal')
                        ),

  -- Scoring
  confidence_score      INT NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  confidence_tier       TEXT NOT NULL DEFAULT 'red' CHECK (
                          confidence_tier IN ('green', 'yellow', 'orange', 'red')
                        ),
  score_verification    INT DEFAULT 0,
  score_completeness    INT DEFAULT 0,
  score_freshness       INT DEFAULT 0,

  -- Timers (SLA)
  review_by             TIMESTAMPTZ,
  last_verified_at      TIMESTAMPTZ,
  reverify_at           TIMESTAMPTZ,

  -- Verification checklist (JSONB for flexibility)
  verification_checklist JSONB NOT NULL DEFAULT '{}',

  -- Investigation pack
  investigation_pack    JSONB NOT NULL DEFAULT '{}',

  -- Provenance
  primary_evidence_id   TEXT REFERENCES evidence_snapshots(evidence_id) ON DELETE SET NULL,
  provenance_records    JSONB NOT NULL DEFAULT '[]',

  -- If published
  published_service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ,
  published_by_user_id  TEXT,

  -- Link to job
  job_id                UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  correlation_id        TEXT NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_candidates_extract_key ON extracted_candidates(extract_key_sha256);
CREATE INDEX idx_candidates_status ON extracted_candidates(review_status);
CREATE INDEX idx_candidates_assigned ON extracted_candidates(assigned_to_role, assigned_to_user_id);
CREATE INDEX idx_candidates_jurisdiction ON extracted_candidates(jurisdiction_state, jurisdiction_county);
CREATE INDEX idx_candidates_tier ON extracted_candidates(confidence_tier);
CREATE INDEX idx_candidates_review_by ON extracted_candidates(review_by) WHERE review_by IS NOT NULL;
CREATE INDEX idx_candidates_reverify ON extracted_candidates(reverify_at) WHERE reverify_at IS NOT NULL;
CREATE INDEX idx_candidates_job ON extracted_candidates(job_id);
CREATE INDEX idx_candidates_org_name ON extracted_candidates USING gin(to_tsvector('english', organization_name));
CREATE INDEX idx_candidates_service_name ON extracted_candidates USING gin(to_tsvector('english', service_name));

-- ============================================================
-- RESOURCE TAGS (for candidates and services)
-- ============================================================
CREATE TABLE IF NOT EXISTS resource_tags (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_id       TEXT NOT NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('candidate', 'service')),
  tag_type        TEXT NOT NULL CHECK (
                    tag_type IN ('service_type', 'demographic', 'accessibility',
                                 'eligibility', 'geotag', 'custom')
                  ),
  tag_value       TEXT NOT NULL,
  confidence      INT CHECK (confidence >= 0 AND confidence <= 100),
  source          TEXT NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'admin', 'taxonomy', 'import')),
  added_by        TEXT,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(target_id, target_type, tag_type, tag_value)
);

CREATE INDEX idx_tags_target ON resource_tags(target_id, target_type);
CREATE INDEX idx_tags_type ON resource_tags(tag_type);
CREATE INDEX idx_tags_value ON resource_tags(tag_value);

-- ============================================================
-- DISCOVERED LINKS (links found during crawl)
-- ============================================================
CREATE TABLE IF NOT EXISTS discovered_links (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evidence_id     TEXT NOT NULL REFERENCES evidence_snapshots(evidence_id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  link_type       TEXT NOT NULL CHECK (
                    link_type IN ('home', 'contact', 'apply', 'eligibility',
                                  'intake_form', 'hours', 'pdf', 'privacy', 'other')
                  ),
  label           TEXT,
  confidence      INT DEFAULT 50 CHECK (confidence >= 0 AND confidence <= 100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_discovered_links_evidence ON discovered_links(evidence_id);
CREATE INDEX idx_discovered_links_type ON discovered_links(link_type);

-- ============================================================
-- AUDIT EVENTS (for candidate lifecycle tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_audit_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (
                    event_type IN ('created', 'status_changed', 'assigned', 'unassigned',
                                   'score_updated', 'field_edited', 'tag_added', 'tag_removed',
                                   'escalated', 'published', 'archived', 'reverified')
                  ),
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('system', 'admin', 'llm')),
  actor_id        TEXT,
  details         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_candidate ON ingestion_audit_events(candidate_id);
CREATE INDEX idx_audit_type ON ingestion_audit_events(event_type);
CREATE INDEX idx_audit_created ON ingestion_audit_events(created_at DESC);

-- ============================================================
-- LLM SUGGESTIONS (AI-generated suggestions for review)
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_suggestions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id    TEXT NOT NULL,
  suggestion_id   TEXT NOT NULL UNIQUE,
  field           TEXT NOT NULL CHECK (
                    field IN ('organization_name', 'service_name', 'description',
                              'website_url', 'phone', 'address', 'eligibility',
                              'schedule', 'category', 'tags')
                  ),
  suggested_value TEXT NOT NULL,
  original_value  TEXT,
  confidence      INT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  reasoning       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (
                    status IN ('pending', 'accepted', 'rejected', 'superseded')
                  ),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  evidence_id     TEXT REFERENCES evidence_snapshots(evidence_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_suggestions_candidate ON llm_suggestions(candidate_id);
CREATE INDEX idx_suggestions_status ON llm_suggestions(status);
CREATE INDEX idx_suggestions_field ON llm_suggestions(field);

-- ============================================================
-- TRIGGERS: updated_at auto-update
-- ============================================================
CREATE OR REPLACE FUNCTION update_ingestion_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ingestion_sources_updated
  BEFORE UPDATE ON ingestion_sources
  FOR EACH ROW EXECUTE FUNCTION update_ingestion_updated_at();

CREATE TRIGGER trg_ingestion_jobs_updated
  BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION update_ingestion_updated_at();

CREATE TRIGGER trg_extracted_candidates_updated
  BEFORE UPDATE ON extracted_candidates
  FOR EACH ROW EXECUTE FUNCTION update_ingestion_updated_at();

-- ============================================================
-- TRIGGER: Auto-calculate confidence tier on score update
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_confidence_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confidence_score >= 80 THEN
    NEW.confidence_tier = 'green';
  ELSIF NEW.confidence_score >= 60 THEN
    NEW.confidence_tier = 'yellow';
  ELSIF NEW.confidence_score >= 40 THEN
    NEW.confidence_tier = 'orange';
  ELSE
    NEW.confidence_tier = 'red';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_candidates_tier_calc
  BEFORE INSERT OR UPDATE OF confidence_score ON extracted_candidates
  FOR EACH ROW EXECUTE FUNCTION calculate_confidence_tier();
