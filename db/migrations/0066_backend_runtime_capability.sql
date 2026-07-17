-- 0066_backend_runtime_capability.sql
--
-- Supavisor transaction pooling does not preserve startup `role=` options.
-- Production therefore authenticates directly as this dedicated backend login.
-- Its password is deliberately unset on first creation and is provisioned out
-- of band; rerunning this migration never changes an existing password.

BEGIN;

DO $roles$
DECLARE
  v_role RECORD;
BEGIN
  SELECT * INTO v_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'oran_backend_runtime';

  IF NOT FOUND THEN
    EXECUTE 'CREATE ROLE oran_backend_runtime '
      || 'LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE '
      || 'NOINHERIT NOREPLICATION BYPASSRLS CONNECTION LIMIT 20';
  ELSE
    IF v_role.rolsuper THEN
      RAISE EXCEPTION 'oran_backend_runtime must never be superuser';
    END IF;
    -- Intentionally omit PASSWORD: an already-provisioned secret survives.
    EXECUTE 'ALTER ROLE oran_backend_runtime '
      || 'LOGIN NOCREATEDB NOCREATEROLE NOINHERIT '
      || 'NOREPLICATION BYPASSRLS CONNECTION LIMIT 20';
  END IF;

  SELECT * INTO v_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'oran_runtime';

  IF NOT FOUND THEN
    -- Greenfield installs have nothing to roll back to. Reserve the legacy
    -- name as a locked role so the cleanup below remains deterministic.
    EXECUTE 'CREATE ROLE oran_runtime '
      || 'NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE '
      || 'NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0';
  ELSE
    IF v_role.rolsuper THEN
      RAISE EXCEPTION 'legacy oran_runtime must not be superuser';
    END IF;
    -- Preserve LOGIN/NOLOGIN and PASSWORD so an existing credential remains an
    -- intentional, privilege-free rollback lever.
    EXECUTE 'ALTER ROLE oran_runtime '
      || 'NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION '
      || 'NOBYPASSRLS CONNECTION LIMIT 20';
  END IF;
END
$roles$;

-- A role-level setting survives transaction-pooler checkout and prevents
-- caller-controlled schemas from shadowing built-ins or application objects.
ALTER ROLE oran_backend_runtime SET search_path TO pg_catalog, public;
ALTER ROLE oran_backend_runtime SET statement_timeout TO '30s';
ALTER ROLE oran_backend_runtime SET lock_timeout TO '5s';
ALTER ROLE oran_backend_runtime SET idle_in_transaction_session_timeout TO '30s';

-- Reset both roles before applying the reviewed operation manifest. The legacy
-- login receives no direct application-object grants.
REVOKE ALL PRIVILEGES ON SCHEMA public, oran_internal
  FROM oran_runtime, oran_backend_runtime;

-- Prevent inherited PUBLIC ACLs from bypassing the operation manifest. Do not
-- modify extension-owned relations such as PostGIS spatial_ref_sys.
DO $revoke_public_relations$
DECLARE
  v_relation RECORD;
BEGIN
  FOR v_relation IN
    SELECT c.oid::pg_catalog.regclass AS qualified_name, c.relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'oran_internal')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    IF v_relation.relkind = 'S' THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE %s '
          || 'FROM oran_runtime, oran_backend_runtime, PUBLIC',
        v_relation.qualified_name
      );
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE %s '
          || 'FROM oran_runtime, oran_backend_runtime, PUBLIC',
        v_relation.qualified_name
      );
    END IF;
  END LOOP;
END
$revoke_public_relations$;

-- The legacy login must not be able to assume the backend identity.
DO $revoke_legacy_membership$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    WHERE m.roleid = 'oran_backend_runtime'::pg_catalog.regrole
      AND m.member = 'oran_runtime'::pg_catalog.regrole
  ) THEN
    REVOKE oran_backend_runtime FROM oran_runtime;
  END IF;
END
$revoke_legacy_membership$;

GRANT USAGE ON SCHEMA public, oran_internal TO oran_backend_runtime;

-- SELECT: public discovery/publication authority, Clerk authorization lookup,
-- seeker profile/saved data, host/community/admin workflows, and ingestion.
GRANT SELECT ON TABLE
  public.accessibility_for_disabilities,
  public.addresses,
  public.admin_review_profiles,
  public.admin_routing_rules,
  public.audit_logs,
  public.candidate_admin_assignments,
  public.candidate_readiness,
  public.canonical_concepts,
  public.canonical_locations,
  public.canonical_organizations,
  public.canonical_provenance,
  public.canonical_service_locations,
  public.canonical_services,
  public.chat_sessions,
  public.confidence_regressions,
  public.confidence_scores,
  public.concept_tag_derivations,
  public.contacts,
  public.content_templates,
  public.coverage_zones,
  public.discovered_links,
  public.eligibility,
  public.entity_cluster_members,
  public.entity_clusters,
  public.entity_identifiers,
  public.evidence_snapshots,
  public.extracted_candidates,
  public.feature_flags,
  public.feed_subscriptions,
  public.form_instances,
  public.form_templates,
  public.hsds_export_snapshots,
  public.ingestion_audit_events,
  public.ingestion_jobs,
  public.languages,
  public.lifecycle_events,
  public.llm_suggestions,
  public.locations,
  public.notification_events,
  public.notification_preferences,
  public.organization_members,
  public.organizations,
  public.ownership_transfers,
  public.pending_scope_grants,
  public.phones,
  public.platform_roles,
  public.platform_scopes,
  public.publish_criteria,
  public.required_documents,
  public.resolution_candidates,
  public.resolution_decisions,
  public.resource_tags,
  public.role_scope_assignments,
  public.saved_collection_services,
  public.saved_collections,
  public.saved_services,
  public.schedules,
  public.scope_audit_log,
  public.seeker_feedback,
  public.seeker_profiles,
  public.service_areas,
  public.service_at_location,
  public.service_attributes,
  public.service_taxonomy,
  public.services,
  public.source_feed_states,
  public.source_feeds,
  public.source_records,
  public.source_systems,
  public.submission_slas,
  public.submission_transitions,
  public.submissions,
  public.tag_confirmation_queue,
  public.taxonomy_crosswalks,
  public.taxonomy_registries,
  public.taxonomy_terms,
  public.taxonomy_terms_ext,
  public.template_usage_events,
  public.triage_scores,
  public.user_profiles,
  public.user_scope_grants,
  public.verification_checks,
  public.verified_service_links
TO oran_backend_runtime;

-- INSERT: only tables written by active profile/host/community/admin/ingestion
-- workflows. UUID defaults mean no public sequence privilege is required.
GRANT INSERT ON TABLE
  public.accessibility_for_disabilities,
  public.addresses,
  public.admin_review_profiles,
  public.admin_routing_rules,
  public.audit_logs,
  public.candidate_admin_assignments,
  public.candidate_readiness,
  public.canonical_concepts,
  public.canonical_locations,
  public.canonical_organizations,
  public.canonical_provenance,
  public.canonical_service_locations,
  public.canonical_services,
  public.chat_sessions,
  public.confidence_regressions,
  public.confidence_scores,
  public.concept_tag_derivations,
  public.content_templates,
  public.coverage_zones,
  public.discovered_links,
  public.eligibility,
  public.entity_cluster_members,
  public.entity_clusters,
  public.entity_identifiers,
  public.evidence_snapshots,
  public.extracted_candidates,
  public.feature_flags,
  public.feed_subscriptions,
  public.form_instances,
  public.form_templates,
  public.hsds_export_snapshots,
  public.ingestion_audit_events,
  public.ingestion_jobs,
  public.languages,
  public.lifecycle_events,
  public.llm_suggestions,
  public.locations,
  public.notification_events,
  public.notification_preferences,
  public.organization_members,
  public.organizations,
  public.ownership_transfers,
  public.pending_scope_grants,
  public.phones,
  public.platform_scopes,
  public.publish_criteria,
  public.required_documents,
  public.resolution_candidates,
  public.resolution_decisions,
  public.resource_tags,
  public.saved_collection_services,
  public.saved_collections,
  public.saved_services,
  public.schedules,
  public.scope_audit_log,
  public.seeker_feedback,
  public.seeker_profiles,
  public.service_areas,
  public.service_at_location,
  public.service_attributes,
  public.service_taxonomy,
  public.services,
  public.source_feed_states,
  public.source_feeds,
  public.source_record_taxonomy,
  public.source_records,
  public.source_systems,
  public.submission_transitions,
  public.submissions,
  public.tag_confirmation_queue,
  public.taxonomy_crosswalks,
  public.taxonomy_registries,
  public.taxonomy_terms,
  public.taxonomy_terms_ext,
  public.template_usage_events,
  public.triage_scores,
  public.user_profiles,
  public.user_scope_grants,
  public.verification_checks,
  public.verified_service_links
TO oran_backend_runtime;

-- UPDATE includes explicit statements and INSERT ... ON CONFLICT DO UPDATE.
GRANT UPDATE ON TABLE
  public.addresses,
  public.admin_review_profiles,
  public.admin_routing_rules,
  public.audit_logs,
  public.candidate_admin_assignments,
  public.candidate_readiness,
  public.canonical_concepts,
  public.canonical_locations,
  public.canonical_organizations,
  public.canonical_provenance,
  public.canonical_services,
  public.chat_sessions,
  public.confidence_scores,
  public.content_templates,
  public.coverage_zones,
  public.entity_clusters,
  public.entity_identifiers,
  public.extracted_candidates,
  public.feature_flags,
  public.form_instances,
  public.form_templates,
  public.hsds_export_snapshots,
  public.ingestion_jobs,
  public.llm_suggestions,
  public.locations,
  public.notification_events,
  public.notification_preferences,
  public.organization_members,
  public.organizations,
  public.ownership_transfers,
  public.pending_scope_grants,
  public.publish_criteria,
  public.resolution_candidates,
  public.saved_collections,
  public.seeker_feedback,
  public.seeker_profiles,
  public.services,
  public.source_feed_states,
  public.source_feeds,
  public.source_records,
  public.source_systems,
  public.submission_transitions,
  public.submissions,
  public.tag_confirmation_queue,
  public.taxonomy_registries,
  public.triage_scores,
  public.user_profiles,
  public.user_scope_grants,
  public.verification_checks,
  public.verified_service_links
TO oran_backend_runtime;

GRANT DELETE ON TABLE
  public.addresses,
  public.canonical_service_locations,
  public.confidence_scores,
  public.content_templates,
  public.coverage_zones,
  public.eligibility,
  public.entity_cluster_members,
  public.entity_identifiers,
  public.form_templates,
  public.languages,
  public.locations,
  public.notification_events,
  public.notification_preferences,
  public.organization_members,
  public.phones,
  public.required_documents,
  public.resource_tags,
  public.saved_collection_services,
  public.saved_collections,
  public.saved_services,
  public.schedules,
  public.seeker_profiles,
  public.service_areas,
  public.service_at_location,
  public.service_taxonomy,
  public.user_profiles,
  public.verification_checks
TO oran_backend_runtime;

-- Freshness is private but uses direct, audited DML. Chat tables remain wholly
-- private and are reachable only through the three named functions below.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE oran_internal.resource_freshness_findings
  TO oran_backend_runtime;

-- Two compatibility relations are referenced by current routes but predate the
-- committed schema. Grant only when an environment actually contains them.
DO $optional_relations$
BEGIN
  IF pg_catalog.to_regclass('public.org_members') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON TABLE public.org_members TO oran_backend_runtime';
  END IF;
  IF pg_catalog.to_regclass('public.organization_settings') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.organization_settings '
      || 'TO oran_backend_runtime';
  END IF;
END
$optional_relations$;

-- Remove the default PUBLIC execution path from every ORAN-owned, non-extension
-- function. Extension functions retain their extension-managed privileges.
DO $revoke_oran_functions$
DECLARE
  v_function pg_catalog.regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::pg_catalog.regprocedure
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
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s '
        || 'FROM oran_runtime, oran_backend_runtime, PUBLIC',
      v_function
    );
  END LOOP;
END
$revoke_oran_functions$;

GRANT EXECUTE ON FUNCTION
  oran_internal.check_chat_quota(text, text, integer),
  oran_internal.reserve_chat_request(
    uuid, text, text, text, integer, integer, integer, integer
  ),
  oran_internal.finalize_chat_request(uuid, boolean)
TO oran_backend_runtime;

-- Fail loudly if either role has accumulated ownership or role membership.
-- Ownership or inheritance would bypass the direct-login ACL manifest.
DO $assert_boundary$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    WHERE c.relowner IN (
      'oran_runtime'::pg_catalog.regrole,
      'oran_backend_runtime'::pg_catalog.regrole
    )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.proowner IN (
      'oran_runtime'::pg_catalog.regrole,
      'oran_backend_runtime'::pg_catalog.regrole
    )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n
    WHERE n.nspowner IN (
      'oran_runtime'::pg_catalog.regrole,
      'oran_backend_runtime'::pg_catalog.regrole
    )
  ) THEN
    RAISE EXCEPTION 'ORAN runtime roles must own no database objects';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    WHERE m.member IN (
      'oran_runtime'::pg_catalog.regrole,
      'oran_backend_runtime'::pg_catalog.regrole
    )
  ) THEN
    RAISE EXCEPTION 'ORAN runtime roles must not inherit or assume other roles';
  END IF;
END
$assert_boundary$;

COMMENT ON ROLE oran_backend_runtime IS
  'Dedicated ORAN server login; direct explicit ACL manifest and RLS bypass for trusted backend traffic.';
COMMENT ON ROLE oran_runtime IS
  'Legacy ORAN login; retained only for rollback and granted no direct application-object privileges.';

COMMIT;
