-- Migration: add explicit source feed handler contract
--
-- Rationale:
-- The ingestion service previously inferred runtime ownership for source feeds
-- from source-system family, base URL, or source-system name. That made 211 and
-- HSDS dispatch heuristic-based and brittle. `feed_handler` turns that into an
-- explicit contract stored on each source_feeds row.

ALTER TABLE source_feeds
  ADD COLUMN IF NOT EXISTS feed_handler TEXT NOT NULL DEFAULT 'none'
  CHECK (feed_handler IN ('none', 'hsds_api', 'ndp_211', 'azure_function'));

CREATE INDEX IF NOT EXISTS idx_source_feeds_handler
  ON source_feeds(feed_handler);

UPDATE source_feeds AS sf
   SET feed_handler = CASE
     WHEN sf.feed_handler IS NOT DISTINCT FROM 'none' AND sf.feed_type = 'hsds_api' THEN 'hsds_api'
     WHEN sf.feed_handler IS NOT DISTINCT FROM 'none'
       AND (
         sf.base_url ILIKE '%api.211.org%'
         OR sf.feed_name ILIKE '%211%'
         OR (
           ss.family = 'partner_api'
           AND ss.name ILIKE '%211%'
         )
       ) THEN 'ndp_211'
     ELSE sf.feed_handler
   END
  FROM source_systems AS ss
 WHERE ss.id = sf.source_system_id;
