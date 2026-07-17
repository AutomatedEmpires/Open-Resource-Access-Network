-- 0069_backend_contact_read_capability.sql
--
-- Grant the backend role read access to public.contacts.
--
-- Service detail hydration reads named contacts for a service
-- (src/services/search/hydrateRelations.ts). public.contacts was never in any
-- 0066 grant list, so on every provisioned database that read fails closed with
-- a permission error and takes the whole detail response with it.
--
-- The canonical manifest for greenfield installs remains in 0066, which now
-- lists public.contacts; this migration brings already-provisioned environments
-- to the same state. The pair is deliberate -- editing 0066 alone would only
-- ever reach a database built from scratch, and the ledger keys on filename so
-- 0066 never re-runs where it has already been applied.
--
-- Read-only: contacts are edited through the submission/review pipeline, which
-- writes via the paths that already hold INSERT/UPDATE/DELETE elsewhere.

BEGIN;

GRANT SELECT ON TABLE
  public.contacts
TO oran_backend_runtime;

COMMIT;
