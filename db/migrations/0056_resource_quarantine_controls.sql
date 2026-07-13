-- Audited, reversible quarantine controls for source-purpose violations.
-- Internal records live outside the Data API's exposed public schema.

CREATE SCHEMA IF NOT EXISTS oran_internal;
REVOKE ALL ON SCHEMA oran_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS oran_internal.resource_quarantine_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  reason text NOT NULL,
  classifier jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_service_count integer NOT NULL CHECK (expected_service_count > 0),
  actual_service_count integer,
  actual_organization_count integer,
  actual_location_count integer,
  member_checksum text,
  status text NOT NULL DEFAULT 'applying'
    CHECK (status IN ('applying', 'applied', 'rolled_back')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  rolled_back_at timestamptz
);

CREATE TABLE IF NOT EXISTS oran_internal.resource_quarantine_members (
  batch_id uuid NOT NULL
    REFERENCES oran_internal.resource_quarantine_batches(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  location_id uuid NOT NULL,
  original_service_status text NOT NULL,
  original_organization_status text NOT NULL,
  original_location_status text NOT NULL,
  original_integrity_hold_at timestamptz,
  original_integrity_hold_reason text,
  original_integrity_held_by_user_id text,
  quarantined_at timestamptz NOT NULL,
  PRIMARY KEY (batch_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_quarantine_members_service
  ON oran_internal.resource_quarantine_members (service_id);
CREATE INDEX IF NOT EXISTS idx_resource_quarantine_members_organization
  ON oran_internal.resource_quarantine_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_resource_quarantine_members_location
  ON oran_internal.resource_quarantine_members (location_id);
CREATE INDEX IF NOT EXISTS idx_resource_quarantine_batches_active
  ON oran_internal.resource_quarantine_batches (created_at DESC)
  WHERE status = 'applied';

REVOKE ALL ON ALL TABLES IN SCHEMA oran_internal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA oran_internal FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA oran_internal
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA oran_internal
  REVOKE ALL ON SEQUENCES FROM PUBLIC;

CREATE OR REPLACE FUNCTION oran_internal.apply_usda_snap_retailer_quarantine(
  p_expected_service_count integer DEFAULT 254048
)
RETURNS TABLE (
  batch_id uuid,
  quarantined_services integer,
  quarantined_organizations integer,
  quarantined_locations integer,
  checksum text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_slug constant text := 'usda-fns-snap-retailer-2026-07';
  v_reason constant text := 'source_purpose:supporting_reference:usda_fns_snap_retailer';
  v_actor constant text := 'system:source-purpose-quarantine';
  v_batch_id uuid;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_total bigint;
  v_distinct_services bigint;
  v_distinct_organizations bigint;
  v_distinct_locations bigint;
  v_invalid bigint;
  v_checksum text;
  v_service_updates integer;
  v_organization_updates integer;
  v_location_updates integer;
BEGIN
  IF p_expected_service_count IS NULL OR p_expected_service_count <= 0 THEN
    RAISE EXCEPTION 'expected service count must be positive';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:quarantine:usda-fns-snap-retailer-2026-07', 0)
  );

  SELECT b.id, b.status
  INTO v_batch_id, v_status
  FROM oran_internal.resource_quarantine_batches b
  WHERE b.slug = v_slug;

  IF FOUND THEN
    IF v_status <> 'applied' THEN
      RAISE EXCEPTION 'quarantine batch % already exists with status %', v_slug, v_status;
    END IF;

    RETURN QUERY
    SELECT b.id,
           b.actual_service_count,
           b.actual_organization_count,
           b.actual_location_count,
           b.member_checksum
    FROM oran_internal.resource_quarantine_batches b
    WHERE b.id = v_batch_id;
    RETURN;
  END IF;

  CREATE TEMP TABLE oran_snap_targets ON COMMIT DROP AS
  SELECT s.id AS service_id,
         s.organization_id,
         sal.location_id,
         s.status AS original_service_status,
         o.status AS original_organization_status,
         l.status AS original_location_status,
         s.integrity_hold_at AS original_integrity_hold_at,
         s.integrity_hold_reason AS original_integrity_hold_reason,
         s.integrity_held_by_user_id AS original_integrity_held_by_user_id
  FROM public.services s
  JOIN public.organizations o ON o.id = s.organization_id
  JOIN public.service_at_location sal ON sal.service_id = s.id
  JOIN public.locations l ON l.id = sal.location_id
  WHERE s.name = 'SNAP/EBT accepted here'
    AND s.description LIKE '%Source: USDA FNS SNAP Retailer Locator.%'
    AND s.description LIKE
      '%place to SPEND SNAP benefits (not a free-food or food-bank site)%'
    AND s.created_at >= timestamptz '2026-07-09 04:58:00+00'
    AND s.created_at < timestamptz '2026-07-09 05:17:00+00';

  CREATE UNIQUE INDEX oran_snap_targets_service_idx
    ON oran_snap_targets (service_id);
  CREATE INDEX oran_snap_targets_organization_idx
    ON oran_snap_targets (organization_id);
  CREATE INDEX oran_snap_targets_location_idx
    ON oran_snap_targets (location_id);

  SELECT count(*),
         count(DISTINCT t.service_id),
         count(DISTINCT t.organization_id),
         count(DISTINCT t.location_id)
  INTO v_total, v_distinct_services, v_distinct_organizations, v_distinct_locations
  FROM pg_temp.oran_snap_targets t;

  IF v_total <> p_expected_service_count
     OR v_distinct_services <> p_expected_service_count
     OR v_distinct_organizations <> p_expected_service_count
     OR v_distinct_locations <> p_expected_service_count THEN
    RAISE EXCEPTION
      'quarantine classifier drift: expected %, rows %, services %, organizations %, locations %',
      p_expected_service_count,
      v_total,
      v_distinct_services,
      v_distinct_organizations,
      v_distinct_locations;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM pg_temp.oran_snap_targets t
  WHERE t.original_service_status <> 'active'
     OR t.original_organization_status <> 'active'
     OR t.original_location_status <> 'active'
     OR t.original_integrity_hold_at IS NOT NULL
     OR t.original_integrity_hold_reason IS NOT NULL
     OR t.original_integrity_held_by_user_id IS NOT NULL;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'quarantine refused: % targets already changed or held', v_invalid;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM pg_temp.oran_snap_targets t
  WHERE NOT EXISTS (
          SELECT 1
          FROM public.confidence_scores cs
          WHERE cs.service_id = t.service_id
            AND cs.score = 58.10
        )
     OR NOT EXISTS (
          SELECT 1
          FROM public.service_taxonomy st
          JOIN public.taxonomy_terms tt ON tt.id = st.taxonomy_term_id
          WHERE st.service_id = t.service_id
            AND tt.term = 'SNAP/EBT Retailer'
        );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'quarantine refused: % targets failed source fingerprint checks', v_invalid;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM (
    SELECT ss.service_id
    FROM public.saved_services ss
    JOIN pg_temp.oran_snap_targets t ON t.service_id = ss.service_id
    UNION ALL
    SELECT su.service_id
    FROM public.submissions su
    JOIN pg_temp.oran_snap_targets t ON t.service_id = su.service_id
  ) dependencies;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'quarantine refused: % user dependencies exist', v_invalid;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM public.services s
  JOIN (
    SELECT DISTINCT organization_id
    FROM pg_temp.oran_snap_targets
  ) target_organizations ON target_organizations.organization_id = s.organization_id
  LEFT JOIN pg_temp.oran_snap_targets t ON t.service_id = s.id
  WHERE t.service_id IS NULL;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'quarantine refused: % non-target services share target organizations', v_invalid;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM public.service_at_location sal
  JOIN (
    SELECT DISTINCT location_id
    FROM pg_temp.oran_snap_targets
  ) target_locations ON target_locations.location_id = sal.location_id
  LEFT JOIN pg_temp.oran_snap_targets t ON t.service_id = sal.service_id
  WHERE t.service_id IS NULL;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'quarantine refused: % non-target services share target locations', v_invalid;
  END IF;

  SELECT md5(string_agg(t.service_id::text, ',' ORDER BY t.service_id))
  INTO v_checksum
  FROM pg_temp.oran_snap_targets t;

  INSERT INTO oran_internal.resource_quarantine_batches (
    slug,
    reason,
    classifier,
    expected_service_count,
    status,
    created_by,
    created_at
  )
  VALUES (
    v_slug,
    v_reason,
    jsonb_build_object(
      'name', 'SNAP/EBT accepted here',
      'source', 'USDA FNS SNAP Retailer Locator',
      'taxonomy', 'SNAP/EBT Retailer',
      'confidence', 58.10,
      'created_from', '2026-07-09T04:58:00Z',
      'created_before', '2026-07-09T05:17:00Z'
    ),
    p_expected_service_count,
    'applying',
    v_actor,
    v_now
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO oran_internal.resource_quarantine_members (
    batch_id,
    service_id,
    organization_id,
    location_id,
    original_service_status,
    original_organization_status,
    original_location_status,
    original_integrity_hold_at,
    original_integrity_hold_reason,
    original_integrity_held_by_user_id,
    quarantined_at
  )
  SELECT v_batch_id,
         t.service_id,
         t.organization_id,
         t.location_id,
         t.original_service_status,
         t.original_organization_status,
         t.original_location_status,
         t.original_integrity_hold_at,
         t.original_integrity_hold_reason,
         t.original_integrity_held_by_user_id,
         v_now
  FROM pg_temp.oran_snap_targets t;

  UPDATE public.services s
  SET status = 'inactive',
      integrity_hold_at = v_now,
      integrity_hold_reason = v_reason,
      integrity_held_by_user_id = v_actor,
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM pg_temp.oran_snap_targets t
  WHERE s.id = t.service_id
    AND s.status = t.original_service_status
    AND s.integrity_hold_at IS NOT DISTINCT FROM t.original_integrity_hold_at
    AND s.integrity_hold_reason IS NOT DISTINCT FROM t.original_integrity_hold_reason
    AND s.integrity_held_by_user_id IS NOT DISTINCT FROM t.original_integrity_held_by_user_id;
  GET DIAGNOSTICS v_service_updates = ROW_COUNT;

  UPDATE public.organizations o
  SET status = 'inactive',
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM (
    SELECT DISTINCT organization_id, original_organization_status
    FROM pg_temp.oran_snap_targets
  ) t
  WHERE o.id = t.organization_id
    AND o.status = t.original_organization_status;
  GET DIAGNOSTICS v_organization_updates = ROW_COUNT;

  UPDATE public.locations l
  SET status = 'inactive',
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM (
    SELECT DISTINCT location_id, original_location_status
    FROM pg_temp.oran_snap_targets
  ) t
  WHERE l.id = t.location_id
    AND l.status = t.original_location_status;
  GET DIAGNOSTICS v_location_updates = ROW_COUNT;

  IF v_service_updates <> p_expected_service_count
     OR v_organization_updates <> p_expected_service_count
     OR v_location_updates <> p_expected_service_count THEN
    RAISE EXCEPTION
      'quarantine update drift: expected %, services %, organizations %, locations %',
      p_expected_service_count,
      v_service_updates,
      v_organization_updates,
      v_location_updates;
  END IF;

  UPDATE oran_internal.resource_quarantine_batches b
  SET actual_service_count = v_service_updates,
      actual_organization_count = v_organization_updates,
      actual_location_count = v_location_updates,
      member_checksum = v_checksum,
      status = 'applied',
      applied_at = v_now
  WHERE b.id = v_batch_id;

  RETURN QUERY
  SELECT v_batch_id,
         v_service_updates,
         v_organization_updates,
         v_location_updates,
         v_checksum;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.rollback_usda_snap_retailer_quarantine()
RETURNS TABLE (
  batch_id uuid,
  restored_services integer,
  restored_organizations integer,
  restored_locations integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_slug constant text := 'usda-fns-snap-retailer-2026-07';
  v_reason constant text := 'source_purpose:supporting_reference:usda_fns_snap_retailer';
  v_actor constant text := 'system:source-purpose-quarantine';
  v_rollback_actor constant text := 'system:source-purpose-quarantine-rollback';
  v_batch_id uuid;
  v_expected integer;
  v_invalid bigint;
  v_service_updates integer;
  v_organization_updates integer;
  v_location_updates integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:quarantine:usda-fns-snap-retailer-2026-07', 0)
  );

  SELECT b.id, b.actual_service_count
  INTO v_batch_id, v_expected
  FROM oran_internal.resource_quarantine_batches b
  WHERE b.slug = v_slug
    AND b.status = 'applied';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'applied quarantine batch % was not found', v_slug;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM oran_internal.resource_quarantine_members m
  JOIN public.services s ON s.id = m.service_id
  JOIN public.organizations o ON o.id = m.organization_id
  JOIN public.locations l ON l.id = m.location_id
  WHERE m.batch_id = v_batch_id
    AND (
      s.status <> 'inactive'
      OR s.integrity_hold_reason IS DISTINCT FROM v_reason
      OR s.integrity_held_by_user_id IS DISTINCT FROM v_actor
      OR o.status <> 'inactive'
      OR l.status <> 'inactive'
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'rollback refused: % quarantined resources have newer changes', v_invalid;
  END IF;

  UPDATE public.services s
  SET status = m.original_service_status,
      integrity_hold_at = m.original_integrity_hold_at,
      integrity_hold_reason = m.original_integrity_hold_reason,
      integrity_held_by_user_id = m.original_integrity_held_by_user_id,
      updated_at = v_now,
      updated_by_user_id = v_rollback_actor
  FROM oran_internal.resource_quarantine_members m
  WHERE m.batch_id = v_batch_id
    AND s.id = m.service_id;
  GET DIAGNOSTICS v_service_updates = ROW_COUNT;

  UPDATE public.organizations o
  SET status = m.original_organization_status,
      updated_at = v_now,
      updated_by_user_id = v_rollback_actor
  FROM oran_internal.resource_quarantine_members m
  WHERE m.batch_id = v_batch_id
    AND o.id = m.organization_id;
  GET DIAGNOSTICS v_organization_updates = ROW_COUNT;

  UPDATE public.locations l
  SET status = m.original_location_status,
      updated_at = v_now,
      updated_by_user_id = v_rollback_actor
  FROM oran_internal.resource_quarantine_members m
  WHERE m.batch_id = v_batch_id
    AND l.id = m.location_id;
  GET DIAGNOSTICS v_location_updates = ROW_COUNT;

  IF v_service_updates <> v_expected
     OR v_organization_updates <> v_expected
     OR v_location_updates <> v_expected THEN
    RAISE EXCEPTION
      'rollback update drift: expected %, services %, organizations %, locations %',
      v_expected,
      v_service_updates,
      v_organization_updates,
      v_location_updates;
  END IF;

  UPDATE oran_internal.resource_quarantine_batches b
  SET status = 'rolled_back',
      rolled_back_at = v_now
  WHERE b.id = v_batch_id;

  RETURN QUERY
  SELECT v_batch_id,
         v_service_updates,
         v_organization_updates,
         v_location_updates;
END
$function$;

REVOKE ALL ON FUNCTION oran_internal.apply_usda_snap_retailer_quarantine(integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.rollback_usda_snap_retailer_quarantine()
  FROM PUBLIC;

COMMENT ON SCHEMA oran_internal IS
  'Non-Data-API operational records and guarded maintenance routines for ORAN.';
COMMENT ON FUNCTION oran_internal.apply_usda_snap_retailer_quarantine(integer) IS
  'Applies the exact-count, dependency-safe USDA SNAP retailer quarantine.';
COMMENT ON FUNCTION oran_internal.rollback_usda_snap_retailer_quarantine() IS
  'Restores the audited USDA SNAP retailer batch only when no newer changes exist.';
