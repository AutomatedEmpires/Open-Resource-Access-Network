-- 0077_candidate_revision_lineage.sql
-- Ported from the retired navigator branch's 0070 (agent/product-chat-first-
-- navigator @ 3fe2641, closed PR #73; tracked as issue #99) and renumbered
-- past main's 0076. Content unchanged apart from this header.
--
-- Immutable lineage for re-extracted candidates.
--
-- Published, verified, and archived candidate IDs are authorization evidence.
-- A later extraction must therefore append a child revision instead of
-- rewriting the terminal row in place.

BEGIN;

ALTER TABLE public.extracted_candidates
  ADD COLUMN IF NOT EXISTS revision_of_candidate_id text,
  ADD COLUMN IF NOT EXISTS lineage_root_candidate_id text,
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1;

ALTER TABLE public.candidate_admin_assignments
  ADD COLUMN IF NOT EXISTS decision_reviewer_user_id text;

-- Bind legacy completed evidence only when the reviewer is authorized at
-- migration time. Evidence that cannot pass that gate is reopened instead of
-- being grandfathered into publication authority.
UPDATE public.candidate_admin_assignments assignment
SET decision_reviewer_user_id = reviewer.user_id
FROM public.admin_review_profiles reviewer
JOIN public.user_profiles account
  ON account.user_id = reviewer.user_id
WHERE assignment.admin_profile_id = reviewer.id
  AND assignment.status = 'completed'
  AND assignment.decision_reviewer_user_id IS NULL
  AND reviewer.is_active IS TRUE
  AND COALESCE(account.account_status, 'active') = 'active'
  AND account.role IN ('community_admin', 'oran_admin');

UPDATE public.candidate_admin_assignments
SET status = 'reassigned',
    outcome = NULL,
    completed_at = NULL,
    updated_at = NOW()
WHERE status = 'completed'
  AND decision_reviewer_user_id IS NULL;

UPDATE public.extracted_candidates candidate
SET review_status = 'escalated',
    assigned_to_role = 'oran_admin',
    assigned_to_user_id = NULL,
    assigned_at = NULL,
    updated_at = NOW()
WHERE candidate.published_service_id IS NULL
  AND candidate.review_status IN ('verified', 'rejected')
  AND (
    SELECT count(DISTINCT assignment.decision_reviewer_user_id)
    FROM public.candidate_admin_assignments assignment
    WHERE assignment.candidate_id = candidate.candidate_id
      AND assignment.status = 'completed'
      AND assignment.outcome = CASE
        WHEN candidate.review_status = 'verified' THEN 'verified'
        ELSE 'rejected'
      END
  ) < 2;

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
        (status = 'completed' AND decision_reviewer_user_id IS NOT NULL)
        OR
        (status <> 'completed' AND decision_reviewer_user_id IS NULL)
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

CREATE INDEX IF NOT EXISTS idx_candidate_completed_decision_reviewer
  ON public.candidate_admin_assignments (
    candidate_id,
    outcome,
    decision_reviewer_user_id
  )
  WHERE status = 'completed';

UPDATE public.extracted_candidates
SET lineage_root_candidate_id = candidate_id
WHERE lineage_root_candidate_id IS NULL;

ALTER TABLE public.extracted_candidates
  ALTER COLUMN lineage_root_candidate_id SET NOT NULL;

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
      ON DELETE RESTRICT;
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
      ON DELETE RESTRICT;
  END IF;

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
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_extracted_candidates_revision_parent
  ON public.extracted_candidates (revision_of_candidate_id, revision_number DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_extracted_candidates_lineage_revision
  ON public.extracted_candidates (lineage_root_candidate_id, revision_number);

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
    ) THEN
      RAISE EXCEPTION 'Reviewed candidate content is immutable; append a child revision';
    END IF;
  END IF;

  IF NEW.revision_of_candidate_id IS NULL THEN
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
    RAISE EXCEPTION 'Candidate revision parent % does not exist', NEW.revision_of_candidate_id;
  END IF;
  IF NEW.lineage_root_candidate_id <> parent_row.lineage_root_candidate_id THEN
    RAISE EXCEPTION 'Candidate revision root must equal its parent root';
  END IF;
  IF NEW.revision_number <> parent_row.revision_number + 1 THEN
    RAISE EXCEPTION 'Candidate revision number must equal parent revision plus one';
  END IF;

  SELECT candidate_id, revision_of_candidate_id, lineage_root_candidate_id, revision_number
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

DROP TRIGGER IF EXISTS trg_enforce_candidate_revision_lineage
  ON public.extracted_candidates;
CREATE TRIGGER trg_enforce_candidate_revision_lineage
  BEFORE INSERT OR UPDATE ON public.extracted_candidates
  FOR EACH ROW
  EXECUTE FUNCTION oran_internal.enforce_candidate_revision_lineage();

CREATE OR REPLACE FUNCTION oran_internal.protect_completed_candidate_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, oran_internal
AS $$
DECLARE
  locked_candidate_id text;
  authorized_reviewer_user_id text;
BEGIN
  locked_candidate_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.candidate_id ELSE NEW.candidate_id END;

  -- Every approval mutation takes the candidate lock first. Publication takes
  -- the same lock before reading approval evidence, so approval and publish
  -- cannot observe or create a half-committed authorization state.
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
     AND NEW.decision_reviewer_user_id IS NOT NULL THEN
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

      SELECT reviewer.user_id
      INTO authorized_reviewer_user_id
      FROM public.admin_review_profiles reviewer
      JOIN public.user_profiles account
        ON account.user_id = reviewer.user_id
      WHERE reviewer.id = NEW.admin_profile_id
        AND reviewer.is_active IS TRUE
        AND COALESCE(account.account_status, 'active') = 'active'
        AND account.role IN ('community_admin', 'oran_admin')
      FOR SHARE OF reviewer, account;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Candidate approval completion requires an active authorized reviewer';
      END IF;
      NEW.decision_reviewer_user_id := authorized_reviewer_user_id;
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
  candidate_status text;
BEGIN
  IF p_limit < 2 OR p_limit > 10 THEN
    RAISE EXCEPTION 'Candidate reviewer limit must be between 2 and 10';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('oran:candidate-review-routing:' || p_candidate_id, 0)
  );

  SELECT review_status
  INTO candidate_status
  FROM public.extracted_candidates
  WHERE candidate_id = p_candidate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate % does not exist', p_candidate_id;
  END IF;
  IF candidate_status IN ('verified', 'rejected', 'published', 'archived') THEN
    RETURN 0;
  END IF;

  SELECT count(*)::integer
  INTO existing_count
  FROM public.candidate_admin_assignments
  WHERE candidate_id = p_candidate_id
    AND status IN ('pending', 'claimed', 'completed');

  FOR reviewer_row IN
    SELECT reviewer.id
    FROM public.admin_review_profiles reviewer
    JOIN public.user_profiles account
      ON account.user_id = reviewer.user_id
     AND COALESCE(account.account_status, 'active') = 'active'
     AND account.role IN ('community_admin', 'oran_admin')
    WHERE reviewer.is_active IS TRUE
      AND reviewer.is_accepting_new IS TRUE
      AND reviewer.pending_count < reviewer.max_pending
      AND reviewer.in_review_count < reviewer.max_in_review
      AND NOT EXISTS (
        SELECT 1
        FROM public.candidate_admin_assignments existing_assignment
        WHERE existing_assignment.candidate_id = p_candidate_id
          AND existing_assignment.admin_profile_id = reviewer.id
      )
    ORDER BY reviewer.pending_count ASC,
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
      'geographic',
      existing_count + assigned_count + 1,
      'pending',
      NOW() + interval '48 hours'
    )
    ON CONFLICT (candidate_id, admin_profile_id) DO NOTHING;
    IF FOUND THEN
      assigned_count := assigned_count + 1;
    END IF;
  END LOOP;

  RETURN assigned_count;
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

REVOKE ALL ON FUNCTION oran_internal.enforce_candidate_revision_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.protect_completed_candidate_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.assign_candidate_reviewers(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.escalate_candidate_for_review(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION oran_internal.assign_candidate_reviewers(text, integer)
  TO oran_backend_runtime;
GRANT EXECUTE ON FUNCTION oran_internal.escalate_candidate_for_review(text)
  TO oran_backend_runtime;

COMMENT ON COLUMN public.extracted_candidates.revision_of_candidate_id IS
  'Immediate immutable parent candidate ID. Terminal candidate rows are never rewritten by re-extraction.';
COMMENT ON COLUMN public.extracted_candidates.revision_number IS
  'Monotonic revision number within a candidate lineage; roots are revision 1.';
-- The dual-approval service (src/services/ingestion/candidateApprovals.ts)
-- records 'approval.claimed' and 'approval.decided' audit events. Extend the
-- ingestion audit contract in the SAME transaction as the evidence schema so
-- the already-deployed (probe-gated) app half can never outrun the CHECK.
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

COMMENT ON COLUMN public.extracted_candidates.lineage_root_candidate_id IS
  'Stable root candidate ID used to serialize and uniquely number immutable revisions.';

COMMIT;
