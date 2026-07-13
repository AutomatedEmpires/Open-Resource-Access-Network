-- Resource freshness / expiry review lane.
--
-- Findings are operational audit records, not canonical resource data. They
-- live in the non-Data-API oran_internal schema and preserve the evidence and
-- exact publication hold applied by the scheduled scanner. The scanner routes
-- review work through the existing public.submissions workflow; it never
-- deletes a service.

CREATE SCHEMA IF NOT EXISTS oran_internal;
REVOKE ALL ON SCHEMA oran_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS oran_internal.resource_freshness_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL
    REFERENCES public.services(id) ON DELETE CASCADE,
  submission_id uuid
    REFERENCES public.submissions(id) ON DELETE SET NULL,
  signal_type text NOT NULL CHECK (
    signal_type IN (
      'explicit_expiry',
      'reverification_due',
      'stale_source',
      'unknown_source'
    )
  ),
  signal_observed_at timestamptz NOT NULL,
  freshness_threshold_days integer CHECK (
    freshness_threshold_days IS NULL OR freshness_threshold_days > 0
  ),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'resolved', 'confirmed_unavailable')
  ),
  hold_reason text NOT NULL UNIQUE,
  original_integrity_hold_at timestamptz,
  original_integrity_hold_reason text,
  original_integrity_held_by_user_id text,
  blocked_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one unresolved freshness decision may exist per service. Resolved
-- findings remain immutable audit history and do not prevent future scans.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_freshness_findings_open_service
  ON oran_internal.resource_freshness_findings (service_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_resource_freshness_findings_open_queue
  ON oran_internal.resource_freshness_findings (detected_at, service_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_resource_freshness_findings_submission
  ON oran_internal.resource_freshness_findings (submission_id)
  WHERE submission_id IS NOT NULL;

-- Scanner access paths. These are partial because only published/live records
-- can enter the review lane.
CREATE INDEX IF NOT EXISTS idx_canonical_services_stale_scan
  ON public.canonical_services (last_refreshed_at, published_service_id)
  WHERE published_service_id IS NOT NULL
    AND lifecycle_status = 'active'
    AND publication_status = 'published';

CREATE INDEX IF NOT EXISTS idx_canonical_services_published_service
  ON public.canonical_services (published_service_id)
  WHERE published_service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_extracted_candidates_reverify_scan
  ON public.extracted_candidates (reverify_at, published_service_id)
  WHERE published_service_id IS NOT NULL
    AND reverify_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedules_expiry_service_scan
  ON public.schedules (valid_to, service_id)
  WHERE service_id IS NOT NULL AND valid_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedules_expiry_location_scan
  ON public.schedules (valid_to, location_id)
  WHERE service_id IS NULL
    AND location_id IS NOT NULL
    AND valid_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_services_unknown_freshness_scan
  ON public.services (updated_at, id)
  WHERE status = 'active' AND integrity_hold_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_resource_freshness_findings'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_resource_freshness_findings
      BEFORE UPDATE ON oran_internal.resource_freshness_findings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

REVOKE ALL ON oran_internal.resource_freshness_findings FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA oran_internal
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA oran_internal
  REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- Production uses a dedicated least-privilege runtime login. Grant only the
-- audit-table operations required by the internal scanner when that role is
-- present; migration owners continue to work in local/test databases.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oran_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA oran_internal TO oran_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE '
      || 'ON oran_internal.resource_freshness_findings TO oran_runtime';
  END IF;
END
$$;

COMMENT ON TABLE oran_internal.resource_freshness_findings IS
  'Private, reversible audit trail for expired or stale seeker-resource publication holds.';
COMMENT ON COLUMN oran_internal.resource_freshness_findings.hold_reason IS
  'Exact services.integrity_hold_reason written by the scanner; required for compare-and-clear release.';
COMMENT ON COLUMN oran_internal.resource_freshness_findings.evidence IS
  'Deterministic source/schedule freshness facts observed when the finding was created.';
