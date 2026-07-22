-- ORAN does not use Supabase's browser-facing Data API. Give PostgREST a
-- dedicated empty schema so extension-owned objects in public (notably
-- PostGIS spatial_ref_sys and SECURITY DEFINER helpers) are unreachable even
-- when their provider-managed ACLs cannot be changed by the project postgres
-- role. The matching provider setting must expose only `oran_api`.

BEGIN;

CREATE SCHEMA IF NOT EXISTS oran_api AUTHORIZATION postgres;

REVOKE ALL PRIVILEGES ON SCHEMA oran_api
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA oran_api
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA oran_api
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA oran_api
  FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA oran_api
  REVOKE ALL PRIVILEGES ON TABLES
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA oran_api
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA oran_api
  REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SCHEMA oran_api IS
  'Empty deny-by-default schema exclusively exposed by ORAN Supabase Data API configuration.';

COMMIT;
