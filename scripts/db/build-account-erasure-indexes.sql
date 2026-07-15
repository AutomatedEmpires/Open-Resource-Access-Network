-- 0073_account_erasure_indexes.sql
--
-- Online indexes for the bounded account-erasure worker. This migration is
-- intentionally non-transactional: psql applies each CREATE INDEX CONCURRENTLY
-- in its own transaction so ordinary reads and writes remain available.
-- A short lock timeout fails fast around conflicting DDL; the statement budget
-- prevents an individual build from running without bound. Re-running is safe.

\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '30min';

DO $target_check$
BEGIN
  IF pg_catalog.to_regclass('public.services') IS NULL
     OR pg_catalog.to_regclass(
       'oran_internal.account_erasure_identity_blocks'
     ) IS NULL
     OR pg_catalog.to_regrole('oran_backend_runtime') IS NULL THEN
    RAISE EXCEPTION
      'refusing account-erasure index build outside the reviewed ORAN database';
  END IF;
  IF pg_catalog.current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'account-erasure index build requires a writable session';
  END IF;
END
$target_check$;

CREATE TEMPORARY TABLE account_erasure_expected_indexes (
  index_name name PRIMARY KEY
) ON COMMIT PRESERVE ROWS;
INSERT INTO account_erasure_expected_indexes (index_name) VALUES
  ('idx_ae_accessibility_human_actors'),
  ('idx_ae_adaptations_human_actors'),
  ('idx_ae_addresses_human_actors'),
  ('idx_ae_admin_review_user'),
  ('idx_ae_attributes_human_actors'),
  ('idx_ae_audit_actor'),
  ('idx_ae_audit_after_trgm'),
  ('idx_ae_audit_before_trgm'),
  ('idx_ae_candidates_assigned'),
  ('idx_ae_candidates_checklist_trgm'),
  ('idx_ae_candidates_pack_trgm'),
  ('idx_ae_candidates_provenance_trgm'),
  ('idx_ae_candidates_published'),
  ('idx_ae_chat_lease_identity'),
  ('idx_ae_chat_rate_key'),
  ('idx_ae_chat_sessions_user'),
  ('idx_ae_chat_usage_identity'),
  ('idx_ae_contacts_human_actors'),
  ('idx_ae_coverage_human_actors'),
  ('idx_ae_crosswalks_created'),
  ('idx_ae_decisions_decided'),
  ('idx_ae_dietary_human_actors'),
  ('idx_ae_documents_human_actors'),
  ('idx_ae_eligibility_human_actors'),
  ('idx_ae_feed_state_approved'),
  ('idx_ae_flags_human_actors'),
  ('idx_ae_form_attachments_trgm'),
  ('idx_ae_form_blob_prefix_trgm'),
  ('idx_ae_form_data_trgm'),
  ('idx_ae_form_instances_recipient'),
  ('idx_ae_form_templates_human_actors'),
  ('idx_ae_freshness_evidence_trgm'),
  ('idx_ae_freshness_holder'),
  ('idx_ae_hotline_added_phone_trgm'),
  ('idx_ae_hotline_batch_created'),
  ('idx_ae_hotline_batch_summary_trgm'),
  ('idx_ae_hotline_member_applied_org_trgm'),
  ('idx_ae_hotline_member_applied_phone_trgm'),
  ('idx_ae_hotline_member_applied_service_trgm'),
  ('idx_ae_hotline_member_original_org_trgm'),
  ('idx_ae_hotline_member_original_phone_trgm'),
  ('idx_ae_hotline_member_original_service_trgm'),
  ('idx_ae_hotline_quarantined_phone_trgm'),
  ('idx_ae_import_batches_user'),
  ('idx_ae_ingestion_audit_actor'),
  ('idx_ae_ingestion_audit_details_trgm'),
  ('idx_ae_languages_human_actors'),
  ('idx_ae_lifecycle_actor_id'),
  ('idx_ae_lifecycle_metadata_trgm'),
  ('idx_ae_llm_reviewed'),
  ('idx_ae_locations_human_actors'),
  ('idx_ae_notification_events_recipient'),
  ('idx_ae_notification_preferences_user'),
  ('idx_ae_org_members_created'),
  ('idx_ae_org_members_invited'),
  ('idx_ae_org_members_updated'),
  ('idx_ae_org_members_user'),
  ('idx_ae_org_scope_granted'),
  ('idx_ae_org_scope_user'),
  ('idx_ae_organizations_human_actors'),
  ('idx_ae_organizations_verified'),
  ('idx_ae_pending_grants_decided'),
  ('idx_ae_pending_grants_requested'),
  ('idx_ae_pending_grants_user'),
  ('idx_ae_phones_human_actors'),
  ('idx_ae_profiles_created'),
  ('idx_ae_profiles_restored'),
  ('idx_ae_profiles_suspended'),
  ('idx_ae_profiles_updated'),
  ('idx_ae_programs_human_actors'),
  ('idx_ae_provenance_decided'),
  ('idx_ae_quarantine_batch_created'),
  ('idx_ae_quarantine_classifier_trgm'),
  ('idx_ae_quarantine_member_holder'),
  ('idx_ae_resolution_resolved'),
  ('idx_ae_resource_tags_added'),
  ('idx_ae_routing_assigned'),
  ('idx_ae_saved_collections_user'),
  ('idx_ae_saved_services_user'),
  ('idx_ae_schedules_human_actors'),
  ('idx_ae_scope_audit_actor'),
  ('idx_ae_scope_audit_after_trgm'),
  ('idx_ae_scope_audit_before_trgm'),
  ('idx_ae_scope_audit_target_trgm'),
  ('idx_ae_scope_grants_granted'),
  ('idx_ae_scope_grants_user'),
  ('idx_ae_seeker_feedback_created'),
  ('idx_ae_seeker_feedback_updated'),
  ('idx_ae_seeker_profiles_created'),
  ('idx_ae_seeker_profiles_updated'),
  ('idx_ae_seeker_profiles_user'),
  ('idx_ae_service_areas_human_actors'),
  ('idx_ae_service_locations_human_actors'),
  ('idx_ae_service_taxonomy_human_actors'),
  ('idx_ae_services_human_actors'),
  ('idx_ae_source_confidence_trgm'),
  ('idx_ae_source_error_trgm'),
  ('idx_ae_source_parsed_trgm'),
  ('idx_ae_source_raw_trgm'),
  ('idx_ae_staging_locations_human_actors'),
  ('idx_ae_staging_orgs_human_actors'),
  ('idx_ae_staging_services_human_actors'),
  ('idx_ae_submissions_assigned'),
  ('idx_ae_submissions_evidence_trgm'),
  ('idx_ae_submissions_locked'),
  ('idx_ae_submissions_payload_trgm'),
  ('idx_ae_submissions_submitted'),
  ('idx_ae_tag_queue_assigned'),
  ('idx_ae_tag_queue_reviewed'),
  ('idx_ae_taxonomy_terms_human_actors'),
  ('idx_ae_templates_created'),
  ('idx_ae_templates_updated'),
  ('idx_ae_transfers_admin'),
  ('idx_ae_transfers_requested'),
  ('idx_ae_transfers_snapshot_trgm'),
  ('idx_ae_transitions_actor'),
  ('idx_ae_transitions_gates_trgm'),
  ('idx_ae_transitions_metadata_trgm'),
  ('idx_ae_verification_archive_assigned'),
  ('idx_ae_verification_archive_created'),
  ('idx_ae_verification_archive_submitted'),
  ('idx_ae_verification_archive_updated'),
  ('idx_ae_verification_archive_notes_trgm'),
  ('idx_ae_verification_evidence_user'),
  ('idx_ae_verified_links_user'),
  ('idx_form_instances_recipient_user'),
  ('idx_lifecycle_events_actor'),
  ('idx_source_records_submission_id');

-- CREATE INDEX CONCURRENTLY may leave an invalid same-name catalog entry when
-- interrupted. Remove only invalid entries from this fixed manifest before
-- IF NOT EXISTS is allowed to decide that a valid build can be reused.
SELECT pg_catalog.format(
  'DROP INDEX CONCURRENTLY IF EXISTS %I.%I',
  namespace.nspname,
  index_relation.relname
)
FROM pg_catalog.pg_index index_state
JOIN pg_catalog.pg_class index_relation
  ON index_relation.oid = index_state.indexrelid
JOIN pg_catalog.pg_namespace namespace
  ON namespace.oid = index_relation.relnamespace
JOIN account_erasure_expected_indexes expected
  ON expected.index_name = index_relation.relname
WHERE NOT (
  index_state.indisvalid
  AND index_state.indisready
  AND index_state.indislive
)
\gexec

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lifecycle_events_actor
  ON public.lifecycle_events (actor_id, created_at DESC, id)
  WHERE actor_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_form_instances_recipient_user
  ON public.form_instances (recipient_user_id, created_at DESC, id)
  WHERE recipient_user_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_source_records_submission_id
  ON public.source_records ((raw_payload ->> 'submissionId'), created_at DESC, id)
  WHERE raw_payload ? 'submissionId';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_saved_collections_user
  ON public.saved_collections (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_saved_services_user
  ON public.saved_services (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_notification_preferences_user
  ON public.notification_preferences (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_notification_events_recipient
  ON public.notification_events (recipient_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_chat_sessions_user
  ON public.chat_sessions (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_seeker_feedback_created
  ON public.seeker_feedback (created_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_seeker_feedback_updated
  ON public.seeker_feedback (updated_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_seeker_profiles_user
  ON public.seeker_profiles (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_seeker_profiles_created
  ON public.seeker_profiles (created_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_seeker_profiles_updated
  ON public.seeker_profiles (updated_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_form_instances_recipient
  ON public.form_instances (recipient_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_form_data_trgm
  ON public.form_instances USING gin ((form_data::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_form_attachments_trgm
  ON public.form_instances USING gin ((attachment_manifest::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_form_blob_prefix_trgm
  ON public.form_instances USING gin (blob_storage_prefix extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_chat_usage_identity
  ON oran_internal.chat_usage_events (identity_key, request_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_chat_lease_identity
  ON oran_internal.chat_inflight_leases (identity_key);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_chat_rate_key
  ON oran_internal.chat_rate_limit_windows (rate_key);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_source_raw_trgm
  ON public.source_records USING gin ((raw_payload::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_source_parsed_trgm
  ON public.source_records USING gin ((parsed_payload::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_source_confidence_trgm
  ON public.source_records USING gin ((source_confidence_signals::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_source_error_trgm
  ON public.source_records USING gin (processing_error extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_submissions_submitted
  ON public.submissions (submitted_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_submissions_assigned
  ON public.submissions (assigned_to_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_submissions_locked
  ON public.submissions (locked_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_submissions_payload_trgm
  ON public.submissions USING gin ((payload::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_submissions_evidence_trgm
  ON public.submissions USING gin ((evidence::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_routing_assigned
  ON public.admin_routing_rules (assigned_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_candidates_assigned
  ON public.extracted_candidates (assigned_to_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_candidates_published
  ON public.extracted_candidates (published_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_candidates_checklist_trgm
  ON public.extracted_candidates USING gin ((verification_checklist::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_candidates_pack_trgm
  ON public.extracted_candidates USING gin ((investigation_pack::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_candidates_provenance_trgm
  ON public.extracted_candidates USING gin ((provenance_records::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_tag_queue_assigned
  ON public.tag_confirmation_queue (assigned_to_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_tag_queue_reviewed
  ON public.tag_confirmation_queue (reviewed_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_verification_archive_assigned
  ON public.verification_queue_archive (assigned_to_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_verification_archive_submitted
  ON public.verification_queue_archive (submitted_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_verification_archive_created
  ON public.verification_queue_archive (created_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_verification_archive_updated
  ON public.verification_queue_archive (updated_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_verification_archive_notes_trgm
  ON public.verification_queue_archive USING gin
    (notes extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_admin_review_user
  ON public.admin_review_profiles (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_scope_grants_user
  ON public.user_scope_grants (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_scope_grants_granted
  ON public.user_scope_grants (granted_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_pending_grants_user
  ON public.pending_scope_grants (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_pending_grants_requested
  ON public.pending_scope_grants (requested_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_pending_grants_decided
  ON public.pending_scope_grants (decided_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_org_members_user
  ON public.organization_members (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_org_members_invited
  ON public.organization_members (invited_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_org_members_created
  ON public.organization_members (created_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_org_members_updated
  ON public.organization_members (updated_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_transfers_requested
  ON public.ownership_transfers (requested_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_transfers_admin
  ON public.ownership_transfers (current_admin_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_transfers_snapshot_trgm
  ON public.ownership_transfers USING gin ((service_snapshot::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_ingestion_audit_actor
  ON public.ingestion_audit_events (actor_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_ingestion_audit_details_trgm
  ON public.ingestion_audit_events USING gin ((details::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_lifecycle_actor_id
  ON public.lifecycle_events (actor_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_lifecycle_metadata_trgm
  ON public.lifecycle_events USING gin ((metadata::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_llm_reviewed
  ON public.llm_suggestions (reviewed_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_feed_state_approved
  ON public.source_feed_states (auto_publish_approved_by, source_feed_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_import_batches_user
  ON public.import_batches (imported_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_provenance_decided
  ON public.canonical_provenance (decided_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_resolution_resolved
  ON public.resolution_candidates (resolved_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_decisions_decided
  ON public.resolution_decisions (decided_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_resource_tags_added
  ON public.resource_tags (added_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_crosswalks_created
  ON public.taxonomy_crosswalks (created_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_verified_links_user
  ON public.verified_service_links (verified_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_verification_evidence_user
  ON public.verification_evidence (submitted_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_audit_actor
  ON public.audit_logs (actor_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_audit_before_trgm
  ON public.audit_logs USING gin ((before::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_audit_after_trgm
  ON public.audit_logs USING gin ((after::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_scope_audit_actor
  ON public.scope_audit_log (actor_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_scope_audit_target_trgm
  ON public.scope_audit_log USING gin (target_id extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_scope_audit_before_trgm
  ON public.scope_audit_log USING gin ((before_state::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_scope_audit_after_trgm
  ON public.scope_audit_log USING gin ((after_state::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_transitions_actor
  ON public.submission_transitions (actor_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_transitions_gates_trgm
  ON public.submission_transitions USING gin ((gates_checked::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_transitions_metadata_trgm
  ON public.submission_transitions USING gin ((metadata::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_freshness_holder
  ON oran_internal.resource_freshness_findings (original_integrity_held_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_freshness_evidence_trgm
  ON oran_internal.resource_freshness_findings USING gin ((evidence::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_quarantine_member_holder
  ON oran_internal.resource_quarantine_members (original_integrity_held_by_user_id, batch_id, service_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_quarantine_batch_created
  ON oran_internal.resource_quarantine_batches (created_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_quarantine_classifier_trgm
  ON oran_internal.resource_quarantine_batches USING gin ((classifier::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_member_original_service_trgm
  ON oran_internal.hotline_authority_members USING gin ((original_service::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_member_applied_service_trgm
  ON oran_internal.hotline_authority_members USING gin ((applied_service::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_member_original_org_trgm
  ON oran_internal.hotline_authority_members USING gin ((original_organization::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_member_applied_org_trgm
  ON oran_internal.hotline_authority_members USING gin ((applied_organization::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_member_original_phone_trgm
  ON oran_internal.hotline_authority_members USING gin ((original_phones::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_member_applied_phone_trgm
  ON oran_internal.hotline_authority_members USING gin ((applied_phones::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_quarantined_phone_trgm
  ON oran_internal.hotline_quarantined_contacts USING gin ((phone_snapshot::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_added_phone_trgm
  ON oran_internal.hotline_authority_added_contacts USING gin ((phone_snapshot::text) extensions.gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_batch_created
  ON oran_internal.hotline_authority_batches (created_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_hotline_batch_summary_trgm
  ON oran_internal.hotline_authority_batches USING gin ((validation_summary::text) extensions.gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_profiles_created
  ON public.user_profiles (created_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_profiles_updated
  ON public.user_profiles (updated_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_profiles_suspended
  ON public.user_profiles (suspended_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_profiles_restored
  ON public.user_profiles (restored_by_user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_org_scope_user
  ON public.org_service_scope (user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_org_scope_granted
  ON public.org_service_scope (granted_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_templates_created
  ON public.content_templates (created_by, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_templates_updated
  ON public.content_templates (updated_by, id);

-- Nationwide imported-resource tables use one partial actor-array GIN each.
-- The reserved import: namespace is ingestion provenance, never an authenticated
-- subject. Every other legacy value remains indexed and eligible for erasure.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_accessibility_human_actors
  ON public.accessibility_for_disabilities USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_addresses_human_actors
  ON public.addresses USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_contacts_human_actors
  ON public.contacts USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_coverage_human_actors
  ON public.coverage_zones USING gin ((ARRAY[created_by_user_id, updated_by_user_id, assigned_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
     OR (assigned_user_id IS NOT NULL AND assigned_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_dietary_human_actors
  ON public.dietary_options USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_eligibility_human_actors
  ON public.eligibility USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_flags_human_actors
  ON public.feature_flags USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_form_templates_human_actors
  ON public.form_templates USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_languages_human_actors
  ON public.languages USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_locations_human_actors
  ON public.locations USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_organizations_human_actors
  ON public.organizations USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_phones_human_actors
  ON public.phones USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_programs_human_actors
  ON public.programs USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_documents_human_actors
  ON public.required_documents USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_schedules_human_actors
  ON public.schedules USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_adaptations_human_actors
  ON public.service_adaptations USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_service_areas_human_actors
  ON public.service_areas USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_service_locations_human_actors
  ON public.service_at_location USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_attributes_human_actors
  ON public.service_attributes USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_service_taxonomy_human_actors
  ON public.service_taxonomy USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_services_human_actors
  ON public.services USING gin ((ARRAY[created_by_user_id, updated_by_user_id, integrity_held_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
     OR (integrity_held_by_user_id IS NOT NULL AND integrity_held_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_staging_locations_human_actors
  ON public.staging_locations USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_staging_orgs_human_actors
  ON public.staging_organizations USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_staging_services_human_actors
  ON public.staging_services USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_taxonomy_terms_human_actors
  ON public.taxonomy_terms USING gin ((ARRAY[created_by_user_id, updated_by_user_id]))
  WHERE (created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:');
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ae_organizations_verified
  ON public.organizations (verified_by_user_id, id)
  WHERE verified_by_user_id IS NOT NULL;

DO $index_verification$
DECLARE
  v_invalid text;
BEGIN
  SELECT pg_catalog.string_agg(expected.index_name::text, ', '
           ORDER BY expected.index_name)
  INTO v_invalid
  FROM account_erasure_expected_indexes expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class index_relation
    JOIN pg_catalog.pg_index index_state
      ON index_state.indexrelid = index_relation.oid
    WHERE index_relation.relname = expected.index_name
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indislive
  );
  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'account-erasure indexes missing or invalid: %', v_invalid;
  END IF;
END
$index_verification$;

RESET statement_timeout;
RESET lock_timeout;
