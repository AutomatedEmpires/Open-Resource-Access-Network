-- ============================================================
-- MIGRATION: 0019_tag_confirmation_queue.sql
-- ============================================================
-- Extends Schema A (0002_ingestion_tables.sql) with:
-- 1. Tag confirmation queue for uncertain LLM-generated tags
-- 2. Tag review workflow (approve/reject/modify)
-- 3. Publish readiness criteria tracking
--
-- When the LLM extracts tags with confidence < threshold (e.g., 70%),
-- those tags are queued for human confirmation before the candidate
-- can be published.
--
-- Integrates with:
-- - resource_tags (Schema A) - polymorphic tags with target_id/target_type
-- - extracted_candidates (Schema A) - candidate records
-- - admin_review_profiles (0018) - admin capacity tracking
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ============================================================
-- TAG CONFIRMATION QUEUE
-- ============================================================
-- Tracks tags that need human review before candidate can be published.
-- Each entry represents one resource_tag that needs confirmation.
CREATE TABLE IF NOT EXISTS tag_confirmation_queue (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Links to Schema A resource_tags (polymorphic)
  resource_tag_id       UUID NOT NULL,                -- References resource_tags.id

  -- Denormalized for query efficiency (avoid joins in hot path)
  candidate_id          TEXT NOT NULL,                -- References extracted_candidates.candidate_id
  tag_type              TEXT NOT NULL,                -- service_type, demographic, etc.
  tag_value             TEXT NOT NULL,                -- The actual tag value
  original_confidence   INT NOT NULL,                 -- LLM's original confidence (0-100)

  -- Review workflow
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'skipped')),

  -- Assignment (can be assigned to specific admin)
  assigned_to_user_id   TEXT,
  assigned_at           TIMESTAMPTZ,

  -- Review outcome
  reviewed_by_user_id   TEXT,
  reviewed_at           TIMESTAMPTZ,

  -- If modified, what was the change?
  modified_tag_value    TEXT,                         -- New value if status='modified'
  review_notes          TEXT,

  -- Evidence supporting the tag
  evidence_snippet      TEXT,                         -- Text excerpt that led to this tag
  evidence_id           TEXT,                         -- References evidence_snapshots.evidence_id

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tag_queue_candidate
  ON tag_confirmation_queue(candidate_id);

CREATE INDEX IF NOT EXISTS idx_tag_queue_status
  ON tag_confirmation_queue(status);

CREATE INDEX IF NOT EXISTS idx_tag_queue_pending
  ON tag_confirmation_queue(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tag_queue_assigned
  ON tag_confirmation_queue(assigned_to_user_id, status)
  WHERE assigned_to_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tag_queue_tag_type
  ON tag_confirmation_queue(tag_type);

CREATE INDEX IF NOT EXISTS idx_tag_queue_resource_tag
  ON tag_confirmation_queue(resource_tag_id);

-- Trigger: updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_tag_confirmation_queue'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_tag_confirmation_queue
      BEFORE UPDATE ON tag_confirmation_queue
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- PUBLISH READINESS CRITERIA
-- ============================================================
-- Configurable thresholds for when a candidate is ready to publish.
-- Different thresholds can exist per jurisdiction or category.
CREATE TABLE IF NOT EXISTS publish_criteria (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Scope (NULL = default/global)
  jurisdiction_state    TEXT,                         -- State-specific criteria
  jurisdiction_county   TEXT,                         -- County-specific criteria
  primary_category      TEXT,                         -- Category-specific (food, housing, etc.)

  -- Confidence thresholds
  min_overall_score     INT NOT NULL DEFAULT 60,      -- Minimum confidence_score on candidate
  min_tag_confidence    INT NOT NULL DEFAULT 70,      -- Tags below this need confirmation

  -- Required confirmations
  min_admin_approvals   INT NOT NULL DEFAULT 1,       -- How many admins must approve
  require_org_approval  BOOLEAN NOT NULL DEFAULT false, -- Must the org also approve?

  -- Required fields (JSONB array of field names)
  -- e.g., ["organization_name", "service_name", "phone", "address_city"]
  required_fields       JSONB NOT NULL DEFAULT '["organization_name", "service_name"]',

  -- Tag requirements
  min_service_type_tags INT NOT NULL DEFAULT 1,       -- Must have at least N service_type tags
  require_demographic_tag BOOLEAN NOT NULL DEFAULT false,

  -- SLA
  max_review_hours      INT NOT NULL DEFAULT 48,      -- SLA for review completion

  is_active             BOOLEAN NOT NULL DEFAULT true,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ensure unique scope combinations
  UNIQUE NULLS NOT DISTINCT (jurisdiction_state, jurisdiction_county, primary_category)
);

-- Insert default global criteria
INSERT INTO publish_criteria (
  jurisdiction_state, jurisdiction_county, primary_category,
  min_overall_score, min_tag_confidence, min_admin_approvals
)
VALUES (NULL, NULL, NULL, 60, 70, 1)
ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_publish_criteria_state
  ON publish_criteria(jurisdiction_state)
  WHERE jurisdiction_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publish_criteria_category
  ON publish_criteria(primary_category)
  WHERE primary_category IS NOT NULL;

-- Trigger: updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_publish_criteria'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_publish_criteria
      BEFORE UPDATE ON publish_criteria
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- CANDIDATE READINESS STATUS
-- ============================================================
-- Caches the current publish-readiness status for each candidate.
-- Updated by triggers when tags are confirmed or candidate is modified.
CREATE TABLE IF NOT EXISTS candidate_readiness (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id          TEXT NOT NULL UNIQUE,         -- References extracted_candidates.candidate_id

  -- Current status
  is_ready              BOOLEAN NOT NULL DEFAULT false,

  -- Breakdown of requirements
  has_required_fields   BOOLEAN NOT NULL DEFAULT false,
  has_required_tags     BOOLEAN NOT NULL DEFAULT false,
  tags_confirmed        BOOLEAN NOT NULL DEFAULT false, -- All pending tags resolved
  meets_score_threshold BOOLEAN NOT NULL DEFAULT false,
  has_admin_approval    BOOLEAN NOT NULL DEFAULT false,

  -- Counts
  pending_tag_count     INT NOT NULL DEFAULT 0,       -- Tags still pending confirmation
  admin_approval_count  INT NOT NULL DEFAULT 0,       -- Number of admin approvals

  -- Blockers (human-readable)
  blockers              JSONB NOT NULL DEFAULT '[]',  -- Array of blocker strings

  -- Timestamps
  last_evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_candidate_readiness_ready
  ON candidate_readiness(is_ready)
  WHERE is_ready = true;

CREATE INDEX IF NOT EXISTS idx_candidate_readiness_pending
  ON candidate_readiness(pending_tag_count)
  WHERE pending_tag_count > 0;

-- Trigger: updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_candidate_readiness'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_candidate_readiness
      BEFORE UPDATE ON candidate_readiness
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- FUNCTION: Queue low-confidence tags for confirmation
-- ============================================================
-- Called after LLM tagging to queue any tags below the confidence threshold.
-- Returns the number of tags queued.
--
-- Usage: SELECT queue_uncertain_tags('cand_abc123', 70);

CREATE OR REPLACE FUNCTION queue_uncertain_tags(
  p_candidate_id TEXT,
  p_confidence_threshold INT DEFAULT 70
)
RETURNS INT AS $$
DECLARE
  v_queued_count INT := 0;
  v_tag RECORD;
BEGIN
  -- Find all tags for this candidate below threshold
  FOR v_tag IN
    SELECT
      rt.id AS resource_tag_id,
      rt.tag_type,
      rt.tag_value,
      rt.confidence
    FROM resource_tags rt
    WHERE rt.target_id = p_candidate_id
      AND rt.target_type = 'candidate'
      AND rt.confidence IS NOT NULL
      AND rt.confidence < p_confidence_threshold
      -- Don't re-queue already queued tags
      AND NOT EXISTS (
        SELECT 1 FROM tag_confirmation_queue tcq
        WHERE tcq.resource_tag_id = rt.id
      )
  LOOP
    INSERT INTO tag_confirmation_queue (
      resource_tag_id,
      candidate_id,
      tag_type,
      tag_value,
      original_confidence
    )
    VALUES (
      v_tag.resource_tag_id,
      p_candidate_id,
      v_tag.tag_type,
      v_tag.tag_value,
      v_tag.confidence
    );

    v_queued_count := v_queued_count + 1;
  END LOOP;

  -- Update candidate readiness pending count
  INSERT INTO candidate_readiness (candidate_id, pending_tag_count)
  VALUES (p_candidate_id, v_queued_count)
  ON CONFLICT (candidate_id) DO UPDATE
  SET pending_tag_count = candidate_readiness.pending_tag_count + v_queued_count,
      tags_confirmed = false,
      is_ready = false,
      last_evaluated_at = now();

  RETURN v_queued_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Evaluate candidate publish readiness
-- ============================================================
-- Checks all publish criteria and updates candidate_readiness.
-- Returns true if candidate is ready to publish.
--
-- Usage: SELECT evaluate_candidate_readiness('cand_abc123');

CREATE OR REPLACE FUNCTION evaluate_candidate_readiness(p_candidate_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_candidate RECORD;
  v_criteria RECORD;
  v_blockers TEXT[] := '{}';
  v_ready BOOLEAN := true;
  v_has_required_fields BOOLEAN := true;
  v_has_required_tags BOOLEAN := true;
  v_tags_confirmed BOOLEAN := true;
  v_meets_score BOOLEAN := true;
  v_has_approval BOOLEAN := false;
  v_pending_tags INT;
  v_approval_count INT;
  v_service_type_count INT;
BEGIN
  -- Get candidate info
  SELECT
    ec.candidate_id,
    ec.confidence_score,
    ec.jurisdiction_state,
    ec.jurisdiction_county,
    ec.organization_name,
    ec.service_name,
    ec.phone,
    ec.address_city,
    ec.review_status
  INTO v_candidate
  FROM extracted_candidates ec
  WHERE ec.candidate_id = p_candidate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate not found: %', p_candidate_id;
  END IF;

  -- Get applicable criteria (most specific first)
  SELECT * INTO v_criteria
  FROM publish_criteria pc
  WHERE pc.is_active = true
    AND (pc.jurisdiction_state IS NULL OR pc.jurisdiction_state = v_candidate.jurisdiction_state)
    AND (pc.jurisdiction_county IS NULL OR pc.jurisdiction_county = v_candidate.jurisdiction_county)
  ORDER BY
    (pc.jurisdiction_county IS NOT NULL) DESC,
    (pc.jurisdiction_state IS NOT NULL) DESC
  LIMIT 1;

  -- Use defaults if no criteria found
  IF NOT FOUND THEN
    v_criteria := ROW(
      NULL, NULL, NULL, NULL, 60, 70, 1, false,
      '["organization_name", "service_name"]'::JSONB, 1, false, 48, true,
      now(), now()
    )::publish_criteria;
  END IF;

  -- Check confidence score
  IF v_candidate.confidence_score < v_criteria.min_overall_score THEN
    v_meets_score := false;
    v_ready := false;
    v_blockers := array_append(v_blockers,
      format('Confidence score %s below minimum %s', v_candidate.confidence_score, v_criteria.min_overall_score));
  END IF;

  -- Check required fields (simplified check for core fields)
  IF v_candidate.organization_name IS NULL OR v_candidate.organization_name = '' THEN
    v_has_required_fields := false;
    v_ready := false;
    v_blockers := array_append(v_blockers, 'Missing required field: organization_name');
  END IF;
  IF v_candidate.service_name IS NULL OR v_candidate.service_name = '' THEN
    v_has_required_fields := false;
    v_ready := false;
    v_blockers := array_append(v_blockers, 'Missing required field: service_name');
  END IF;

  -- Check pending tag confirmations
  SELECT COUNT(*) INTO v_pending_tags
  FROM tag_confirmation_queue tcq
  WHERE tcq.candidate_id = p_candidate_id
    AND tcq.status = 'pending';

  IF v_pending_tags > 0 THEN
    v_tags_confirmed := false;
    v_ready := false;
    v_blockers := array_append(v_blockers, format('%s tags pending confirmation', v_pending_tags));
  END IF;

  -- Check service_type tags count
  SELECT COUNT(*) INTO v_service_type_count
  FROM resource_tags rt
  WHERE rt.target_id = p_candidate_id
    AND rt.target_type = 'candidate'
    AND rt.tag_type = 'service_type';

  IF v_service_type_count < v_criteria.min_service_type_tags THEN
    v_has_required_tags := false;
    v_ready := false;
    v_blockers := array_append(v_blockers,
      format('Need %s service_type tags, have %s', v_criteria.min_service_type_tags, v_service_type_count));
  END IF;

  -- Check admin approvals
  SELECT COUNT(*) INTO v_approval_count
  FROM candidate_admin_assignments caa
  WHERE caa.candidate_id = p_candidate_id
    AND caa.status = 'completed'
    AND caa.outcome = 'verified';

  IF v_approval_count >= v_criteria.min_admin_approvals THEN
    v_has_approval := true;
  ELSE
    v_ready := false;
    v_blockers := array_append(v_blockers,
      format('Need %s admin approvals, have %s', v_criteria.min_admin_approvals, v_approval_count));
  END IF;

  -- Update candidate_readiness table
  INSERT INTO candidate_readiness (
    candidate_id,
    is_ready,
    has_required_fields,
    has_required_tags,
    tags_confirmed,
    meets_score_threshold,
    has_admin_approval,
    pending_tag_count,
    admin_approval_count,
    blockers,
    last_evaluated_at
  )
  VALUES (
    p_candidate_id,
    v_ready,
    v_has_required_fields,
    v_has_required_tags,
    v_tags_confirmed,
    v_meets_score,
    v_has_approval,
    v_pending_tags,
    v_approval_count,
    to_jsonb(v_blockers),
    now()
  )
  ON CONFLICT (candidate_id) DO UPDATE SET
    is_ready = EXCLUDED.is_ready,
    has_required_fields = EXCLUDED.has_required_fields,
    has_required_tags = EXCLUDED.has_required_tags,
    tags_confirmed = EXCLUDED.tags_confirmed,
    meets_score_threshold = EXCLUDED.meets_score_threshold,
    has_admin_approval = EXCLUDED.has_admin_approval,
    pending_tag_count = EXCLUDED.pending_tag_count,
    admin_approval_count = EXCLUDED.admin_approval_count,
    blockers = EXCLUDED.blockers,
    last_evaluated_at = EXCLUDED.last_evaluated_at;

  RETURN v_ready;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGER: Re-evaluate readiness when tag confirmation changes
-- ============================================================
CREATE OR REPLACE FUNCTION reevaluate_on_tag_confirmation()
RETURNS TRIGGER AS $$
BEGIN
  -- When a tag confirmation status changes, re-evaluate candidate
  IF NEW.status != OLD.status THEN
    -- Update pending count
    UPDATE candidate_readiness cr
    SET
      pending_tag_count = (
        SELECT COUNT(*) FROM tag_confirmation_queue tcq
        WHERE tcq.candidate_id = NEW.candidate_id AND tcq.status = 'pending'
      ),
      tags_confirmed = NOT EXISTS (
        SELECT 1 FROM tag_confirmation_queue tcq
        WHERE tcq.candidate_id = NEW.candidate_id AND tcq.status = 'pending'
      ),
      last_evaluated_at = now()
    WHERE cr.candidate_id = NEW.candidate_id;

    -- If tag was modified, update the resource_tag
    IF NEW.status = 'modified' AND NEW.modified_tag_value IS NOT NULL THEN
      UPDATE resource_tags rt
      SET tag_value = NEW.modified_tag_value,
          confidence = 100,  -- Human-confirmed = 100% confidence
          source = 'admin'
      WHERE rt.id = NEW.resource_tag_id;
    ELSIF NEW.status = 'approved' THEN
      -- Boost confidence on approval
      UPDATE resource_tags rt
      SET confidence = 100,
          source = 'admin'
      WHERE rt.id = NEW.resource_tag_id;
    ELSIF NEW.status = 'rejected' THEN
      -- Remove rejected tag
      DELETE FROM resource_tags WHERE id = NEW.resource_tag_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reevaluate_on_tag_confirmation'
  ) THEN
    CREATE TRIGGER trg_reevaluate_on_tag_confirmation
      AFTER UPDATE ON tag_confirmation_queue
      FOR EACH ROW EXECUTE FUNCTION reevaluate_on_tag_confirmation();
  END IF;
END $$;
