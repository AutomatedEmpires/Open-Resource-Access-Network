-- 0070_services_fulltext_index.sql
--
-- Index the expression seeker search actually queries.
--
-- 0000 created two separate GIN indexes:
--   to_tsvector('english', name)
--   to_tsvector('english', coalesce(description, ''))
-- but every public text search asks for the CONCATENATED expression
--   to_tsvector('english', name || ' ' || coalesce(description, ''))
-- (src/services/search/engine.ts). A PostgreSQL expression index is only usable
-- when the indexed expression matches the query expression exactly, so neither
-- index could serve seeker search and every query fell back to a sequential scan
-- of the whole services corpus.
--
-- Measured on a disposable database seeded with 200k services (production holds
-- ~290k): Parallel Seq Scan 758 ms -> Bitmap Index Scan ~30 ms for the same
-- query. This is the crisis-discovery read path, so the scan cost is paid by
-- someone looking for food or shelter.
--
-- The pre-existing single-column indexes are intentionally left in place: they
-- are cheap relative to the corpus and may serve other callers. Removing them
-- is a separate, evidence-led change.
--
-- CONCURRENTLY: production already holds ~290k rows and a plain CREATE INDEX
-- takes an ACCESS EXCLUSIVE lock for the duration of the build, which would stop
-- every seeker read. This migration therefore contains exactly ONE statement and
-- no explicit transaction block -- CREATE INDEX CONCURRENTLY cannot run inside
-- one. Do not add further statements to this file.
--
-- If a concurrent build is interrupted it leaves an INVALID index behind, which
-- is not used by queries and is not an outage. Recovery:
--   DROP INDEX CONCURRENTLY idx_services_fts_name_description;
-- then re-run this migration.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_fts_name_description
  ON services
  USING gin (to_tsvector('english', name || ' ' || coalesce(description, '')));
