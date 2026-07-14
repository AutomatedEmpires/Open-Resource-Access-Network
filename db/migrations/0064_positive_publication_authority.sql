-- 0064_positive_publication_authority.sql
-- Read-path indexes for ORAN's fail-closed publication gate. The gate accepts
-- only published canonical provenance or an approved manual projection; this
-- migration does not publish, update, or delete resource data.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_canonical_services_positive_publication
  ON public.canonical_services (published_service_id, winning_source_system_id, id)
  WHERE published_service_id IS NOT NULL
    AND winning_source_system_id IS NOT NULL
    AND status = 'active'
    AND lifecycle_status = 'active'
    AND publication_status = 'published'
    AND last_refreshed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_provenance_accepted_service_source
  ON public.canonical_provenance (canonical_entity_id, source_record_id)
  WHERE canonical_entity_type = 'service'
    AND decision_status = 'accepted'
    AND source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_records_published_feed
  ON public.source_records (source_feed_id, id)
  WHERE processing_status = 'published';

CREATE INDEX IF NOT EXISTS idx_source_feeds_active_system
  ON public.source_feeds (source_system_id, id)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_hsds_current_manual_publication
  ON public.hsds_export_snapshots (
    entity_id,
    ((hsds_payload #>> '{meta,sourceSubmissionId}'))
  )
  WHERE entity_type = 'service'
    AND status = 'current'
    AND (hsds_payload #>> '{meta,publicationSourceKind}') IN (
      'host_submission',
      'community_review'
    );

CREATE INDEX IF NOT EXISTS idx_submissions_approved_projection
  ON public.submissions (service_id, id)
  WHERE status = 'approved'
    AND submission_type IN (
      'new_service',
      'service_verification',
      'data_correction'
    )
    AND payload ? 'projectionSourceRecordId';

CREATE INDEX IF NOT EXISTS idx_submission_transitions_approved_passed
  ON public.submission_transitions (submission_id)
  WHERE to_status = 'approved'
    AND gates_passed IS TRUE;

COMMIT;
