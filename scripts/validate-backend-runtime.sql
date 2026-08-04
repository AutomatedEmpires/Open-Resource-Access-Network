\set ON_ERROR_STOP on

-- Read-only release gate for 0066_backend_runtime_capability.sql.
BEGIN TRANSACTION READ ONLY;

DO $validate_backend_runtime$
DECLARE
  v_backend_oid oid;
  v_legacy_oid oid;
  v_role RECORD;
  v_relation RECORD;
  v_function RECORD;
  v_privilege text;
  v_qualified_name text;
  v_expected boolean;
  v_actual boolean;
  v_public_execute boolean;
  v_select text[] := ARRAY[
    'public.accessibility_for_disabilities',
    'public.addresses',
    'public.admin_review_profiles',
    'public.admin_routing_rules',
    'public.audit_logs',
    'public.candidate_admin_assignments',
    'public.candidate_readiness',
    'public.canonical_concepts',
    'public.canonical_locations',
    'public.canonical_organizations',
    'public.canonical_provenance',
    'public.canonical_service_locations',
    'public.canonical_services',
    'public.chat_sessions',
    'public.confidence_regressions',
    'public.confidence_scores',
    'public.concept_tag_derivations',
    'public.contacts',
    'public.content_templates',
    'public.coverage_zones',
    'public.discovered_links',
    'public.eligibility',
    'public.entity_cluster_members',
    'public.entity_clusters',
    'public.entity_identifiers',
    'public.evidence_snapshots',
    'public.extracted_candidates',
    'public.feature_flags',
    'public.feed_subscriptions',
    'public.form_instances',
    'public.form_templates',
    'public.hsds_export_snapshots',
    'public.ingestion_audit_events',
    'public.ingestion_jobs',
    'public.languages',
    'public.lifecycle_events',
    'public.llm_suggestions',
    'public.locations',
    'public.notification_events',
    'public.notification_preferences',
    'public.organization_members',
    'public.organizations',
    'public.ownership_transfers',
    'public.pending_scope_grants',
    'public.phones',
    'public.platform_roles',
    'public.platform_scopes',
    'public.publish_criteria',
    'public.required_documents',
    'public.resolution_candidates',
    'public.resolution_decisions',
    'public.resource_tags',
    'public.role_scope_assignments',
    'public.saved_collection_services',
    'public.saved_collections',
    'public.saved_services',
    'public.schedules',
    'public.scope_audit_log',
    'public.seeker_feedback',
    'public.seeker_profiles',
    'public.service_areas',
    'public.service_at_location',
    'public.service_attributes',
    'public.service_taxonomy',
    'public.services',
    'public.source_feed_states',
    'public.source_feeds',
    'public.source_records',
    'public.source_systems',
    'public.submission_slas',
    'public.submission_transitions',
    'public.submissions',
    'public.tag_confirmation_queue',
    'public.taxonomy_crosswalks',
    'public.taxonomy_registries',
    'public.taxonomy_terms',
    'public.taxonomy_terms_ext',
    'public.template_usage_events',
    'public.triage_scores',
    'public.user_profiles',
    'public.user_scope_grants',
    'public.verification_checks',
    'public.verified_service_links',
    'oran_internal.resource_freshness_findings'
  ];
  v_insert text[] := ARRAY[
    'public.accessibility_for_disabilities',
    'public.addresses',
    'public.admin_review_profiles',
    'public.admin_routing_rules',
    'public.audit_logs',
    'public.candidate_admin_assignments',
    'public.candidate_readiness',
    'public.canonical_concepts',
    'public.canonical_locations',
    'public.canonical_organizations',
    'public.canonical_provenance',
    'public.canonical_service_locations',
    'public.canonical_services',
    'public.chat_sessions',
    'public.confidence_regressions',
    'public.confidence_scores',
    'public.concept_tag_derivations',
    'public.content_templates',
    'public.coverage_zones',
    'public.discovered_links',
    'public.eligibility',
    'public.entity_cluster_members',
    'public.entity_clusters',
    'public.entity_identifiers',
    'public.evidence_snapshots',
    'public.extracted_candidates',
    'public.feature_flags',
    'public.feed_subscriptions',
    'public.form_instances',
    'public.form_templates',
    'public.hsds_export_snapshots',
    'public.ingestion_audit_events',
    'public.ingestion_jobs',
    'public.languages',
    'public.lifecycle_events',
    'public.llm_suggestions',
    'public.locations',
    'public.notification_events',
    'public.notification_preferences',
    'public.organization_members',
    'public.organizations',
    'public.ownership_transfers',
    'public.pending_scope_grants',
    'public.phones',
    'public.platform_scopes',
    'public.publish_criteria',
    'public.required_documents',
    'public.resolution_candidates',
    'public.resolution_decisions',
    'public.resource_tags',
    'public.saved_collection_services',
    'public.saved_collections',
    'public.saved_services',
    'public.schedules',
    'public.scope_audit_log',
    'public.seeker_feedback',
    'public.seeker_profiles',
    'public.service_areas',
    'public.service_at_location',
    'public.service_attributes',
    'public.service_taxonomy',
    'public.services',
    'public.source_feed_states',
    'public.source_feeds',
    'public.source_record_taxonomy',
    'public.source_records',
    'public.source_systems',
    'public.submission_transitions',
    'public.submissions',
    'public.tag_confirmation_queue',
    'public.taxonomy_crosswalks',
    'public.taxonomy_registries',
    'public.taxonomy_terms',
    'public.taxonomy_terms_ext',
    'public.template_usage_events',
    'public.triage_scores',
    'public.user_profiles',
    'public.user_scope_grants',
    'public.verification_checks',
    'public.verified_service_links',
    'oran_internal.resource_freshness_findings'
  ];
  v_update text[] := ARRAY[
    'public.addresses',
    'public.admin_review_profiles',
    'public.admin_routing_rules',
    'public.audit_logs',
    'public.candidate_admin_assignments',
    'public.candidate_readiness',
    'public.canonical_concepts',
    'public.canonical_locations',
    'public.canonical_organizations',
    'public.canonical_provenance',
    'public.canonical_services',
    'public.chat_sessions',
    'public.confidence_scores',
    'public.content_templates',
    'public.coverage_zones',
    'public.entity_clusters',
    'public.entity_identifiers',
    'public.extracted_candidates',
    'public.feature_flags',
    'public.form_instances',
    'public.form_templates',
    'public.hsds_export_snapshots',
    'public.ingestion_jobs',
    'public.llm_suggestions',
    'public.locations',
    'public.notification_events',
    'public.notification_preferences',
    'public.organization_members',
    'public.organizations',
    'public.ownership_transfers',
    'public.pending_scope_grants',
    'public.publish_criteria',
    'public.resolution_candidates',
    'public.saved_collections',
    'public.seeker_feedback',
    'public.seeker_profiles',
    'public.services',
    'public.source_feed_states',
    'public.source_feeds',
    'public.source_records',
    'public.source_systems',
    'public.submission_transitions',
    'public.submissions',
    'public.tag_confirmation_queue',
    'public.taxonomy_registries',
    'public.triage_scores',
    'public.user_profiles',
    'public.user_scope_grants',
    'public.verification_checks',
    'public.verified_service_links',
    'oran_internal.resource_freshness_findings'
  ];
  v_delete text[] := ARRAY[
    'public.addresses',
    'public.canonical_service_locations',
    'public.confidence_scores',
    'public.content_templates',
    'public.coverage_zones',
    'public.eligibility',
    'public.entity_cluster_members',
    'public.entity_identifiers',
    'public.form_templates',
    'public.languages',
    'public.locations',
    'public.notification_events',
    'public.notification_preferences',
    'public.organization_members',
    'public.phones',
    'public.required_documents',
    'public.resource_tags',
    'public.saved_collection_services',
    'public.saved_collections',
    'public.saved_services',
    'public.schedules',
    'public.seeker_profiles',
    'public.service_areas',
    'public.service_at_location',
    'public.service_taxonomy',
    'public.user_profiles',
    'public.verification_checks',
    'oran_internal.resource_freshness_findings'
  ];
  v_allowed_functions oid[] := ARRAY[
    'oran_internal.check_chat_quota(text,text,integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.reserve_chat_request(uuid,text,text,text,integer,integer,integer,integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.finalize_chat_request(uuid,boolean)'::pg_catalog.regprocedure::oid,
    'oran_internal.consume_shared_rate_limit(text,integer,integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.is_account_erased(text)'::pg_catalog.regprocedure::oid,
    'oran_internal.queue_account_erasure(text,text,text,uuid)'::pg_catalog.regprocedure::oid,
    'oran_internal.claim_account_erasure_requests(integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.release_account_erasure_lease(uuid)'::pg_catalog.regprocedure::oid,
    'oran_internal.record_account_erasure_failure(uuid,text)'::pg_catalog.regprocedure::oid,
    'oran_internal.mark_clerk_account_deleted(uuid,text,text)'::pg_catalog.regprocedure::oid,
    'oran_internal.process_account_erasure_page(uuid,integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.export_user_governance_data(text)'::pg_catalog.regprocedure::oid,
    'oran_internal.assign_candidate_reviewers(text,integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.list_undercovered_candidate_reviews(integer,integer)'::pg_catalog.regprocedure::oid,
    'oran_internal.escalate_candidate_for_review(text)'::pg_catalog.regprocedure::oid,
    'public.evaluate_candidate_readiness(text)'::pg_catalog.regprocedure::oid
  ];
BEGIN
  IF session_user::text <> 'oran_backend_runtime'
     OR current_user::text <> 'oran_backend_runtime' THEN
    RAISE EXCEPTION
      'connect as oran_backend_runtime (session_user=%, current_user=%)',
      session_user, current_user;
  END IF;

  SELECT oid INTO STRICT v_backend_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'oran_backend_runtime';

  SELECT oid INTO STRICT v_legacy_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'oran_runtime';

  SELECT * INTO STRICT v_role
  FROM pg_catalog.pg_roles
  WHERE oid = v_backend_oid;

  IF NOT v_role.rolcanlogin
     OR v_role.rolsuper
     OR v_role.rolcreatedb
     OR v_role.rolcreaterole
     OR v_role.rolinherit
     OR v_role.rolreplication
     OR NOT v_role.rolbypassrls
     OR v_role.rolconnlimit < 1
     OR v_role.rolconnlimit > 20 THEN
    RAISE EXCEPTION 'oran_backend_runtime role attributes drifted';
  END IF;

  IF NOT COALESCE(v_role.rolconfig, ARRAY[]::text[]) @> ARRAY[
    'search_path=pg_catalog, public',
    'statement_timeout=30s',
    'lock_timeout=5s',
    'idle_in_transaction_session_timeout=30s'
  ]::text[] THEN
    RAISE EXCEPTION 'oran_backend_runtime role defaults drifted';
  END IF;

  IF pg_catalog.current_setting('search_path') <> 'pg_catalog, public'
     OR pg_catalog.current_setting('statement_timeout') <> '30s'
     OR pg_catalog.current_setting('lock_timeout') <> '5s'
     OR pg_catalog.current_setting('idle_in_transaction_session_timeout') <> '30s' THEN
    RAISE EXCEPTION 'effective backend session defaults drifted';
  END IF;

  SELECT * INTO STRICT v_role
  FROM pg_catalog.pg_roles
  WHERE oid = v_legacy_oid;

  IF v_role.rolsuper
     OR v_role.rolcreatedb
     OR v_role.rolcreaterole
     OR v_role.rolinherit
     OR v_role.rolreplication
     OR v_role.rolbypassrls
     OR v_role.rolconnlimit < 0
     OR v_role.rolconnlimit > 20 THEN
    RAISE EXCEPTION 'legacy oran_runtime role attributes drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    WHERE m.member IN (v_backend_oid, v_legacy_oid)
  ) THEN
    RAISE EXCEPTION 'runtime role membership violates the direct-login boundary';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class WHERE relowner IN (v_backend_oid, v_legacy_oid)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc WHERE proowner IN (v_backend_oid, v_legacy_oid)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner IN (v_backend_oid, v_legacy_oid)
  ) THEN
    RAISE EXCEPTION 'runtime roles must own no relations, functions, or schemas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
    WHERE acl.grantee = v_legacy_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
    WHERE acl.grantee = v_legacy_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
    WHERE acl.grantee = v_legacy_oid
  ) THEN
    RAISE EXCEPTION 'legacy oran_runtime retains direct object privileges';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
    'oran_backend_runtime', 'public', 'USAGE'
  ) OR NOT pg_catalog.has_schema_privilege(
    'oran_backend_runtime', 'oran_internal', 'USAGE'
  ) OR pg_catalog.has_schema_privilege(
    'oran_backend_runtime', 'public', 'CREATE'
  ) OR pg_catalog.has_schema_privilege(
    'oran_backend_runtime', 'oran_internal', 'CREATE'
  ) THEN
    RAISE EXCEPTION 'backend schema privileges drifted';
  END IF;

  IF pg_catalog.has_database_privilege(
    current_user, pg_catalog.current_database(), 'CREATE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname <> 'pg_temp'
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND pg_catalog.has_schema_privilege(
        current_user, n.oid, 'CREATE'
      )
  ) THEN
    RAISE EXCEPTION 'backend has persistent DDL capability';
  END IF;

  IF pg_catalog.to_regclass('public.org_members') IS NOT NULL THEN
    v_select := pg_catalog.array_append(v_select, 'public.org_members');
  END IF;
  IF pg_catalog.to_regclass('public.organization_settings') IS NOT NULL THEN
    v_select := pg_catalog.array_append(v_select, 'public.organization_settings');
    v_insert := pg_catalog.array_append(v_insert, 'public.organization_settings');
    v_update := pg_catalog.array_append(v_update, 'public.organization_settings');
  END IF;

  FOR v_relation IN
    SELECT c.oid, c.relowner, n.nspname, c.relname, c.relkind, c.relacl
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'oran_internal')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    v_qualified_name := v_relation.nspname || '.' || v_relation.relname;

    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      v_expected := CASE v_privilege
        WHEN 'SELECT' THEN v_qualified_name = ANY(v_select)
        WHEN 'INSERT' THEN v_qualified_name = ANY(v_insert)
        WHEN 'UPDATE' THEN v_qualified_name = ANY(v_update)
        WHEN 'DELETE' THEN v_qualified_name = ANY(v_delete)
      END;

      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(v_relation.relacl) acl
        WHERE acl.grantee = v_backend_oid
          AND acl.privilege_type = v_privilege
      ) INTO v_actual;

      IF v_actual IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'backend %.% privilege drift on % (expected %, found %)',
          v_qualified_name, v_privilege, v_relation.relkind, v_expected, v_actual;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(v_relation.relacl) acl
      WHERE acl.grantee = v_backend_oid
        AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) THEN
      RAISE EXCEPTION 'backend has forbidden table privilege on %', v_qualified_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend d
      WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
        AND d.objid = v_relation.oid
        AND d.deptype = 'e'
    ) AND EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          v_relation.relacl,
          pg_catalog.acldefault('r', v_relation.relowner)
        )
      ) acl
      WHERE acl.grantee = 0
        AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ) THEN
      RAISE EXCEPTION 'PUBLIC retains CRUD on ORAN relation %', v_qualified_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
    WHERE n.nspname IN ('public', 'oran_internal')
      AND c.relkind = 'S'
      AND acl.grantee IN (v_backend_oid, v_legacy_oid)
  ) THEN
    RAISE EXCEPTION 'runtime roles must have no sequence privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(c.relacl, pg_catalog.acldefault('s', c.relowner))
    ) acl
    WHERE n.nspname IN ('public', 'oran_internal')
      AND c.relkind = 'S'
      AND acl.grantee = 0
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  ) THEN
    RAISE EXCEPTION 'PUBLIC retains privileges on an ORAN sequence';
  END IF;

  FOR v_function IN
    SELECT p.oid, p.proacl, p.proowner, n.nspname, p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'oran_internal')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    v_expected := v_function.oid = ANY(v_allowed_functions);
    v_actual := pg_catalog.has_function_privilege(
      'oran_backend_runtime', v_function.oid, 'EXECUTE'
    );

    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'backend function EXECUTE drift on %.% (expected %, found %)',
        v_function.nspname, v_function.proname, v_expected, v_actual;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          v_function.proacl,
          pg_catalog.acldefault('f', v_function.proowner)
        )
      ) acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) INTO v_public_execute;

    IF pg_catalog.has_function_privilege('oran_runtime', v_function.oid, 'EXECUTE')
       OR v_public_execute THEN
      RAISE EXCEPTION 'legacy/PUBLIC can execute ORAN function %.%',
        v_function.nspname, v_function.proname;
    END IF;
  END LOOP;

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
      AND attname = 'revision_number'
      AND attnotnull
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
    RAISE EXCEPTION 'candidate revision-lineage columns are not activated';
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
      AND confdeltype = 'r'
      AND confupdtype = 'r'
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
      AND confdeltype = 'r'
      AND confupdtype = 'r'
      AND convalidated
  ) <> 2 THEN
    RAISE EXCEPTION 'candidate revision-lineage constraints are not activated';
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
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.llm_suggestions'::pg_catalog.regclass
      AND tgname = 'trg_protect_candidate_llm_suggestion_evidence'
      AND NOT tgisinternal
      AND tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'candidate revision-lineage triggers are not activated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.publish_criteria
    WHERE min_admin_approvals < 2
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ingestion_audit_events'::pg_catalog.regclass
      AND conname = 'ingestion_audit_events_event_type_check'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%approval.claimed%'
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%approval.decided%'
  ) THEN
    RAISE EXCEPTION 'candidate dual-approval workflow is not activated';
  END IF;
END
$validate_backend_runtime$;

ROLLBACK;
