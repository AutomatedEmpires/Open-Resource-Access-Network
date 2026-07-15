-- 0069_freshness_and_merge_runtime_capability.sql
--
-- Patch the production backend role after lifecycle review added row locks,
-- the duplicate merger was reconciled with the live HSDS child tables, and
-- privacy erasure began pseudonymizing immutable lifecycle actors. The
-- canonical manifest remains in 0066 for greenfield installs; this migration
-- brings already-provisioned environments to the same least-privilege state.

BEGIN;

GRANT SELECT ON TABLE
  oran_internal.hotline_authority_batches,
  oran_internal.hotline_authority_members,
  oran_internal.resource_quarantine_batches,
  oran_internal.resource_quarantine_members,
  public.contacts,
  public.dietary_options,
  public.ingestion_sources,
  public.org_service_scope,
  public.programs,
  public.service_adaptations,
  public.staging_locations,
  public.staging_organizations,
  public.staging_services
TO oran_backend_runtime;

GRANT UPDATE ON TABLE
  public.contacts,
  public.dietary_options,
  public.eligibility,
  public.ingestion_sources,
  public.languages,
  public.lifecycle_events,
  public.org_service_scope,
  public.phones,
  public.programs,
  public.required_documents,
  public.resource_tags,
  public.saved_collection_services,
  public.saved_services,
  public.schedules,
  public.service_adaptations,
  public.service_areas,
  public.service_at_location,
  public.service_attributes,
  public.service_taxonomy
TO oran_backend_runtime;

COMMIT;
