-- 0073_account_erasure_index_gate.sql
--
-- API-compatible release gate for the online index phase. Build the indexes
-- first with scripts/db/build-account-erasure-indexes.sql over the reviewed
-- ORAN Supabase direct/session connection. Migration history advances past
-- this file only when every fixed-manifest index is live, ready, and valid.

BEGIN;

DO $account_erasure_index_gate$
DECLARE
  v_invalid text;
BEGIN
  WITH expected(index_name) AS (
    VALUES
      ('idx_ae_accessibility_human_actors'::name),
      ('idx_ae_adaptations_human_actors'::name),
      ('idx_ae_addresses_human_actors'::name),
      ('idx_ae_admin_review_user'::name),
      ('idx_ae_attributes_human_actors'::name),
      ('idx_ae_audit_actor'::name),
      ('idx_ae_audit_after_trgm'::name),
      ('idx_ae_audit_before_trgm'::name),
      ('idx_ae_candidates_assigned'::name),
      ('idx_ae_candidates_checklist_trgm'::name),
      ('idx_ae_candidates_pack_trgm'::name),
      ('idx_ae_candidates_provenance_trgm'::name),
      ('idx_ae_candidates_published'::name),
      ('idx_ae_chat_lease_identity'::name),
      ('idx_ae_chat_rate_key'::name),
      ('idx_ae_chat_sessions_user'::name),
      ('idx_ae_chat_usage_identity'::name),
      ('idx_ae_contacts_human_actors'::name),
      ('idx_ae_coverage_human_actors'::name),
      ('idx_ae_crosswalks_created'::name),
      ('idx_ae_decisions_decided'::name),
      ('idx_ae_dietary_human_actors'::name),
      ('idx_ae_documents_human_actors'::name),
      ('idx_ae_eligibility_human_actors'::name),
      ('idx_ae_feed_state_approved'::name),
      ('idx_ae_flags_human_actors'::name),
      ('idx_ae_form_attachments_trgm'::name),
      ('idx_ae_form_blob_prefix_trgm'::name),
      ('idx_ae_form_data_trgm'::name),
      ('idx_ae_form_instances_recipient'::name),
      ('idx_ae_form_templates_human_actors'::name),
      ('idx_ae_freshness_evidence_trgm'::name),
      ('idx_ae_freshness_holder'::name),
      ('idx_ae_hotline_added_phone_trgm'::name),
      ('idx_ae_hotline_batch_created'::name),
      ('idx_ae_hotline_batch_summary_trgm'::name),
      ('idx_ae_hotline_member_applied_org_trgm'::name),
      ('idx_ae_hotline_member_applied_phone_trgm'::name),
      ('idx_ae_hotline_member_applied_service_trgm'::name),
      ('idx_ae_hotline_member_original_org_trgm'::name),
      ('idx_ae_hotline_member_original_phone_trgm'::name),
      ('idx_ae_hotline_member_original_service_trgm'::name),
      ('idx_ae_hotline_quarantined_phone_trgm'::name),
      ('idx_ae_import_batches_user'::name),
      ('idx_ae_ingestion_audit_actor'::name),
      ('idx_ae_ingestion_audit_details_trgm'::name),
      ('idx_ae_languages_human_actors'::name),
      ('idx_ae_lifecycle_actor_id'::name),
      ('idx_ae_lifecycle_metadata_trgm'::name),
      ('idx_ae_llm_reviewed'::name),
      ('idx_ae_locations_human_actors'::name),
      ('idx_ae_notification_events_recipient'::name),
      ('idx_ae_notification_preferences_user'::name),
      ('idx_ae_org_members_created'::name),
      ('idx_ae_org_members_invited'::name),
      ('idx_ae_org_members_updated'::name),
      ('idx_ae_org_members_user'::name),
      ('idx_ae_org_scope_granted'::name),
      ('idx_ae_org_scope_user'::name),
      ('idx_ae_organizations_human_actors'::name),
      ('idx_ae_organizations_verified'::name),
      ('idx_ae_pending_grants_decided'::name),
      ('idx_ae_pending_grants_requested'::name),
      ('idx_ae_pending_grants_user'::name),
      ('idx_ae_phones_human_actors'::name),
      ('idx_ae_profiles_created'::name),
      ('idx_ae_profiles_restored'::name),
      ('idx_ae_profiles_suspended'::name),
      ('idx_ae_profiles_updated'::name),
      ('idx_ae_programs_human_actors'::name),
      ('idx_ae_provenance_decided'::name),
      ('idx_ae_quarantine_batch_created'::name),
      ('idx_ae_quarantine_classifier_trgm'::name),
      ('idx_ae_quarantine_member_holder'::name),
      ('idx_ae_resolution_resolved'::name),
      ('idx_ae_resource_tags_added'::name),
      ('idx_ae_routing_assigned'::name),
      ('idx_ae_saved_collections_user'::name),
      ('idx_ae_saved_services_user'::name),
      ('idx_ae_schedules_human_actors'::name),
      ('idx_ae_scope_audit_actor'::name),
      ('idx_ae_scope_audit_after_trgm'::name),
      ('idx_ae_scope_audit_before_trgm'::name),
      ('idx_ae_scope_audit_target_trgm'::name),
      ('idx_ae_scope_grants_granted'::name),
      ('idx_ae_scope_grants_user'::name),
      ('idx_ae_seeker_feedback_created'::name),
      ('idx_ae_seeker_feedback_updated'::name),
      ('idx_ae_seeker_profiles_created'::name),
      ('idx_ae_seeker_profiles_updated'::name),
      ('idx_ae_seeker_profiles_user'::name),
      ('idx_ae_service_areas_human_actors'::name),
      ('idx_ae_service_locations_human_actors'::name),
      ('idx_ae_service_taxonomy_human_actors'::name),
      ('idx_ae_services_human_actors'::name),
      ('idx_ae_source_confidence_trgm'::name),
      ('idx_ae_source_error_trgm'::name),
      ('idx_ae_source_parsed_trgm'::name),
      ('idx_ae_source_raw_trgm'::name),
      ('idx_ae_staging_locations_human_actors'::name),
      ('idx_ae_staging_orgs_human_actors'::name),
      ('idx_ae_staging_services_human_actors'::name),
      ('idx_ae_submissions_assigned'::name),
      ('idx_ae_submissions_evidence_trgm'::name),
      ('idx_ae_submissions_locked'::name),
      ('idx_ae_submissions_payload_trgm'::name),
      ('idx_ae_submissions_submitted'::name),
      ('idx_ae_tag_queue_assigned'::name),
      ('idx_ae_tag_queue_reviewed'::name),
      ('idx_ae_taxonomy_terms_human_actors'::name),
      ('idx_ae_templates_created'::name),
      ('idx_ae_templates_updated'::name),
      ('idx_ae_transfers_admin'::name),
      ('idx_ae_transfers_requested'::name),
      ('idx_ae_transfers_snapshot_trgm'::name),
      ('idx_ae_transitions_actor'::name),
      ('idx_ae_transitions_gates_trgm'::name),
      ('idx_ae_transitions_metadata_trgm'::name),
      ('idx_ae_verification_archive_assigned'::name),
      ('idx_ae_verification_archive_created'::name),
      ('idx_ae_verification_archive_submitted'::name),
      ('idx_ae_verification_archive_updated'::name),
      ('idx_ae_verification_archive_notes_trgm'::name),
      ('idx_ae_verification_evidence_user'::name),
      ('idx_ae_verified_links_user'::name),
      ('idx_form_instances_recipient_user'::name),
      ('idx_lifecycle_events_actor'::name),
      ('idx_source_records_submission_id'::name)
  )
  SELECT pg_catalog.string_agg(expected.index_name::text, ', '
           ORDER BY expected.index_name)
  INTO v_invalid
  FROM expected
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
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'account-erasure online index phase is incomplete',
      DETAIL = v_invalid,
      HINT = 'Run scripts/db/build-account-erasure-indexes.sql on the reviewed ORAN direct/session connection, then retry this migration.';
  END IF;
END
$account_erasure_index_gate$;

COMMIT;
