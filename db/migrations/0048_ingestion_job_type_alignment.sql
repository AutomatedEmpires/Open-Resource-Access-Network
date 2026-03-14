BEGIN;

ALTER TABLE ingestion_jobs
  DROP CONSTRAINT IF EXISTS ingestion_jobs_job_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ingestion_jobs'::regclass
      AND conname = 'ingestion_jobs_job_type_check'
  ) THEN
    ALTER TABLE ingestion_jobs
      ADD CONSTRAINT ingestion_jobs_job_type_check
      CHECK (
        job_type IN (
          'seed_crawl',
          'scheduled_reverify',
          'manual_submission',
          'rss_feed',
          'sitemap_discovery',
          'registry_change'
        )
      );
  END IF;
END $$;

COMMIT;
