-- 0067_retire_legacy_runtime_acl.sql
--
-- Imported environments can carry explicit grants on extension-owned objects
-- from the former application login. 0066 intentionally leaves extension
-- ownership and PUBLIC ACLs untouched, but the retired login must retain no
-- direct schema, relation, or function capability anywhere in the database.

BEGIN;

DO $retire_legacy_runtime_acl$
DECLARE
  v_legacy_oid oid;
  v_schema RECORD;
  v_relation RECORD;
  v_function pg_catalog.regprocedure;
BEGIN
  SELECT oid INTO v_legacy_oid
  FROM pg_catalog.pg_roles
  WHERE rolname = 'oran_runtime';

  IF v_legacy_oid IS NULL THEN
    RAISE EXCEPTION 'legacy oran_runtime role is missing; apply 0066 first';
  END IF;

  FOR v_schema IN
    SELECT n.nspname
    FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
    WHERE acl.grantee = v_legacy_oid
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM oran_runtime',
      v_schema.nspname
    );
  END LOOP;

  FOR v_relation IN
    SELECT c.oid::pg_catalog.regclass AS qualified_name, c.relkind
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
    WHERE acl.grantee = v_legacy_oid
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  LOOP
    IF v_relation.relkind = 'S' THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM oran_runtime',
        v_relation.qualified_name
      );
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE %s FROM oran_runtime',
        v_relation.qualified_name
      );
    END IF;
  END LOOP;

  FOR v_function IN
    SELECT p.oid::pg_catalog.regprocedure
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
    WHERE acl.grantee = v_legacy_oid
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM oran_runtime',
      v_function
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
    WHERE acl.grantee = v_legacy_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
    WHERE acl.grantee = v_legacy_oid
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
    WHERE acl.grantee = v_legacy_oid
  ) THEN
    RAISE EXCEPTION 'legacy oran_runtime retains direct object privileges';
  END IF;
END
$retire_legacy_runtime_acl$;

COMMIT;
