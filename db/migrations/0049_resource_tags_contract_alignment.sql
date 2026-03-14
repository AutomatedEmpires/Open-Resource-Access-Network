BEGIN;

ALTER TABLE resource_tags
  DROP CONSTRAINT IF EXISTS resource_tags_tag_type_check;

ALTER TABLE resource_tags
  DROP CONSTRAINT IF EXISTS resource_tags_source_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'resource_tags'::regclass
      AND conname = 'resource_tags_tag_type_check'
  ) THEN
    ALTER TABLE resource_tags
      ADD CONSTRAINT resource_tags_tag_type_check
      CHECK (
        tag_type IN (
          'service_type',
          'demographic',
          'accessibility',
          'eligibility',
          'geotag',
          'category',
          'geographic',
          'audience',
          'verification_missing',
          'verification_status',
          'program',
          'source_quality',
          'custom'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'resource_tags'::regclass
      AND conname = 'resource_tags_source_check'
  ) THEN
    ALTER TABLE resource_tags
      ADD CONSTRAINT resource_tags_source_check
      CHECK (
        source IN (
          'llm',
          'admin',
          'taxonomy',
          'import',
          'system',
          'agent',
          'human'
        )
      );
  END IF;
END $$;

COMMIT;
