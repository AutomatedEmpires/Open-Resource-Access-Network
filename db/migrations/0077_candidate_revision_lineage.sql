-- 0077_candidate_revision_lineage.sql
--
-- Expand phase for immutable candidate lineage and independent approval
-- evidence. This migration is deliberately backward compatible with the
-- pre-lineage application: new columns remain nullable, legacy inserts that
-- omit lineage fields are auto-populated, and the governed review workflow is
-- not activated here. Migration 0078 activates the stricter contract only
-- after the lineage-aware application is deployed.

BEGIN;

ALTER TABLE public.extracted_candidates
  ADD COLUMN IF NOT EXISTS revision_of_candidate_id text,
  ADD COLUMN IF NOT EXISTS lineage_root_candidate_id text,
  ADD COLUMN IF NOT EXISTS revision_number integer;

ALTER TABLE public.candidate_admin_assignments
  ADD COLUMN IF NOT EXISTS decision_reviewer_profile_id uuid;

-- Keep bounded repair work fair without exposing candidate identities through
-- a public relation. The selector below is the only writer during normal
-- operation: each selected page advances a durable retry lease before IDs are
-- returned, so a candidate that repeatedly fails routing cannot monopolize the
-- oldest prefix forever. Successful routing deletes the row atomically with the
-- assignments, making a later coverage loss eligible as fresh work.
CREATE TABLE IF NOT EXISTS oran_internal.candidate_reviewer_routing_state (
  candidate_id text PRIMARY KEY,
  selection_count integer NOT NULL DEFAULT 1
    CHECK (selection_count > 0),
  last_selected_at timestamptz NOT NULL,
  next_selectable_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT candidate_reviewer_routing_state_candidate_fk
    FOREIGN KEY (candidate_id)
    REFERENCES public.extracted_candidates(candidate_id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,
  CONSTRAINT candidate_reviewer_routing_state_retry_window_check
    CHECK (next_selectable_at > last_selected_at)
);

CREATE INDEX IF NOT EXISTS idx_candidate_reviewer_routing_retry
  ON oran_internal.candidate_reviewer_routing_state (
    next_selectable_at,
    last_selected_at,
    candidate_id
  );

ALTER TABLE oran_internal.candidate_reviewer_routing_state
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE oran_internal.candidate_reviewer_routing_state
  FROM PUBLIC, anon, authenticated, service_role,
       oran_runtime, oran_backend_runtime;

-- Existing rows predate revision lineage and are therefore lineage roots.
-- Keep the columns nullable during the expand phase, but make the existing
-- population ready for 0078's validated constraints.
UPDATE public.extracted_candidates
SET lineage_root_candidate_id = COALESCE(lineage_root_candidate_id, candidate_id),
    revision_number = COALESCE(revision_number, 1)
WHERE lineage_root_candidate_id IS NULL
   OR revision_number IS NULL;

-- The compatibility trigger has one narrow purpose: preserve old INSERT
-- statements that know nothing about lineage fields. It does not freeze
-- candidate content, bind approval evidence, or activate dual approval.
CREATE OR REPLACE FUNCTION oran_internal.prepare_candidate_revision_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, oran_internal
AS $$
DECLARE
  parent_row record;
BEGIN
  IF NEW.revision_of_candidate_id IS NULL THEN
    NEW.lineage_root_candidate_id := COALESCE(
      NEW.lineage_root_candidate_id,
      NEW.candidate_id
    );
    NEW.revision_number := COALESCE(NEW.revision_number, 1);
    RETURN NEW;
  END IF;

  SELECT candidate_id, lineage_root_candidate_id, revision_number
  INTO parent_row
  FROM public.extracted_candidates
  WHERE candidate_id = NEW.revision_of_candidate_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate revision parent % does not exist',
      NEW.revision_of_candidate_id;
  END IF;

  NEW.lineage_root_candidate_id := COALESCE(
    NEW.lineage_root_candidate_id,
    parent_row.lineage_root_candidate_id,
    parent_row.candidate_id
  );
  NEW.revision_number := COALESCE(
    NEW.revision_number,
    parent_row.revision_number + 1
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_candidate_revision_lineage
  ON public.extracted_candidates;
CREATE TRIGGER trg_prepare_candidate_revision_lineage
  BEFORE INSERT ON public.extracted_candidates
  FOR EACH ROW
  EXECUTE FUNCTION oran_internal.prepare_candidate_revision_lineage();

-- Foreign keys are installed NOT VALID so this expand migration does not take
-- a validation scan over the populated table. They still protect every new
-- revision written after this migration; 0078 validates the backfill.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'extracted_candidates_revision_parent_fk'
      AND conrelid = 'public.extracted_candidates'::regclass
  ) THEN
    ALTER TABLE public.extracted_candidates
      ADD CONSTRAINT extracted_candidates_revision_parent_fk
      FOREIGN KEY (revision_of_candidate_id)
      REFERENCES public.extracted_candidates(candidate_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'extracted_candidates_lineage_root_fk'
      AND conrelid = 'public.extracted_candidates'::regclass
  ) THEN
    ALTER TABLE public.extracted_candidates
      ADD CONSTRAINT extracted_candidates_lineage_root_fk
      FOREIGN KEY (lineage_root_candidate_id)
      REFERENCES public.extracted_candidates(candidate_id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'candidate_admin_assignments_decision_reviewer_profile_fk'
      AND conrelid = 'public.candidate_admin_assignments'::regclass
  ) THEN
    ALTER TABLE public.candidate_admin_assignments
      ADD CONSTRAINT candidate_admin_assignments_decision_reviewer_profile_fk
      FOREIGN KEY (decision_reviewer_profile_id)
      REFERENCES public.admin_review_profiles(id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_extracted_candidates_revision_parent
  ON public.extracted_candidates (revision_of_candidate_id, revision_number DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_extracted_candidates_lineage_revision
  ON public.extracted_candidates (lineage_root_candidate_id, revision_number)
  WHERE lineage_root_candidate_id IS NOT NULL
    AND revision_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_completed_decision_reviewer
  ON public.candidate_admin_assignments (
    candidate_id,
    outcome,
    decision_reviewer_profile_id
  )
  WHERE status = 'completed';

-- Supporting routines land dark. CREATE OR REPLACE retains privileges on an
-- existing function, so explicitly remove every runtime/public grant here and
-- grant the bounded entry points only in 0078.
CREATE OR REPLACE FUNCTION oran_internal.assign_candidate_reviewers(
  p_candidate_id text,
  p_limit integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, oran_internal
AS $$
DECLARE
  reviewer_row record;
  assigned_count integer := 0;
  existing_count integer := 0;
  candidate_row record;
  candidate_category text;
  expired_reviewer_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_limit IS NULL OR p_limit < 2 OR p_limit > 10 THEN
    RAISE EXCEPTION 'Candidate reviewer limit must be between 2 and 10';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('oran:candidate-review-routing:' || p_candidate_id, 0)
  );

  SELECT review_status,
         NULLIF(
           pg_catalog.upper(pg_catalog.btrim(jurisdiction_state)),
           ''
         ) AS jurisdiction_state,
         NULLIF(
           pg_catalog.upper(pg_catalog.btrim(jurisdiction_county)),
           ''
         ) AS jurisdiction_county
  INTO candidate_row
  FROM public.extracted_candidates
  WHERE candidate_id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate % does not exist', p_candidate_id;
  END IF;
  IF candidate_row.review_status IN ('verified', 'rejected', 'published', 'archived') THEN
    DELETE FROM oran_internal.candidate_reviewer_routing_state
    WHERE candidate_id = p_candidate_id;
    RETURN 0;
  END IF;

  -- The candidate lock and advisory lock make lease cleanup and replacement
  -- one routing decision. An overdue reviewer cannot continue to occupy a
  -- coverage slot. Fresh alternatives sort first, while a still-eligible
  -- reviewer can receive a renewed lease when no alternative has capacity.
  WITH expired_assignment AS (
    UPDATE public.candidate_admin_assignments assignment
    SET status = 'expired',
        outcome = NULL,
        outcome_notes = NULL,
        decision_reviewer_profile_id = NULL,
        updated_at = NOW()
    WHERE assignment.candidate_id = p_candidate_id
      AND assignment.status IN ('pending', 'claimed')
      AND assignment.expires_at IS NOT NULL
      AND assignment.expires_at <= NOW()
    RETURNING assignment.admin_profile_id
  )
  SELECT COALESCE(
    pg_catalog.array_agg(expired_assignment.admin_profile_id),
    ARRAY[]::uuid[]
  )
  INTO expired_reviewer_ids
  FROM expired_assignment;

  -- Authorization loss invalidates both pending and claimed work. Vacation
  -- mode only releases work that has not been claimed; an active community
  -- reviewer may finish an already-claimed review without accepting new work.
  UPDATE public.candidate_admin_assignments assignment
  SET status = 'reassigned',
      claimed_at = NULL,
      expires_at = NULL,
      outcome = NULL,
      outcome_notes = NULL,
      decision_reviewer_profile_id = NULL,
      updated_at = NOW()
  WHERE assignment.candidate_id = p_candidate_id
    AND assignment.status IN ('pending', 'claimed')
    AND NOT EXISTS (
      SELECT 1
      FROM public.admin_review_profiles reviewer
      JOIN public.user_profiles account
        ON account.user_id = reviewer.user_id
      WHERE reviewer.id = assignment.admin_profile_id
        AND reviewer.is_active IS TRUE
        AND COALESCE(account.account_status, 'active') = 'active'
        AND account.role = 'community_admin'
        AND (
          assignment.status = 'claimed'
          OR reviewer.is_accepting_new IS TRUE
        )
    );

  SELECT pg_catalog.btrim(tag.tag_value)
  INTO candidate_category
  FROM public.resource_tags tag
  WHERE tag.target_id = p_candidate_id
    AND tag.target_type = 'candidate'
    AND tag.tag_type = 'category'
    AND NOT EXISTS (
      SELECT 1
      FROM public.tag_confirmation_queue confirmation
      WHERE confirmation.resource_tag_id = tag.id
        AND confirmation.candidate_id = p_candidate_id
        AND confirmation.status IN ('rejected', 'skipped')
    )
  ORDER BY tag.confidence DESC NULLS LAST,
           tag.tag_value ASC,
           tag.id ASC
  LIMIT 1;

  SELECT count(DISTINCT CASE
    WHEN assignment.status = 'completed'
         AND assignment.outcome = 'verified'
      THEN assignment.decision_reviewer_profile_id
    WHEN assignment.status IN ('pending', 'claimed')
         AND reviewer.is_active IS TRUE
         AND (
           assignment.status = 'claimed'
           OR reviewer.is_accepting_new IS TRUE
         )
         AND (
           assignment.expires_at IS NULL
           OR assignment.expires_at > NOW()
         )
         AND COALESCE(account.account_status, 'active') = 'active'
         AND account.role = 'community_admin'
         AND (
           (assignment.status = 'pending'
             AND reviewer.pending_count <= reviewer.max_pending)
           OR
           (assignment.status = 'claimed'
             AND reviewer.in_review_count <= reviewer.max_in_review)
         )
      THEN reviewer.id
  END)::integer
  INTO existing_count
  FROM public.candidate_admin_assignments assignment
  LEFT JOIN public.admin_review_profiles reviewer
    ON reviewer.id = assignment.admin_profile_id
  LEFT JOIN public.user_profiles account
    ON account.user_id = reviewer.user_id
  WHERE assignment.candidate_id = p_candidate_id;

  FOR reviewer_row IN
    SELECT reviewer.id,
           CASE
             WHEN routing.expertise_match THEN 'expertise'
             ELSE 'geographic'
           END AS assignment_type
    FROM public.admin_review_profiles reviewer
    JOIN public.user_profiles account
      ON account.user_id = reviewer.user_id
     AND COALESCE(account.account_status, 'active') = 'active'
     AND account.role = 'community_admin'
    CROSS JOIN LATERAL (
      SELECT
        candidate_row.jurisdiction_state IS NOT NULL
          AND candidate_row.jurisdiction_county IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.unnest(
              COALESCE(reviewer.coverage_counties, ARRAY[]::text[])
            ) coverage_county(value)
            WHERE pg_catalog.upper(pg_catalog.btrim(coverage_county.value)) =
              candidate_row.jurisdiction_state || '_' ||
              candidate_row.jurisdiction_county
          ) AS county_match,
        candidate_row.jurisdiction_state IS NOT NULL
          AND COALESCE(pg_catalog.cardinality(reviewer.coverage_counties), 0) = 0
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.unnest(
              COALESCE(reviewer.coverage_states, ARRAY[]::text[])
            ) coverage_state(value)
            WHERE pg_catalog.upper(pg_catalog.btrim(coverage_state.value)) =
              candidate_row.jurisdiction_state
          ) AS state_match,
        COALESCE(pg_catalog.cardinality(reviewer.coverage_states), 0) = 0
          AND COALESCE(pg_catalog.cardinality(reviewer.coverage_counties), 0) = 0
          AS unrestricted_match,
        candidate_category IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.unnest(
              COALESCE(reviewer.category_expertise, ARRAY[]::text[])
            ) expertise(value)
            WHERE pg_catalog.lower(pg_catalog.btrim(expertise.value)) =
              pg_catalog.lower(candidate_category)
          ) AS expertise_match
    ) routing
    WHERE reviewer.is_active IS TRUE
      AND reviewer.is_accepting_new IS TRUE
      AND reviewer.pending_count < reviewer.max_pending
      AND reviewer.in_review_count < reviewer.max_in_review
      AND (
        routing.county_match
        OR routing.state_match
        OR routing.unrestricted_match
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.candidate_admin_assignments existing_assignment
        WHERE existing_assignment.candidate_id = p_candidate_id
          AND existing_assignment.admin_profile_id = reviewer.id
          AND existing_assignment.status IN ('pending', 'claimed', 'completed')
      )
    ORDER BY (reviewer.id = ANY(expired_reviewer_ids)) ASC,
             CASE
               WHEN routing.county_match THEN 0
               WHEN routing.state_match THEN 1
               ELSE 2
             END ASC,
             routing.expertise_match DESC,
             reviewer.pending_count ASC,
             reviewer.in_review_count ASC,
             reviewer.id ASC
    LIMIT GREATEST(p_limit - existing_count, 0)
    FOR UPDATE OF reviewer SKIP LOCKED
  LOOP
    INSERT INTO public.candidate_admin_assignments (
      candidate_id,
      admin_profile_id,
      assignment_type,
      priority_rank,
      status,
      expires_at
    )
    VALUES (
      p_candidate_id,
      reviewer_row.id,
      reviewer_row.assignment_type,
      existing_count + assigned_count + 1,
      'pending',
      NOW() + interval '48 hours'
    )
    ON CONFLICT (candidate_id, admin_profile_id) DO UPDATE
    SET assignment_type = EXCLUDED.assignment_type,
        priority_rank = EXCLUDED.priority_rank,
        status = 'pending',
        assigned_at = NOW(),
        claimed_at = NULL,
        completed_at = NULL,
        expires_at = EXCLUDED.expires_at,
        outcome = NULL,
        outcome_notes = NULL,
        decision_reviewer_profile_id = NULL,
        updated_at = NOW()
    WHERE candidate_admin_assignments.status IN (
      'declined', 'expired', 'reassigned'
    );
    IF FOUND THEN
      assigned_count := assigned_count + 1;
    END IF;
  END LOOP;

  -- Return the total qualifying identities now covering the candidate, not
  -- merely the number inserted by this invocation. Callers can therefore
  -- detect capacity exhaustion on both first and idempotent routing attempts.
  SELECT count(DISTINCT CASE
    WHEN assignment.status = 'completed'
         AND assignment.outcome = 'verified'
      THEN assignment.decision_reviewer_profile_id
    WHEN assignment.status IN ('pending', 'claimed')
         AND reviewer.is_active IS TRUE
         AND (
           assignment.status = 'claimed'
           OR reviewer.is_accepting_new IS TRUE
         )
         AND (
           assignment.expires_at IS NULL
           OR assignment.expires_at > NOW()
         )
         AND COALESCE(account.account_status, 'active') = 'active'
         AND account.role = 'community_admin'
         AND (
           (assignment.status = 'pending'
             AND reviewer.pending_count <= reviewer.max_pending)
           OR
           (assignment.status = 'claimed'
             AND reviewer.in_review_count <= reviewer.max_in_review)
         )
      THEN reviewer.id
  END)::integer
  INTO existing_count
  FROM public.candidate_admin_assignments assignment
  LEFT JOIN public.admin_review_profiles reviewer
    ON reviewer.id = assignment.admin_profile_id
  LEFT JOIN public.user_profiles account
    ON account.user_id = reviewer.user_id
  WHERE assignment.candidate_id = p_candidate_id;

  IF existing_count >= p_limit THEN
    DELETE FROM oran_internal.candidate_reviewer_routing_state
    WHERE candidate_id = p_candidate_id;
  END IF;

  RETURN existing_count;
END;
$$;

-- Select and atomically reserve a bounded fair page of open candidates whose
-- current reviewer coverage has fallen below the requested target. Never-
-- selected work sorts oldest-first, then previously selected work sorts by its
-- least-recent selection before candidate age. A bounded retry window prevents
-- a permanently under-covered or throwing candidate from monopolizing every
-- invocation. Returning candidate IDs only keeps peer identities opaque. The
-- backend routes each ID in its own call to assign_candidate_reviewers so one
-- failure cannot roll back other candidates.
CREATE OR REPLACE FUNCTION oran_internal.list_undercovered_candidate_reviews(
  p_batch_limit integer DEFAULT 100,
  p_reviewer_limit integer DEFAULT 2
)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public, oran_internal
AS $$
DECLARE
  selected_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit < 1 OR p_batch_limit > 500 THEN
    RAISE EXCEPTION 'Candidate review selector batch limit must be between 1 and 500';
  END IF;
  IF p_reviewer_limit IS NULL
     OR p_reviewer_limit < 2
     OR p_reviewer_limit > 10 THEN
    RAISE EXCEPTION 'Candidate reviewer limit must be between 2 and 10';
  END IF;

  RETURN QUERY
    WITH candidate_batch AS MATERIALIZED (
      SELECT candidate.candidate_id,
             candidate.created_at,
             routing_state.last_selected_at
      FROM public.extracted_candidates candidate
      LEFT JOIN oran_internal.candidate_reviewer_routing_state routing_state
        ON routing_state.candidate_id = candidate.candidate_id
      WHERE candidate.published_service_id IS NULL
        AND candidate.review_status IN ('pending', 'in_review', 'escalated')
        AND (
          routing_state.next_selectable_at IS NULL
          OR routing_state.next_selectable_at <= selected_at
        )
        AND (
          SELECT count(DISTINCT CASE
            WHEN assignment.status = 'completed'
                 AND assignment.outcome = 'verified'
              THEN assignment.decision_reviewer_profile_id
            WHEN assignment.status IN ('pending', 'claimed')
                 AND reviewer.is_active IS TRUE
                 AND (
                   assignment.status = 'claimed'
                   OR reviewer.is_accepting_new IS TRUE
                 )
                 AND (
                   assignment.expires_at IS NULL
                   OR assignment.expires_at > NOW()
                 )
                 AND COALESCE(account.account_status, 'active') = 'active'
                 AND account.role = 'community_admin'
                 AND (
                   (assignment.status = 'pending'
                     AND reviewer.pending_count <= reviewer.max_pending)
                   OR
                   (assignment.status = 'claimed'
                     AND reviewer.in_review_count <= reviewer.max_in_review)
                 )
              THEN reviewer.id
          END)
          FROM public.candidate_admin_assignments assignment
          LEFT JOIN public.admin_review_profiles reviewer
            ON reviewer.id = assignment.admin_profile_id
          LEFT JOIN public.user_profiles account
            ON account.user_id = reviewer.user_id
          WHERE assignment.candidate_id = candidate.candidate_id
        ) < p_reviewer_limit
      ORDER BY routing_state.last_selected_at ASC NULLS FIRST,
               candidate.created_at ASC,
               candidate.candidate_id ASC
      LIMIT p_batch_limit
      FOR UPDATE OF candidate SKIP LOCKED
    ),
    recorded_selection AS (
      INSERT INTO oran_internal.candidate_reviewer_routing_state AS routing_state (
        candidate_id,
        selection_count,
        last_selected_at,
        next_selectable_at,
        updated_at
      )
      SELECT candidate_batch.candidate_id,
             1,
             selected_at,
             selected_at + interval '5 minutes',
             selected_at
      FROM candidate_batch
      ON CONFLICT (candidate_id) DO UPDATE
      SET selection_count = CASE
            WHEN routing_state.selection_count < 2147483647
              THEN routing_state.selection_count + 1
            ELSE routing_state.selection_count
          END,
          last_selected_at = EXCLUDED.last_selected_at,
          next_selectable_at = EXCLUDED.last_selected_at + CASE
            WHEN routing_state.selection_count = 1 THEN interval '10 minutes'
            WHEN routing_state.selection_count = 2 THEN interval '20 minutes'
            WHEN routing_state.selection_count = 3 THEN interval '40 minutes'
            ELSE interval '60 minutes'
          END,
          updated_at = EXCLUDED.updated_at
      RETURNING candidate_id
    )
    SELECT candidate_batch.candidate_id
    FROM candidate_batch
    JOIN recorded_selection
      ON recorded_selection.candidate_id = candidate_batch.candidate_id
    ORDER BY candidate_batch.last_selected_at ASC NULLS FIRST,
             candidate_batch.created_at ASC,
             candidate_batch.candidate_id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION oran_internal.escalate_candidate_for_review(
  p_candidate_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, oran_internal
AS $$
BEGIN
  UPDATE public.extracted_candidates
  SET review_status = 'escalated',
      assigned_to_role = 'oran_admin',
      assigned_to_user_id = NULL,
      assigned_at = NULL,
      updated_at = NOW()
  WHERE candidate_id = p_candidate_id
    AND review_status = 'pending'
    AND published_service_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate % is not eligible for escalation', p_candidate_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION oran_internal.prepare_candidate_revision_lineage()
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION oran_internal.assign_candidate_reviewers(text, integer)
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION oran_internal.list_undercovered_candidate_reviews(integer, integer)
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION oran_internal.escalate_candidate_for_review(text)
  FROM PUBLIC, oran_runtime, oran_backend_runtime;

COMMENT ON FUNCTION oran_internal.list_undercovered_candidate_reviews(integer, integer) IS
  'Backend-only bounded fair selector that atomically advances private retry state for open candidates lacking current reviewer coverage.';

COMMENT ON TABLE oran_internal.candidate_reviewer_routing_state IS
  'Private bounded-selector retry state; reachable only through candidate reviewer routing functions.';

COMMENT ON COLUMN public.extracted_candidates.revision_of_candidate_id IS
  'Immediate parent candidate ID. Enforcement becomes strict in migration 0078.';
COMMENT ON COLUMN public.extracted_candidates.revision_number IS
  'Monotonic revision number within a candidate lineage; roots are revision 1.';
COMMENT ON COLUMN public.extracted_candidates.lineage_root_candidate_id IS
  'Stable root candidate ID used to serialize immutable revisions.';
COMMENT ON COLUMN public.candidate_admin_assignments.decision_reviewer_profile_id IS
  'Immutable privacy-safe reviewer profile evidence after migration 0078 activates the approval guard.';

COMMIT;
