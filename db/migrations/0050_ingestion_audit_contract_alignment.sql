BEGIN;

ALTER TABLE ingestion_audit_events
  DROP CONSTRAINT IF EXISTS ingestion_audit_events_event_type_check;

ALTER TABLE ingestion_audit_events
  DROP CONSTRAINT IF EXISTS ingestion_audit_events_actor_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ingestion_audit_events'::regclass
      AND conname = 'ingestion_audit_events_event_type_check'
  ) THEN
    ALTER TABLE ingestion_audit_events
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
          'reverify.completed'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ingestion_audit_events'::regclass
      AND conname = 'ingestion_audit_events_actor_type_check'
  ) THEN
    ALTER TABLE ingestion_audit_events
      ADD CONSTRAINT ingestion_audit_events_actor_type_check
      CHECK (
        actor_type IN (
          'system',
          'admin',
          'llm',
          'human',
          'service_principal',
          'ingestion_agent',
          'agent',
          'scheduler'
        )
      );
  END IF;
END $$;

COMMIT;
