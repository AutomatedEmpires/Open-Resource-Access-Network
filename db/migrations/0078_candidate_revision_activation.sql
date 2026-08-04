-- 0078_candidate_revision_activation.sql
--
-- Contract/activation phase for candidate revision lineage. Apply only after
-- the lineage-aware application has been deployed while 0077 remains dark.
-- This migration validates and freezes lineage identity, protects completed
-- approval evidence, raises the publication threshold to two independent
-- reviewers, and exposes only the bounded reviewer-routing routines.

BEGIN;

-- Close any expand-phase gap before validating the strict contract.
UPDATE public.extracted_candidates
SET lineage_root_candidate_id = COALESCE(lineage_root_candidate_id, candidate_id),
    revision_number = COALESCE(revision_number, 1)
WHERE lineage_root_candidate_id IS NULL
   OR revision_number IS NULL;

ALTER TABLE public.extracted_candidates
  VALIDATE CONSTRAINT extracted_candidates_revision_parent_fk;
ALTER TABLE public.extracted_candidates
  VALIDATE CONSTRAINT extracted_candidates_lineage_root_fk;
ALTER TABLE public.candidate_admin_assignments
  VALIDATE CONSTRAINT candidate_admin_assignments_decision_reviewer_profile_fk;

-- Foreign keys prove that the referenced rows exist, but not that a child
-- belongs to its parent's lineage or advances by exactly one revision. Refuse
-- activation if the expand window accumulated any semantic lineage drift.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.extracted_candidates candidate
    JOIN public.extracted_candidates parent
      ON parent.candidate_id = candidate.revision_of_candidate_id
    WHERE candidate.revision_of_candidate_id IS NOT NULL
      AND (
        candidate.lineage_root_candidate_id
          IS DISTINCT FROM parent.lineage_root_candidate_id
        OR candidate.revision_number
          IS DISTINCT FROM parent.revision_number + 1
      )
  ) THEN
    RAISE EXCEPTION
      'candidate lineage activation refused: child parent/root/revision drift exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.extracted_candidates candidate
    JOIN public.extracted_candidates root
      ON root.candidate_id = candidate.lineage_root_candidate_id
    WHERE root.revision_of_candidate_id IS NOT NULL
       OR root.lineage_root_candidate_id IS DISTINCT FROM root.candidate_id
       OR root.revision_number IS DISTINCT FROM 1
  ) THEN
    RAISE EXCEPTION
      'candidate lineage activation refused: a referenced root is not self-rooted revision 1';
  END IF;
END
$$;

-- 0077 creates this index with IF NOT EXISTS so that the expand phase is
-- retry-safe. Before activating, prove that no same-name object or catalog
-- drift weakened the one-revision-per-lineage invariant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_row
    WHERE index_row.indexrelid =
        pg_catalog.to_regclass('public.idx_extracted_candidates_lineage_revision')
      AND index_row.indrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND index_row.indisunique
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indnkeyatts = 2
      AND index_row.indnatts = 2
      AND ARRAY(
        SELECT attribute.attname::text
        FROM pg_catalog.unnest(index_row.indkey)
          WITH ORDINALITY AS key_column(attnum, key_position)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = index_row.indrelid
         AND attribute.attnum = key_column.attnum
        WHERE key_column.key_position <= index_row.indnkeyatts
        ORDER BY key_column.key_position
      ) = ARRAY['lineage_root_candidate_id', 'revision_number']::text[]
      AND pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
          '[()[:space:]]',
          '',
          'g'
        )
      ) = 'lineage_root_candidate_idisnotnullandrevision_numberisnotnull'
  ) THEN
    RAISE EXCEPTION
      'candidate lineage activation refused: unique lineage revision index is missing or invalid';
  END IF;
END
$$;

-- Do not activate a human-review regime with no operationally independent
-- reviewers. Both identities must be authorized, active, accepting work, and
-- have capacity at the activation boundary.
DO $$
DECLARE
  eligible_reviewer_count integer;
BEGIN
  SELECT count(DISTINCT reviewer.id)::integer
  INTO eligible_reviewer_count
  FROM public.admin_review_profiles reviewer
  JOIN public.user_profiles account
    ON account.user_id = reviewer.user_id
  WHERE reviewer.is_active IS TRUE
    AND reviewer.is_accepting_new IS TRUE
    AND reviewer.pending_count < reviewer.max_pending
    AND reviewer.in_review_count < reviewer.max_in_review
    AND COALESCE(account.account_status, 'active') = 'active'
    AND account.role = 'community_admin';

  IF eligible_reviewer_count < 2 THEN
    RAISE EXCEPTION
      'candidate lineage activation refused: at least two active authorized community reviewers with capacity are required';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'extracted_candidates_revision_number_check'
      AND conrelid = 'public.extracted_candidates'::regclass
  ) THEN
    ALTER TABLE public.extracted_candidates
      ADD CONSTRAINT extracted_candidates_revision_number_check
      CHECK (
        revision_number >= 1
        AND (
          (revision_of_candidate_id IS NULL AND revision_number = 1
            AND lineage_root_candidate_id = candidate_id)
          OR
          (revision_of_candidate_id IS NOT NULL AND revision_number > 1)
        )
        AND revision_of_candidate_id IS DISTINCT FROM candidate_id
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.extracted_candidates
  VALIDATE CONSTRAINT extracted_candidates_revision_number_check;
ALTER TABLE public.extracted_candidates
  ALTER COLUMN lineage_root_candidate_id SET NOT NULL,
  ALTER COLUMN revision_number SET NOT NULL;

CREATE OR REPLACE FUNCTION oran_internal.enforce_candidate_revision_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, oran_internal
AS $$
DECLARE
  parent_row record;
  root_row record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.review_status <> 'pending' THEN
    RAISE EXCEPTION 'New candidate revisions must enter review as pending';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
       OR NEW.extraction_id IS DISTINCT FROM OLD.extraction_id
       OR NEW.extract_key_sha256 IS DISTINCT FROM OLD.extract_key_sha256
       OR NEW.extracted_at IS DISTINCT FROM OLD.extracted_at
       OR NEW.revision_of_candidate_id IS DISTINCT FROM OLD.revision_of_candidate_id
       OR NEW.lineage_root_candidate_id IS DISTINCT FROM OLD.lineage_root_candidate_id
       OR NEW.revision_number IS DISTINCT FROM OLD.revision_number THEN
      RAISE EXCEPTION 'Candidate lineage identity is immutable after insert';
    END IF;

    IF (
      OLD.review_status IN (
        'in_review', 'escalated', 'verified', 'rejected', 'published', 'archived'
      )
      OR NEW.review_status IN (
        'in_review', 'escalated', 'verified', 'rejected', 'published', 'archived'
      )
    ) AND (
      NEW.organization_name IS DISTINCT FROM OLD.organization_name
      OR NEW.service_name IS DISTINCT FROM OLD.service_name
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.website_url IS DISTINCT FROM OLD.website_url
      OR NEW.phone IS DISTINCT FROM OLD.phone
      OR NEW.phones IS DISTINCT FROM OLD.phones
      OR NEW.address_line1 IS DISTINCT FROM OLD.address_line1
      OR NEW.address_line2 IS DISTINCT FROM OLD.address_line2
      OR NEW.address_city IS DISTINCT FROM OLD.address_city
      OR NEW.address_region IS DISTINCT FROM OLD.address_region
      OR NEW.address_postal_code IS DISTINCT FROM OLD.address_postal_code
      OR NEW.address_country IS DISTINCT FROM OLD.address_country
      OR NEW.is_remote_service IS DISTINCT FROM OLD.is_remote_service
      OR NEW.jurisdiction_state IS DISTINCT FROM OLD.jurisdiction_state
      OR NEW.jurisdiction_county IS DISTINCT FROM OLD.jurisdiction_county
      OR NEW.jurisdiction_city IS DISTINCT FROM OLD.jurisdiction_city
      OR NEW.jurisdiction_kind IS DISTINCT FROM OLD.jurisdiction_kind
      OR NEW.primary_evidence_id IS DISTINCT FROM OLD.primary_evidence_id
      OR NEW.provenance_records IS DISTINCT FROM OLD.provenance_records
      OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
      OR NEW.confidence_tier IS DISTINCT FROM OLD.confidence_tier
      OR NEW.score_verification IS DISTINCT FROM OLD.score_verification
      OR NEW.score_completeness IS DISTINCT FROM OLD.score_completeness
      OR NEW.score_freshness IS DISTINCT FROM OLD.score_freshness
      OR NEW.verification_checklist IS DISTINCT FROM OLD.verification_checklist
      OR NEW.investigation_pack IS DISTINCT FROM OLD.investigation_pack
      OR NEW.job_id IS DISTINCT FROM OLD.job_id
      OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    ) THEN
      RAISE EXCEPTION 'Reviewed candidate content is immutable; append a child revision';
    END IF;
  END IF;

  IF NEW.revision_of_candidate_id IS NULL THEN
    NEW.lineage_root_candidate_id := COALESCE(
      NEW.lineage_root_candidate_id,
      NEW.candidate_id
    );
    NEW.revision_number := COALESCE(NEW.revision_number, 1);
    IF NEW.revision_number <> 1
       OR NEW.lineage_root_candidate_id <> NEW.candidate_id THEN
      RAISE EXCEPTION 'Candidate lineage root must be revision 1 and self-rooted';
    END IF;
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
    parent_row.lineage_root_candidate_id
  );
  NEW.revision_number := COALESCE(
    NEW.revision_number,
    parent_row.revision_number + 1
  );
  IF NEW.lineage_root_candidate_id <> parent_row.lineage_root_candidate_id THEN
    RAISE EXCEPTION 'Candidate revision root must equal its parent root';
  END IF;
  IF NEW.revision_number <> parent_row.revision_number + 1 THEN
    RAISE EXCEPTION 'Candidate revision number must equal parent revision plus one';
  END IF;

  SELECT candidate_id, revision_of_candidate_id, lineage_root_candidate_id,
         revision_number
  INTO root_row
  FROM public.extracted_candidates
  WHERE candidate_id = NEW.lineage_root_candidate_id
  FOR KEY SHARE;
  IF NOT FOUND
     OR root_row.revision_of_candidate_id IS NOT NULL
     OR root_row.lineage_root_candidate_id <> root_row.candidate_id
     OR root_row.revision_number <> 1 THEN
    RAISE EXCEPTION 'Candidate lineage root is not a valid root row';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_candidate_revision_lineage
  ON public.extracted_candidates;
DROP FUNCTION IF EXISTS oran_internal.prepare_candidate_revision_lineage();
DROP TRIGGER IF EXISTS trg_enforce_candidate_revision_lineage
  ON public.extracted_candidates;
CREATE TRIGGER trg_enforce_candidate_revision_lineage
  BEFORE INSERT OR UPDATE ON public.extracted_candidates
  FOR EACH ROW
  EXECUTE FUNCTION oran_internal.enforce_candidate_revision_lineage();

-- Candidate decisions belong to community reviewers. ORAN administrators are
-- oversight/escalation identities and cannot occupy a candidate reviewer slot
-- or carry forward legacy decision authority. Reopen every assignment whose
-- profile is not an active authorized community reviewer.
UPDATE public.candidate_admin_assignments assignment
SET status = 'reassigned',
    outcome = NULL,
    claimed_at = NULL,
    completed_at = NULL,
    expires_at = NULL,
    decision_reviewer_profile_id = NULL,
    updated_at = NOW()
WHERE assignment.status IN ('pending', 'claimed', 'completed')
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_review_profiles reviewer
    JOIN public.user_profiles account
      ON account.user_id = reviewer.user_id
    WHERE reviewer.id = assignment.admin_profile_id
      AND reviewer.is_active IS TRUE
      AND COALESCE(account.account_status, 'active') = 'active'
      AND account.role = 'community_admin'
  );

-- Before activation, admin_profile_id identified an assignee, not a proven
-- decision actor: the identity-binding route and approval audit vocabulary
-- were dark. Never infer immutable authority from that assignment. Every
-- legacy completion is reopened and must be decided again through the
-- activated claimed-to-completed trigger.
UPDATE public.candidate_admin_assignments assignment
SET status = 'reassigned',
    outcome = NULL,
    claimed_at = NULL,
    completed_at = NULL,
    expires_at = NULL,
    decision_reviewer_profile_id = NULL,
    updated_at = NOW()
WHERE assignment.status = 'completed';

-- Human decisions created before community-only reviewer authority became an
-- enforced contract are not publication authority, even when legacy rows carry
-- an actor and timestamp. Capture every accepted legacy decision before
-- reopening it so completed approvals can be invalidated in the same activation
-- transaction instead of trusting an unverifiable pre-activation role.
CREATE TEMP TABLE candidate_reopened_human_evidence (
  candidate_id text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO pg_temp.candidate_reopened_human_evidence (candidate_id)
SELECT confirmation.candidate_id
FROM public.tag_confirmation_queue confirmation
WHERE confirmation.status IN ('approved', 'modified')
UNION
SELECT suggestion.candidate_id
FROM public.llm_suggestions suggestion
WHERE suggestion.status = 'accepted'
ON CONFLICT (candidate_id) DO NOTHING;

-- Reopen every pre-activation decision so the activated community-only routes
-- can collect complete, attributable evidence. Tag assignment is cleared too:
-- a legacy ORAN-admin assignee must not retain the reopened community work.
UPDATE public.tag_confirmation_queue
SET status = 'pending',
    assigned_to_user_id = NULL,
    assigned_at = NULL,
    reviewed_by_user_id = NULL,
    reviewed_at = NULL,
    modified_tag_value = NULL,
    review_notes = NULL,
    updated_at = NOW()
WHERE status IN ('approved', 'modified');

UPDATE public.llm_suggestions
SET status = 'pending',
    reviewed_by = NULL,
    reviewed_at = NULL,
    original_value = NULL
WHERE status = 'accepted';

-- Existing pending human decisions are the same publication blocker. Fold
-- them into the captured set so no completed approval can coexist with work
-- the activated stores are still required to resolve.
INSERT INTO pg_temp.candidate_reopened_human_evidence (candidate_id)
SELECT confirmation.candidate_id
FROM public.tag_confirmation_queue confirmation
WHERE confirmation.status = 'pending'
UNION
SELECT suggestion.candidate_id
FROM public.llm_suggestions suggestion
WHERE suggestion.status = 'pending'
ON CONFLICT (candidate_id) DO NOTHING;

UPDATE public.candidate_admin_assignments assignment
SET status = 'reassigned',
    outcome = NULL,
    claimed_at = NULL,
    completed_at = NULL,
    expires_at = NULL,
    decision_reviewer_profile_id = NULL,
    updated_at = NOW()
WHERE assignment.status = 'completed'
  AND EXISTS (
    SELECT 1
    FROM pg_temp.candidate_reopened_human_evidence affected
    WHERE affected.candidate_id = assignment.candidate_id
  );

UPDATE public.extracted_candidates candidate
SET review_status = 'escalated',
    assigned_to_role = 'oran_admin',
    assigned_to_user_id = NULL,
    assigned_at = NULL,
    updated_at = NOW()
WHERE candidate.published_service_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM pg_temp.candidate_reopened_human_evidence affected
    WHERE affected.candidate_id = candidate.candidate_id
  );

UPDATE public.extracted_candidates candidate
SET review_status = 'escalated',
    assigned_to_role = 'oran_admin',
    assigned_to_user_id = NULL,
    assigned_at = NULL,
    updated_at = NOW()
WHERE candidate.published_service_id IS NULL
  AND candidate.review_status IN ('verified', 'rejected')
  AND (
    (
      SELECT count(DISTINCT assignment.decision_reviewer_profile_id)
      FROM public.candidate_admin_assignments assignment
      WHERE assignment.candidate_id = candidate.candidate_id
        AND assignment.status = 'completed'
        AND assignment.outcome = CASE
          WHEN candidate.review_status = 'verified' THEN 'verified'
          ELSE 'rejected'
        END
    ) < 2
    OR (
      SELECT count(DISTINCT assignment.decision_reviewer_profile_id)
      FROM public.candidate_admin_assignments assignment
      WHERE assignment.candidate_id = candidate.candidate_id
        AND assignment.status = 'completed'
        AND assignment.outcome = CASE
          WHEN candidate.review_status = 'verified' THEN 'rejected'
          ELSE 'verified'
        END
    ) > 0
    OR EXISTS (
      SELECT 1
      FROM public.candidate_admin_assignments assignment
      WHERE assignment.candidate_id = candidate.candidate_id
        AND assignment.status = 'completed'
        AND assignment.outcome = 'escalated'
    )
  );

-- Route every still-open candidate through the bounded database router. The
-- postcondition counts completed verified identities plus current, unexpired,
-- qualifying pending or claimed reviewer identities. Stale, unauthorized, or
-- rejected assignments cannot make an open candidate appear staffed.
DO $$
DECLARE
  candidate_row record;
BEGIN
  FOR candidate_row IN
    SELECT candidate.candidate_id
    FROM public.extracted_candidates candidate
    WHERE candidate.published_service_id IS NULL
      AND candidate.review_status IN ('pending', 'in_review', 'escalated')
    ORDER BY candidate.candidate_id
    FOR UPDATE
  LOOP
    PERFORM oran_internal.assign_candidate_reviewers(
      candidate_row.candidate_id,
      2
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.extracted_candidates candidate
    WHERE candidate.published_service_id IS NULL
      AND candidate.review_status IN ('pending', 'in_review', 'escalated')
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
      ) < 2
  ) THEN
    RAISE EXCEPTION
      'candidate lineage activation refused: one or more open candidates lack two independent community reviewer identities';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.extracted_candidates candidate
    WHERE candidate.published_service_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.candidate_admin_assignments assignment
        WHERE assignment.candidate_id = candidate.candidate_id
          AND assignment.status = 'completed'
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.tag_confirmation_queue confirmation
          WHERE confirmation.candidate_id = candidate.candidate_id
            AND confirmation.status = 'pending'
        )
        OR EXISTS (
          SELECT 1
          FROM public.llm_suggestions suggestion
          WHERE suggestion.candidate_id = candidate.candidate_id
            AND suggestion.status = 'pending'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'candidate lineage activation refused: pending human evidence coexists with completed approval evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.candidate_admin_assignments assignment
    JOIN public.admin_review_profiles reviewer
      ON reviewer.id = assignment.admin_profile_id
    JOIN public.user_profiles account
      ON account.user_id = reviewer.user_id
    WHERE assignment.status IN ('pending', 'claimed')
      AND account.role <> 'community_admin'
  ) THEN
    RAISE EXCEPTION
      'candidate lineage activation refused: oversight-only assignment occupies a reviewer slot';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'candidate_admin_assignments_decision_reviewer_check'
      AND conrelid = 'public.candidate_admin_assignments'::regclass
  ) THEN
    ALTER TABLE public.candidate_admin_assignments
      ADD CONSTRAINT candidate_admin_assignments_decision_reviewer_check
      CHECK (
        (
          status = 'completed'
          AND decision_reviewer_profile_id IS NOT NULL
          AND decision_reviewer_profile_id = admin_profile_id
          AND claimed_at IS NOT NULL
          AND completed_at IS NOT NULL
          AND outcome IN ('verified', 'rejected', 'escalated')
        )
        OR
        (status <> 'completed' AND decision_reviewer_profile_id IS NULL)
      );
  END IF;
END
$$;

-- A reviewer profile may be deactivated later, but deleting it must never
-- cascade-delete immutable completed decision evidence.
DO $$
DECLARE
  assignment_profile_fk text;
BEGIN
  SELECT constraint_row.conname
  INTO assignment_profile_fk
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.candidate_admin_assignments'::regclass
    AND constraint_row.confrelid = 'public.admin_review_profiles'::regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.conkey = ARRAY[
      (
        SELECT attribute.attnum
        FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid = constraint_row.conrelid
          AND attribute.attname = 'admin_profile_id'
          AND NOT attribute.attisdropped
      )
    ]::smallint[]
  LIMIT 1;

  IF assignment_profile_fk IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.candidate_admin_assignments DROP CONSTRAINT %I',
      assignment_profile_fk
    );
  END IF;

  ALTER TABLE public.candidate_admin_assignments
    ADD CONSTRAINT candidate_admin_assignments_admin_profile_id_fkey
    FOREIGN KEY (admin_profile_id)
    REFERENCES public.admin_review_profiles(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;
END
$$;

CREATE OR REPLACE FUNCTION oran_internal.protect_completed_candidate_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, oran_internal
AS $$
DECLARE
  locked_candidate_id text;
  authorized_reviewer_profile_id uuid;
BEGIN
  locked_candidate_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.candidate_id
    ELSE NEW.candidate_id
  END;

  -- Approval mutation and publication both lock the candidate first, so neither
  -- can observe or create half-committed authorization evidence.
  PERFORM 1
  FROM public.extracted_candidates
  WHERE candidate_id = locked_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate % does not exist', locked_candidate_id;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'completed' THEN
    RAISE EXCEPTION 'Completed candidate approvals must be reached from a claimed assignment';
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.status <> 'completed'
     AND NEW.decision_reviewer_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reviewer identity evidence may only be bound at completion';
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Completed candidate approval evidence is immutable';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
       OR NEW.admin_profile_id IS DISTINCT FROM OLD.admin_profile_id THEN
      RAISE EXCEPTION 'Candidate approval assignment identity is immutable';
    END IF;

    IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
      IF OLD.status <> 'claimed'
         OR OLD.claimed_at IS NULL
         OR NEW.completed_at IS NULL
         OR NEW.outcome NOT IN ('verified', 'rejected', 'escalated') THEN
        RAISE EXCEPTION 'Candidate approval completion requires a claimed assignment and complete outcome evidence';
      END IF;

      SELECT reviewer.id
      INTO authorized_reviewer_profile_id
      FROM public.admin_review_profiles reviewer
      JOIN public.user_profiles account
        ON account.user_id = reviewer.user_id
      WHERE reviewer.id = NEW.admin_profile_id
        AND reviewer.is_active IS TRUE
        AND COALESCE(account.account_status, 'active') = 'active'
        AND account.role = 'community_admin'
      FOR SHARE OF reviewer, account;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Candidate approval completion requires an active authorized community reviewer';
      END IF;
      NEW.decision_reviewer_profile_id := authorized_reviewer_profile_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_completed_candidate_approval
  ON public.candidate_admin_assignments;
CREATE TRIGGER trg_protect_completed_candidate_approval
  BEFORE INSERT OR UPDATE OR DELETE ON public.candidate_admin_assignments
  FOR EACH ROW
  EXECUTE FUNCTION oran_internal.protect_completed_candidate_approval();

ALTER TABLE public.publish_criteria
  ALTER COLUMN min_admin_approvals SET DEFAULT 2;
UPDATE public.publish_criteria
SET min_admin_approvals = 2,
    updated_at = NOW()
WHERE min_admin_approvals < 2;

-- Recompute the authoritative ingestion baseline from durable candidate,
-- resource-tag, and verification evidence, then layer identity-bound approval
-- evidence on top. Publication calls this inside its candidate transaction;
-- locking the candidate here preserves the same candidate-first ordering as
-- approval mutation and prevents a concurrent decision/publish race.
CREATE OR REPLACE FUNCTION public.evaluate_candidate_readiness(
  p_candidate_id text
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate_row record;
  blocker_values text[] := '{}';
  is_ready boolean := false;
  has_required_fields boolean := false;
  has_required_tags boolean := false;
  tags_confirmed boolean := true;
  meets_score boolean := true;
  has_approval boolean := false;
  has_quarantine_source boolean := false;
  has_critical_failure boolean := false;
  has_domain_failure boolean := false;
  pending_tag_count integer := 0;
  approval_count integer := 0;
  rejection_count integer := 0;
  escalation_count integer := 0;
  category_tag_count integer := 0;
  geographic_tag_count integer := 0;
  min_overall_score integer := 60;
  min_admin_approvals integer := 2;
  min_category_tags integer := 1;
BEGIN
  SELECT candidate.candidate_id,
         candidate.confidence_score,
         candidate.jurisdiction_state,
         candidate.jurisdiction_county,
         candidate.organization_name,
         candidate.service_name,
         candidate.description,
         candidate.website_url,
         candidate.phone,
         candidate.address_line1,
         candidate.address_city,
         candidate.address_region,
         candidate.address_postal_code,
         candidate.is_remote_service
  INTO candidate_row
  FROM public.extracted_candidates candidate
  WHERE candidate.candidate_id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate not found: %', p_candidate_id;
  END IF;

  SELECT criteria.min_overall_score,
         GREATEST(criteria.min_admin_approvals, 2),
         GREATEST(criteria.min_service_type_tags, 1)
  INTO min_overall_score, min_admin_approvals, min_category_tags
  FROM public.publish_criteria criteria
  WHERE criteria.is_active IS TRUE
    AND (
      criteria.jurisdiction_state IS NULL
      OR criteria.jurisdiction_state = candidate_row.jurisdiction_state
    )
    AND (
      criteria.jurisdiction_county IS NULL
      OR criteria.jurisdiction_county = candidate_row.jurisdiction_county
    )
  ORDER BY
    (criteria.jurisdiction_county IS NOT NULL) DESC,
    (criteria.jurisdiction_state IS NOT NULL) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    min_overall_score := 60;
    min_admin_approvals := 2;
    min_category_tags := 1;
  END IF;

  IF candidate_row.confidence_score < min_overall_score THEN
    meets_score := false;
    blocker_values := array_append(blocker_values, 'confidence_below_publish_threshold');
  END IF;

  has_required_fields :=
    pg_catalog.btrim(COALESCE(candidate_row.organization_name, '')) <> ''
    AND pg_catalog.btrim(COALESCE(candidate_row.service_name, '')) <> ''
    AND pg_catalog.btrim(COALESCE(candidate_row.description, '')) <> ''
    AND (
      pg_catalog.btrim(COALESCE(candidate_row.phone, '')) <> ''
      OR pg_catalog.btrim(COALESCE(candidate_row.website_url, '')) <> ''
    )
    AND (
      COALESCE(candidate_row.is_remote_service, false) IS TRUE
      OR (
        pg_catalog.btrim(COALESCE(candidate_row.address_line1, '')) <> ''
        AND pg_catalog.btrim(COALESCE(candidate_row.address_city, '')) <> ''
        AND pg_catalog.btrim(COALESCE(candidate_row.address_region, '')) <> ''
        AND pg_catalog.btrim(COALESCE(candidate_row.address_postal_code, '')) <> ''
      )
    );
  IF NOT has_required_fields THEN
    blocker_values := array_append(blocker_values, 'missing_required_fields');
  END IF;

  SELECT
    (count(*) FILTER (
      WHERE tag.tag_type = 'category'
        AND NOT EXISTS (
          SELECT 1
          FROM public.tag_confirmation_queue rejected_confirmation
          WHERE rejected_confirmation.resource_tag_id = tag.id
            AND rejected_confirmation.candidate_id = p_candidate_id
            AND rejected_confirmation.status IN ('rejected', 'skipped')
        )
    ))::integer,
    (count(*) FILTER (
      WHERE tag.tag_type = 'geographic'
        AND NOT EXISTS (
          SELECT 1
          FROM public.tag_confirmation_queue rejected_confirmation
          WHERE rejected_confirmation.resource_tag_id = tag.id
            AND rejected_confirmation.candidate_id = p_candidate_id
            AND rejected_confirmation.status IN ('rejected', 'skipped')
        )
    ))::integer,
    COALESCE(
      bool_or(
        tag.tag_type = 'source_quality'
        AND tag.tag_value = 'quarantine_source'
        AND NOT EXISTS (
          SELECT 1
          FROM public.tag_confirmation_queue rejected_confirmation
          WHERE rejected_confirmation.resource_tag_id = tag.id
            AND rejected_confirmation.candidate_id = p_candidate_id
            AND rejected_confirmation.status IN ('rejected', 'skipped')
        )
      ),
      false
    )
  INTO category_tag_count, geographic_tag_count, has_quarantine_source
  FROM public.resource_tags tag
  WHERE tag.target_id = p_candidate_id
    AND tag.target_type = 'candidate';

  has_required_tags :=
    category_tag_count >= min_category_tags
    AND geographic_tag_count >= 1;
  IF NOT has_required_tags THEN
    blocker_values := array_append(blocker_values, 'missing_required_tags');
  END IF;

  SELECT count(*)::integer
  INTO pending_tag_count
  FROM public.tag_confirmation_queue confirmation
  WHERE confirmation.candidate_id = p_candidate_id
    AND confirmation.status = 'pending';

  IF pending_tag_count > 0 THEN
    tags_confirmed := false;
    blocker_values := array_append(blocker_values, 'pending_tag_confirmation');
  END IF;

  SELECT
    COALESCE(
      bool_or(check_row.severity = 'critical' AND check_row.status = 'fail'),
      false
    ),
    COALESCE(
      bool_or(
        check_row.check_type = 'domain_allowlist'
        AND check_row.status = 'fail'
      ),
      false
    )
  INTO has_critical_failure, has_domain_failure
  FROM public.verification_checks check_row
  WHERE check_row.candidate_id = p_candidate_id;

  IF has_quarantine_source THEN
    blocker_values := array_append(blocker_values, 'quarantine_source');
  END IF;
  IF has_critical_failure THEN
    blocker_values := array_append(blocker_values, 'critical_verification_failure');
  END IF;
  IF has_domain_failure THEN
    blocker_values := array_append(blocker_values, 'domain_allowlist_failed');
  END IF;

  SELECT count(DISTINCT CASE
           WHEN assignment.outcome = 'verified'
             THEN assignment.decision_reviewer_profile_id
         END)::integer,
         count(DISTINCT CASE
           WHEN assignment.outcome = 'rejected'
             THEN assignment.decision_reviewer_profile_id
         END)::integer,
         count(DISTINCT CASE
           WHEN assignment.outcome = 'escalated'
             THEN assignment.decision_reviewer_profile_id
         END)::integer
  INTO approval_count, rejection_count, escalation_count
  FROM public.candidate_admin_assignments assignment
  WHERE assignment.candidate_id = p_candidate_id
    AND assignment.status = 'completed';

  IF approval_count >= min_admin_approvals
     AND rejection_count = 0
     AND escalation_count = 0 THEN
    has_approval := true;
  ELSE
    IF approval_count < min_admin_approvals THEN
      blocker_values := array_append(
        blocker_values,
        format(
          'Need %s admin approvals, have %s',
          min_admin_approvals,
          approval_count
        )
      );
    END IF;
    IF rejection_count > 0 THEN
      blocker_values := array_append(blocker_values, 'candidate_rejected');
    END IF;
    IF escalation_count > 0 THEN
      blocker_values := array_append(blocker_values, 'candidate_escalated');
    END IF;
  END IF;

  is_ready :=
    has_required_fields
    AND has_required_tags
    AND tags_confirmed
    AND meets_score
    AND has_approval
    AND NOT has_quarantine_source
    AND NOT has_critical_failure
    AND NOT has_domain_failure
    AND rejection_count = 0
    AND escalation_count = 0;

  INSERT INTO public.candidate_readiness (
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
    is_ready,
    has_required_fields,
    has_required_tags,
    tags_confirmed,
    meets_score,
    has_approval,
    pending_tag_count,
    approval_count,
    to_jsonb(blocker_values),
    NOW()
  )
  ON CONFLICT (candidate_id) DO UPDATE
  SET is_ready = EXCLUDED.is_ready,
      has_required_fields = EXCLUDED.has_required_fields,
      has_required_tags = EXCLUDED.has_required_tags,
      tags_confirmed = EXCLUDED.tags_confirmed,
      meets_score_threshold = EXCLUDED.meets_score_threshold,
      has_admin_approval = EXCLUDED.has_admin_approval,
      pending_tag_count = EXCLUDED.pending_tag_count,
      admin_approval_count = EXCLUDED.admin_approval_count,
      blockers = EXCLUDED.blockers,
      last_evaluated_at = EXCLUDED.last_evaluated_at;

  RETURN is_ready;
END;
$$;

-- The deployed dual-approval service records these events. Extend the audit
-- contract in the same activation transaction as the evidence trigger.
ALTER TABLE public.ingestion_audit_events
  DROP CONSTRAINT IF EXISTS ingestion_audit_events_event_type_check;
ALTER TABLE public.ingestion_audit_events
  ADD CONSTRAINT ingestion_audit_events_event_type_check
  CHECK (
    event_type IN (
      'created',
      'status_changed',
      'assigned',
      'unassigned',
      'score_updated',
      'field_edited',
      'tag_added',
      'tag_removed',
      'escalated',
      'published',
      'archived',
      'reverified',
      'candidate.located',
      'evidence.fetched',
      'extract.completed',
      'feed.poll_started',
      'feed.poll_completed',
      'normalize.failed',
      'verify.completed',
      'review.assigned',
      'review.status_changed',
      'publish.approved',
      'publish.rejected',
      'reverify.completed',
      'approval.claimed',
      'approval.decided'
    )
  );

REVOKE ALL ON FUNCTION oran_internal.enforce_candidate_revision_lineage()
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION oran_internal.protect_completed_candidate_approval()
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION oran_internal.assign_candidate_reviewers(text, integer)
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION oran_internal.list_undercovered_candidate_reviews(integer, integer)
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION oran_internal.escalate_candidate_for_review(text)
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
REVOKE ALL ON FUNCTION public.evaluate_candidate_readiness(text)
  FROM PUBLIC, oran_runtime, oran_backend_runtime;
GRANT EXECUTE ON FUNCTION oran_internal.assign_candidate_reviewers(text, integer)
  TO oran_backend_runtime;
GRANT EXECUTE ON FUNCTION oran_internal.list_undercovered_candidate_reviews(integer, integer)
  TO oran_backend_runtime;
GRANT EXECUTE ON FUNCTION oran_internal.escalate_candidate_for_review(text)
  TO oran_backend_runtime;
GRANT EXECUTE ON FUNCTION public.evaluate_candidate_readiness(text)
  TO oran_backend_runtime;

COMMENT ON COLUMN public.extracted_candidates.revision_of_candidate_id IS
  'Immediate immutable parent candidate ID. Terminal rows are never rewritten by re-extraction.';
COMMENT ON COLUMN public.extracted_candidates.lineage_root_candidate_id IS
  'Stable root candidate ID used to serialize and uniquely number immutable revisions.';
COMMENT ON COLUMN public.candidate_admin_assignments.decision_reviewer_profile_id IS
  'Immutable privacy-safe authorized reviewer profile captured by the completion trigger.';

COMMIT;
