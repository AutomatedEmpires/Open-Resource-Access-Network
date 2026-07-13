-- 0060_source_purpose_fail_closed.sql
-- Every source must state whether it is a service catalog, program-navigation
-- source, supporting reference, or intentionally excluded. There is no safe
-- implicit publication purpose.

BEGIN;

ALTER TABLE public.source_systems
  ALTER COLUMN resource_purpose DROP DEFAULT;

COMMENT ON COLUMN public.source_systems.resource_purpose IS
  'Required source intent. Must be assigned explicitly; supporting/excluded sources cannot publish standalone seeker resources.';

COMMIT;
