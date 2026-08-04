\set ON_ERROR_STOP on

-- Owner-connection, read-only post-activation proof for migration 0078. This
-- complements validate-backend-runtime.sql: the deployment workflow owns a
-- migration connection, while the runtime identity validator is exercised by
-- the disposable PostgreSQL harness and production credential runbook.
BEGIN TRANSACTION READ ONLY;

DO $validate_candidate_lineage_activation$
DECLARE
  workflow_function oid;
  trigger_function oid;
  public_execute boolean;
  readiness_source text;
  approvals_default text;
BEGIN
  IF pg_catalog.current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'candidate-lineage activation validator must be read only';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.schema_migrations
    WHERE filename = '0078_candidate_revision_activation.sql'
  ) THEN
    RAISE EXCEPTION '0078 activation is absent from the repository ledger';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND attname = 'revision_of_candidate_id'
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND attname = 'lineage_root_candidate_id'
      AND attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND attname = 'revision_number'
      AND attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.candidate_admin_assignments'::pg_catalog.regclass
      AND attname = 'decision_reviewer_profile_id'
      AND atttypid = 'uuid'::pg_catalog.regtype
      AND NOT attisdropped
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.candidate_admin_assignments'::pg_catalog.regclass
      AND attname = 'decision_reviewer_user_id'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'candidate-lineage activation columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND conname = 'extracted_candidates_revision_number_check'
      AND contype = 'c'
      AND convalidated
  ) OR (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND conname IN (
        'extracted_candidates_revision_parent_fk',
        'extracted_candidates_lineage_root_fk'
      )
      AND contype = 'f'
      AND confupdtype = 'r'
      AND confdeltype = 'r'
      AND convalidated
  ) <> 2 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.candidate_admin_assignments'::pg_catalog.regclass
      AND conname = 'candidate_admin_assignments_decision_reviewer_check'
      AND contype = 'c'
      AND convalidated
  ) OR (
    SELECT count(*)
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.candidate_admin_assignments'::pg_catalog.regclass
      AND conname IN (
        'candidate_admin_assignments_admin_profile_id_fkey',
        'candidate_admin_assignments_decision_reviewer_profile_fk'
      )
      AND confrelid = 'public.admin_review_profiles'::pg_catalog.regclass
      AND contype = 'f'
      AND confupdtype = 'r'
      AND confdeltype = 'r'
      AND convalidated
  ) <> 2 THEN
    RAISE EXCEPTION 'candidate-lineage activation constraints are incomplete';
  END IF;

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
    RAISE EXCEPTION 'candidate-lineage unique revision index is incomplete';
  END IF;

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
  ) OR EXISTS (
    SELECT 1
    FROM public.extracted_candidates candidate
    JOIN public.extracted_candidates root
      ON root.candidate_id = candidate.lineage_root_candidate_id
    WHERE root.revision_of_candidate_id IS NOT NULL
       OR root.lineage_root_candidate_id IS DISTINCT FROM root.candidate_id
       OR root.revision_number IS DISTINCT FROM 1
  ) THEN
    RAISE EXCEPTION 'candidate-lineage semantic drift exists after activation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.candidate_admin_assignments assignment
    WHERE (
      assignment.status = 'completed'
      AND (
        assignment.decision_reviewer_profile_id IS NULL
        OR assignment.decision_reviewer_profile_id
          IS DISTINCT FROM assignment.admin_profile_id
        OR assignment.claimed_at IS NULL
        OR assignment.completed_at IS NULL
        OR assignment.outcome IS NULL
        OR assignment.outcome NOT IN ('verified', 'rejected', 'escalated')
        OR NOT EXISTS (
          SELECT 1
          FROM public.admin_review_profiles reviewer
          WHERE reviewer.id = assignment.decision_reviewer_profile_id
        )
      )
    ) OR (
      assignment.status <> 'completed'
      AND assignment.decision_reviewer_profile_id IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'candidate approval identity evidence is inconsistent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tag_confirmation_queue confirmation
    WHERE confirmation.status IN ('approved', 'modified')
      AND (
        confirmation.reviewed_by_user_id IS NULL
        OR confirmation.reviewed_at IS NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.llm_suggestions suggestion
    WHERE suggestion.status = 'accepted'
      AND (
        suggestion.reviewed_by IS NULL
        OR suggestion.reviewed_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'candidate human decision evidence is unbound';
  END IF;

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
      'pending candidate human evidence coexists with completed approval evidence';
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
    RAISE EXCEPTION 'oversight-only assignment occupies a candidate reviewer slot';
  END IF;

  IF (
    SELECT count(DISTINCT reviewer.id)
    FROM public.admin_review_profiles reviewer
    JOIN public.user_profiles account
      ON account.user_id = reviewer.user_id
    WHERE reviewer.is_active IS TRUE
      AND COALESCE(account.account_status, 'active') = 'active'
      AND account.role = 'community_admin'
  ) < 2 THEN
    RAISE EXCEPTION 'fewer than two active authorized community reviewer identities remain';
  END IF;

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
               AND reviewer.is_accepting_new IS TRUE
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
    RAISE EXCEPTION 'an open candidate lacks two independent community reviewer identities';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND tgname = 'trg_enforce_candidate_revision_lineage'
      AND NOT tgisinternal
      AND tgenabled IN ('O', 'A')
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.extracted_candidates'::pg_catalog.regclass
      AND tgname = 'trg_prepare_candidate_revision_lineage'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.candidate_admin_assignments'::pg_catalog.regclass
      AND tgname = 'trg_protect_completed_candidate_approval'
      AND NOT tgisinternal
      AND tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'candidate-lineage activation triggers are incomplete';
  END IF;

  SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
  INTO approvals_default
  FROM pg_catalog.pg_attrdef default_row
  JOIN pg_catalog.pg_attribute column_row
    ON column_row.attrelid = default_row.adrelid
   AND column_row.attnum = default_row.adnum
  WHERE default_row.adrelid = 'public.publish_criteria'::pg_catalog.regclass
    AND column_row.attname = 'min_admin_approvals';

  IF approvals_default IS DISTINCT FROM '2'
     OR EXISTS (
       SELECT 1
       FROM public.publish_criteria
       WHERE min_admin_approvals < 2
     ) THEN
    RAISE EXCEPTION 'candidate two-person publication criteria are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ingestion_audit_events'::pg_catalog.regclass
      AND conname = 'ingestion_audit_events_event_type_check'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%approval.claimed%'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%approval.decided%'
  ) THEN
    RAISE EXCEPTION 'candidate approval audit vocabulary is incomplete';
  END IF;

  SELECT function_row.prosrc
  INTO readiness_source
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid =
    'public.evaluate_candidate_readiness(text)'::pg_catalog.regprocedure;
  IF readiness_source NOT LIKE '%count(DISTINCT CASE%'
     OR readiness_source NOT LIKE '%decision_reviewer_profile_id%'
     OR readiness_source LIKE '%decision_reviewer_user_id%'
     OR readiness_source NOT LIKE '%rejection_count = 0%'
     OR readiness_source NOT LIKE '%escalation_count = 0%'
     OR readiness_source NOT LIKE '%candidate_rejected%'
     OR readiness_source NOT LIKE '%candidate_escalated%'
     OR readiness_source NOT LIKE '%missing_required_fields%'
     OR readiness_source NOT LIKE '%missing_required_tags%'
     OR readiness_source NOT LIKE '%quarantine_source%'
     OR readiness_source NOT LIKE '%critical_verification_failure%'
     OR readiness_source NOT LIKE '%domain_allowlist_failed%'
     OR readiness_source NOT LIKE '%tag.tag_type = ''category''%'
     OR readiness_source NOT LIKE '%tag.tag_type = ''geographic''%' THEN
    RAISE EXCEPTION 'identity-bound candidate readiness function is incomplete';
  END IF;

  FOREACH workflow_function IN ARRAY ARRAY[
    'oran_internal.assign_candidate_reviewers(text,integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.escalate_candidate_for_review(text)'::pg_catalog.regprocedure::oid,
    'public.evaluate_candidate_readiness(text)'::pg_catalog.regprocedure::oid
  ]
  LOOP
    IF NOT pg_catalog.has_function_privilege(
      'oran_backend_runtime', workflow_function, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'oran_runtime', workflow_function, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'candidate workflow function ACL is incomplete for %',
        workflow_function::pg_catalog.regprocedure;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc function_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) privilege
      WHERE function_row.oid = workflow_function
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) INTO public_execute;
    IF public_execute THEN
      RAISE EXCEPTION 'PUBLIC can execute candidate workflow function %',
        workflow_function::pg_catalog.regprocedure;
    END IF;
  END LOOP;

  FOREACH trigger_function IN ARRAY ARRAY[
    'oran_internal.enforce_candidate_revision_lineage()'::pg_catalog.regprocedure::oid,
    'oran_internal.protect_completed_candidate_approval()'::pg_catalog.regprocedure::oid
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      'oran_backend_runtime', trigger_function, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'oran_runtime', trigger_function, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'trigger-only candidate function is directly executable: %',
        trigger_function::pg_catalog.regprocedure;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc function_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) privilege
      WHERE function_row.oid = trigger_function
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) INTO public_execute;
    IF public_execute THEN
      RAISE EXCEPTION 'PUBLIC can execute trigger-only candidate function %',
        trigger_function::pg_catalog.regprocedure;
    END IF;
  END LOOP;
END
$validate_candidate_lineage_activation$;

ROLLBACK;
