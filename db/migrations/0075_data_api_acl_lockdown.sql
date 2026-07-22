-- Converge imported and greenfield databases on ORAN's pg-direct contract.
-- The application never authenticates as the browser-facing Supabase roles.

BEGIN;

-- anon/authenticated inherit the default public-schema grant through PUBLIC;
-- direct revokes alone do not remove that path.
REVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated;

DO $enable_application_rls$
DECLARE
  application_table record;
BEGIN
  FOR application_table IN
    SELECT c.oid::pg_catalog.regclass AS qualified_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'spatial_ref_sys'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE %s ENABLE ROW LEVEL SECURITY',
      application_table.qualified_name
    );
  END LOOP;
END
$enable_application_rls$;

COMMIT;
