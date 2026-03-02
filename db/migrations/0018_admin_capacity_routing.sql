-- ============================================================
-- MIGRATION: 0018_admin_capacity_routing.sql
-- ============================================================
-- Extends Schema A (0002_ingestion_tables.sql) with:
-- 1. Admin review profiles with capacity limits and geographic location
-- 2. Multi-admin candidate assignments (route to N nearest admins)
-- 3. SLA tracking and performance metrics
--
-- This migration properly integrates with:
-- - extracted_candidates (Schema A) - candidate review workflow
-- - coverage_zones (0005) - geographic zones
-- - user_profiles (0006) - user identity
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ============================================================
-- ADMIN REVIEW PROFILES
-- ============================================================
-- Extends user_profiles with review-specific capacity and routing data.
-- Separating from user_profiles keeps that table privacy-focused.
CREATE TABLE IF NOT EXISTS admin_review_profiles (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               TEXT NOT NULL UNIQUE,         -- Links to user_profiles.user_id

  -- Capacity limits (prevent admin overload)
  max_pending           INT NOT NULL DEFAULT 10,      -- Max pending reviews before skip
  max_in_review         INT NOT NULL DEFAULT 5,       -- Max actively reviewing

  -- Current queue counts (maintained by triggers)
  pending_count         INT NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  in_review_count       INT NOT NULL DEFAULT 0 CHECK (in_review_count >= 0),

  -- Geographic location for routing (PostGIS)
  -- Stored as POINT(longitude, latitude) in SRID 4326
  location              GEOMETRY(POINT, 4326),

  -- Jurisdiction coverage (for filtering before distance calc)
  coverage_zone_id      UUID REFERENCES coverage_zones(id) ON DELETE SET NULL,
  coverage_states       TEXT[] DEFAULT '{}',          -- US states this admin covers
  coverage_counties     TEXT[] DEFAULT '{}',          -- Counties (format: "STATE_COUNTY")

  -- Category expertise (for weighted routing)
  -- Matches tag_value in resource_tags where tag_type='service_type'
  category_expertise    TEXT[] DEFAULT '{}',          -- food, housing, healthcare, etc.

  -- Performance metrics (for load balancing)
  total_verified        INT NOT NULL DEFAULT 0,
  total_rejected        INT NOT NULL DEFAULT 0,
  avg_review_hours      DECIMAL(10, 2),               -- Rolling average completion time
  last_review_at        TIMESTAMPTZ,

  -- Status
  is_active             BOOLEAN NOT NULL DEFAULT true,
  is_accepting_new      BOOLEAN NOT NULL DEFAULT true, -- Vacation mode

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_admin_review_profiles_user
  ON admin_review_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_admin_review_profiles_available
  ON admin_review_profiles(is_active, is_accepting_new, pending_count)
  WHERE is_active = true AND is_accepting_new = true;

CREATE INDEX IF NOT EXISTS idx_admin_review_profiles_location
  ON admin_review_profiles USING GIST (location)
  WHERE location IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_review_profiles_zone
  ON admin_review_profiles(coverage_zone_id)
  WHERE coverage_zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_review_profiles_states
  ON admin_review_profiles USING GIN (coverage_states)
  WHERE coverage_states != '{}';

CREATE INDEX IF NOT EXISTS idx_admin_review_profiles_expertise
  ON admin_review_profiles USING GIN (category_expertise)
  WHERE category_expertise != '{}';

-- Trigger: updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_admin_review_profiles'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_admin_review_profiles
      BEFORE UPDATE ON admin_review_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- CANDIDATE ADMIN ASSIGNMENTS
-- ============================================================
-- Tracks which admins are assigned to review each candidate.
-- Supports multi-admin routing (e.g., 5 nearest admins per candidate).
-- Links to extracted_candidates from Schema A (0002).
CREATE TABLE IF NOT EXISTS candidate_admin_assignments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Links to Schema A extracted_candidates
  candidate_id          TEXT NOT NULL,                -- References extracted_candidates.candidate_id

  -- Assigned admin
  admin_profile_id      UUID NOT NULL REFERENCES admin_review_profiles(id) ON DELETE CASCADE,

  -- Assignment metadata
  assignment_type       TEXT NOT NULL DEFAULT 'geographic'
                        CHECK (assignment_type IN ('geographic', 'expertise', 'manual', 'escalation')),
  priority_rank         INT NOT NULL DEFAULT 1,       -- 1 = highest priority assignment
  distance_meters       DECIMAL(12, 2),               -- Distance from admin to candidate location

  -- Status
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'claimed', 'completed', 'declined', 'expired', 'reassigned')),

  -- Timestamps
  assigned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,                  -- SLA deadline

  -- Outcome (when completed)
  outcome               TEXT CHECK (outcome IN ('verified', 'rejected', 'escalated', 'merged')),
  outcome_notes         TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate assignments
  UNIQUE(candidate_id, admin_profile_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_candidate_assignments_candidate
  ON candidate_admin_assignments(candidate_id);

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_admin
  ON candidate_admin_assignments(admin_profile_id);

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_status
  ON candidate_admin_assignments(status);

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_pending
  ON candidate_admin_assignments(admin_profile_id, status, assigned_at)
  WHERE status IN ('pending', 'claimed');

CREATE INDEX IF NOT EXISTS idx_candidate_assignments_expires
  ON candidate_admin_assignments(expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('pending', 'claimed');

-- Trigger: updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_candidate_admin_assignments'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_candidate_admin_assignments
      BEFORE UPDATE ON candidate_admin_assignments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- TRIGGER: Maintain admin queue counts
-- ============================================================
-- Automatically increment/decrement pending_count and in_review_count
-- on admin_review_profiles when assignments change status.

CREATE OR REPLACE FUNCTION update_admin_queue_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      UPDATE admin_review_profiles
        SET pending_count = pending_count + 1
        WHERE id = NEW.admin_profile_id;
    ELSIF NEW.status = 'claimed' THEN
      UPDATE admin_review_profiles
        SET in_review_count = in_review_count + 1
        WHERE id = NEW.admin_profile_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Handle UPDATE (status change)
  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    -- Decrement old status count
    IF OLD.status = 'pending' THEN
      UPDATE admin_review_profiles
        SET pending_count = GREATEST(0, pending_count - 1)
        WHERE id = OLD.admin_profile_id;
    ELSIF OLD.status = 'claimed' THEN
      UPDATE admin_review_profiles
        SET in_review_count = GREATEST(0, in_review_count - 1)
        WHERE id = OLD.admin_profile_id;
    END IF;

    -- Increment new status count
    IF NEW.status = 'pending' THEN
      UPDATE admin_review_profiles
        SET pending_count = pending_count + 1
        WHERE id = NEW.admin_profile_id;
    ELSIF NEW.status = 'claimed' THEN
      UPDATE admin_review_profiles
        SET in_review_count = in_review_count + 1
        WHERE id = NEW.admin_profile_id;
    END IF;

    RETURN NEW;
  END IF;

  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pending' THEN
      UPDATE admin_review_profiles
        SET pending_count = GREATEST(0, pending_count - 1)
        WHERE id = OLD.admin_profile_id;
    ELSIF OLD.status = 'claimed' THEN
      UPDATE admin_review_profiles
        SET in_review_count = GREATEST(0, in_review_count - 1)
        WHERE id = OLD.admin_profile_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_admin_queue_counts'
  ) THEN
    CREATE TRIGGER trg_admin_queue_counts
      AFTER INSERT OR UPDATE OR DELETE ON candidate_admin_assignments
      FOR EACH ROW EXECUTE FUNCTION update_admin_queue_counts();
  END IF;
END $$;

-- ============================================================
-- FUNCTION: Find nearest available admins for a candidate
-- ============================================================
-- Returns up to N nearest admins who:
-- 1. Are active and accepting new assignments
-- 2. Have capacity (pending_count < max_pending)
-- 3. Optionally match candidate's jurisdiction state
-- 4. Optionally have expertise in candidate's category
--
-- Usage: SELECT * FROM find_nearest_admins(
--          candidate_location := ST_SetSRID(ST_MakePoint(-122.4, 37.8), 4326),
--          jurisdiction_state := 'CA',
--          primary_category := 'food',
--          max_admins := 5
--        );

CREATE OR REPLACE FUNCTION find_nearest_admins(
  candidate_location GEOMETRY,
  jurisdiction_state TEXT DEFAULT NULL,
  primary_category TEXT DEFAULT NULL,
  max_admins INT DEFAULT 5
)
RETURNS TABLE (
  admin_profile_id UUID,
  user_id TEXT,
  distance_meters DECIMAL,
  has_expertise BOOLEAN,
  available_capacity INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    arp.id AS admin_profile_id,
    arp.user_id,
    ST_Distance(arp.location::geography, candidate_location::geography) AS distance_meters,
    (primary_category IS NOT NULL AND primary_category = ANY(arp.category_expertise)) AS has_expertise,
    (arp.max_pending - arp.pending_count) AS available_capacity
  FROM admin_review_profiles arp
  WHERE arp.is_active = true
    AND arp.is_accepting_new = true
    AND arp.pending_count < arp.max_pending
    AND arp.location IS NOT NULL
    -- Jurisdiction filter (if provided)
    AND (jurisdiction_state IS NULL OR jurisdiction_state = ANY(arp.coverage_states) OR arp.coverage_states = '{}')
  ORDER BY
    -- Prioritize expertise match
    (primary_category IS NOT NULL AND primary_category = ANY(arp.category_expertise)) DESC,
    -- Then by distance
    ST_Distance(arp.location::geography, candidate_location::geography) ASC,
    -- Then by available capacity (more capacity = higher priority)
    (arp.max_pending - arp.pending_count) DESC
  LIMIT max_admins;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- FUNCTION: Assign candidate to nearest admins
-- ============================================================
-- Finds nearest available admins and creates assignments.
-- Returns the number of assignments created.
--
-- Usage: SELECT assign_candidate_to_admins('cand_abc123', 5, INTERVAL '48 hours');

CREATE OR REPLACE FUNCTION assign_candidate_to_admins(
  p_candidate_id TEXT,
  p_max_admins INT DEFAULT 5,
  p_sla_interval INTERVAL DEFAULT INTERVAL '48 hours'
)
RETURNS INT AS $$
DECLARE
  v_candidate RECORD;
  v_candidate_location GEOMETRY;
  v_admin RECORD;
  v_assignment_count INT := 0;
  v_rank INT := 1;
BEGIN
  -- Get candidate info from extracted_candidates (Schema A)
  SELECT
    ec.candidate_id,
    ec.jurisdiction_state,
    ec.jurisdiction_county,
    -- Try to geocode from address (simplified - in production use geocoding service)
    NULL AS location,
    -- Get primary category from resource_tags
    (SELECT rt.tag_value FROM resource_tags rt
     WHERE rt.target_id = ec.candidate_id
       AND rt.target_type = 'candidate'
       AND rt.tag_type = 'service_type'
     ORDER BY rt.confidence DESC NULLS LAST
     LIMIT 1) AS primary_category
  INTO v_candidate
  FROM extracted_candidates ec
  WHERE ec.candidate_id = p_candidate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate not found: %', p_candidate_id;
  END IF;

  -- For now, use a default location if not geocoded
  -- In production, geocode from address_city + address_region
  v_candidate_location := v_candidate.location;

  -- Find and assign nearest admins
  FOR v_admin IN
    SELECT * FROM find_nearest_admins(
      candidate_location := v_candidate_location,
      jurisdiction_state := v_candidate.jurisdiction_state,
      primary_category := v_candidate.primary_category,
      max_admins := p_max_admins
    )
    WHERE v_candidate_location IS NOT NULL
  LOOP
    -- Insert assignment (ignore if already exists)
    INSERT INTO candidate_admin_assignments (
      candidate_id,
      admin_profile_id,
      assignment_type,
      priority_rank,
      distance_meters,
      expires_at
    )
    VALUES (
      p_candidate_id,
      v_admin.admin_profile_id,
      CASE WHEN v_admin.has_expertise THEN 'expertise' ELSE 'geographic' END,
      v_rank,
      v_admin.distance_meters,
      now() + p_sla_interval
    )
    ON CONFLICT (candidate_id, admin_profile_id) DO NOTHING;

    IF FOUND THEN
      v_assignment_count := v_assignment_count + 1;
      v_rank := v_rank + 1;
    END IF;
  END LOOP;

  RETURN v_assignment_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Update admin performance metrics after review
-- ============================================================
CREATE OR REPLACE FUNCTION update_admin_metrics()
RETURNS TRIGGER AS $$
DECLARE
  v_review_hours DECIMAL;
BEGIN
  -- Only trigger on completion
  IF NEW.status IN ('completed') AND OLD.status != NEW.status THEN
    -- Calculate review duration
    IF NEW.claimed_at IS NOT NULL THEN
      v_review_hours := EXTRACT(EPOCH FROM (now() - NEW.claimed_at)) / 3600.0;
    END IF;

    -- Update admin profile metrics
    UPDATE admin_review_profiles arp
    SET
      total_verified = total_verified + CASE WHEN NEW.outcome = 'verified' THEN 1 ELSE 0 END,
      total_rejected = total_rejected + CASE WHEN NEW.outcome = 'rejected' THEN 1 ELSE 0 END,
      last_review_at = now(),
      -- Rolling average (simplified: just update with new value weight)
      avg_review_hours = CASE
        WHEN avg_review_hours IS NULL THEN v_review_hours
        ELSE (avg_review_hours * 0.9 + v_review_hours * 0.1)
      END
    WHERE arp.id = NEW.admin_profile_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_admin_metrics'
  ) THEN
    CREATE TRIGGER trg_update_admin_metrics
      AFTER UPDATE ON candidate_admin_assignments
      FOR EACH ROW EXECUTE FUNCTION update_admin_metrics();
  END IF;
END $$;
