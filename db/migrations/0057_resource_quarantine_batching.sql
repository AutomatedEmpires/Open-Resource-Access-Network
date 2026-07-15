-- Resumable 5k-row quarantine execution for large resource corpora.

ALTER TABLE oran_internal.resource_quarantine_members
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resource_quarantine_batches_status_check'
      AND conrelid = 'oran_internal.resource_quarantine_batches'::regclass
  ) THEN
    ALTER TABLE oran_internal.resource_quarantine_batches
      DROP CONSTRAINT resource_quarantine_batches_status_check;
  END IF;

  ALTER TABLE oran_internal.resource_quarantine_batches
    ADD CONSTRAINT resource_quarantine_batches_status_check
    CHECK (status IN ('applying', 'applied', 'rolling_back', 'rolled_back'));
END
$$;

CREATE INDEX IF NOT EXISTS idx_resource_quarantine_members_pending
  ON oran_internal.resource_quarantine_members (batch_id, service_id)
  WHERE applied_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resource_quarantine_members_rollback_pending
  ON oran_internal.resource_quarantine_members (batch_id, service_id)
  WHERE applied_at IS NOT NULL AND rolled_back_at IS NULL;

CREATE OR REPLACE FUNCTION oran_internal.prepare_usda_snap_retailer_quarantine(
  p_expected_service_count integer DEFAULT 254048
)
RETURNS TABLE (
  batch_id uuid,
  snapshotted_services integer,
  snapshotted_organizations integer,
  snapshotted_locations integer,
  checksum text,
  batch_status text
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
    RETURN QUERY
    SELECT b.id,
           b.actual_service_count,
           b.actual_organization_count,
           b.actual_location_count,
           b.member_checksum,
           b.status
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
     OR t.original_integrity_held_by_user_id IS NOT NULL
     OR NOT EXISTS (
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
    RAISE EXCEPTION 'quarantine refused: % targets failed state or source checks', v_invalid;
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
    actual_service_count,
    actual_organization_count,
    actual_location_count,
    member_checksum,
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
    v_distinct_services,
    v_distinct_organizations,
    v_distinct_locations,
    v_checksum,
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

  RETURN QUERY
  SELECT v_batch_id,
         v_distinct_services::integer,
         v_distinct_organizations::integer,
         v_distinct_locations::integer,
         v_checksum,
         'applying'::text;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.apply_usda_snap_retailer_quarantine_chunk(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  batch_id uuid,
  applied_in_chunk integer,
  remaining_services bigint,
  batch_status text
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
  v_chunk_count integer;
  v_service_updates integer;
  v_organization_updates integer;
  v_location_updates integer;
  v_remaining bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'chunk limit must be between 1 and 10000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:quarantine:usda-fns-snap-retailer-2026-07', 0)
  );

  SELECT b.id, b.status
  INTO v_batch_id, v_status
  FROM oran_internal.resource_quarantine_batches b
  WHERE b.slug = v_slug;

  IF NOT FOUND OR v_status NOT IN ('applying', 'applied') THEN
    RAISE EXCEPTION 'quarantine batch is not prepared for application';
  END IF;

  IF v_status = 'applied' THEN
    RETURN QUERY SELECT v_batch_id, 0, 0::bigint, v_status;
    RETURN;
  END IF;

  CREATE TEMP TABLE oran_quarantine_chunk ON COMMIT DROP AS
  SELECT m.service_id, m.organization_id, m.location_id,
         m.original_service_status,
         m.original_organization_status,
         m.original_location_status,
         m.original_integrity_hold_at,
         m.original_integrity_hold_reason,
         m.original_integrity_held_by_user_id
  FROM oran_internal.resource_quarantine_members m
  WHERE m.batch_id = v_batch_id
    AND m.applied_at IS NULL
  ORDER BY m.service_id
  LIMIT p_limit;

  SELECT count(*) INTO v_chunk_count FROM pg_temp.oran_quarantine_chunk;

  IF v_chunk_count = 0 THEN
    UPDATE oran_internal.resource_quarantine_batches b
    SET status = 'applied', applied_at = COALESCE(b.applied_at, v_now)
    WHERE b.id = v_batch_id;
    RETURN QUERY SELECT v_batch_id, 0, 0::bigint, 'applied'::text;
    RETURN;
  END IF;

  UPDATE public.services s
  SET status = 'inactive',
      integrity_hold_at = v_now,
      integrity_hold_reason = v_reason,
      integrity_held_by_user_id = v_actor,
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM pg_temp.oran_quarantine_chunk c
  WHERE s.id = c.service_id
    AND s.status = c.original_service_status
    AND s.integrity_hold_at IS NOT DISTINCT FROM c.original_integrity_hold_at
    AND s.integrity_hold_reason IS NOT DISTINCT FROM c.original_integrity_hold_reason
    AND s.integrity_held_by_user_id IS NOT DISTINCT FROM c.original_integrity_held_by_user_id;
  GET DIAGNOSTICS v_service_updates = ROW_COUNT;

  UPDATE public.organizations o
  SET status = 'inactive',
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM pg_temp.oran_quarantine_chunk c
  WHERE o.id = c.organization_id
    AND o.status = c.original_organization_status;
  GET DIAGNOSTICS v_organization_updates = ROW_COUNT;

  UPDATE public.locations l
  SET status = 'inactive',
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM pg_temp.oran_quarantine_chunk c
  WHERE l.id = c.location_id
    AND l.status = c.original_location_status;
  GET DIAGNOSTICS v_location_updates = ROW_COUNT;

  IF v_service_updates <> v_chunk_count
     OR v_organization_updates <> v_chunk_count
     OR v_location_updates <> v_chunk_count THEN
    RAISE EXCEPTION
      'quarantine chunk drift: expected %, services %, organizations %, locations %',
      v_chunk_count,
      v_service_updates,
      v_organization_updates,
      v_location_updates;
  END IF;

  UPDATE oran_internal.resource_quarantine_members m
  SET applied_at = v_now
  FROM pg_temp.oran_quarantine_chunk c
  WHERE m.batch_id = v_batch_id
    AND m.service_id = c.service_id
    AND m.applied_at IS NULL;

  SELECT count(*)
  INTO v_remaining
  FROM oran_internal.resource_quarantine_members m
  WHERE m.batch_id = v_batch_id
    AND m.applied_at IS NULL;

  IF v_remaining = 0 THEN
    UPDATE oran_internal.resource_quarantine_batches b
    SET status = 'applied', applied_at = v_now
    WHERE b.id = v_batch_id;
    v_status := 'applied';
  ELSE
    v_status := 'applying';
  END IF;

  RETURN QUERY SELECT v_batch_id, v_chunk_count, v_remaining, v_status;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.rollback_usda_snap_retailer_quarantine_chunk(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  batch_id uuid,
  restored_in_chunk integer,
  remaining_services bigint,
  batch_status text
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
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_chunk_count integer;
  v_invalid bigint;
  v_service_updates integer;
  v_organization_updates integer;
  v_location_updates integer;
  v_remaining bigint;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'chunk limit must be between 1 and 10000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:quarantine:usda-fns-snap-retailer-2026-07', 0)
  );

  SELECT b.id, b.status
  INTO v_batch_id, v_status
  FROM oran_internal.resource_quarantine_batches b
  WHERE b.slug = v_slug;

  IF NOT FOUND OR v_status NOT IN ('applied', 'rolling_back', 'rolled_back') THEN
    RAISE EXCEPTION 'quarantine batch is not ready for rollback';
  END IF;

  IF v_status = 'rolled_back' THEN
    RETURN QUERY SELECT v_batch_id, 0, 0::bigint, v_status;
    RETURN;
  END IF;

  UPDATE oran_internal.resource_quarantine_batches b
  SET status = 'rolling_back'
  WHERE b.id = v_batch_id
    AND b.status = 'applied';

  CREATE TEMP TABLE oran_quarantine_rollback_chunk ON COMMIT DROP AS
  SELECT m.*
  FROM oran_internal.resource_quarantine_members m
  WHERE m.batch_id = v_batch_id
    AND m.applied_at IS NOT NULL
    AND m.rolled_back_at IS NULL
  ORDER BY m.service_id
  LIMIT p_limit;

  SELECT count(*) INTO v_chunk_count FROM pg_temp.oran_quarantine_rollback_chunk;

  IF v_chunk_count = 0 THEN
    UPDATE oran_internal.resource_quarantine_batches b
    SET status = 'rolled_back', rolled_back_at = COALESCE(b.rolled_back_at, v_now)
    WHERE b.id = v_batch_id;
    RETURN QUERY SELECT v_batch_id, 0, 0::bigint, 'rolled_back'::text;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM pg_temp.oran_quarantine_rollback_chunk c
  JOIN public.services s ON s.id = c.service_id
  JOIN public.organizations o ON o.id = c.organization_id
  JOIN public.locations l ON l.id = c.location_id
  WHERE s.status <> 'inactive'
     OR s.integrity_hold_reason IS DISTINCT FROM v_reason
     OR s.integrity_held_by_user_id IS DISTINCT FROM v_actor
     OR o.status <> 'inactive'
     OR l.status <> 'inactive';

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'rollback refused: % resources in the chunk have newer changes', v_invalid;
  END IF;

  UPDATE public.services s
  SET status = c.original_service_status,
      integrity_hold_at = c.original_integrity_hold_at,
      integrity_hold_reason = c.original_integrity_hold_reason,
      integrity_held_by_user_id = c.original_integrity_held_by_user_id,
      updated_at = v_now,
      updated_by_user_id = v_rollback_actor
  FROM pg_temp.oran_quarantine_rollback_chunk c
  WHERE s.id = c.service_id;
  GET DIAGNOSTICS v_service_updates = ROW_COUNT;

  UPDATE public.organizations o
  SET status = c.original_organization_status,
      updated_at = v_now,
      updated_by_user_id = v_rollback_actor
  FROM pg_temp.oran_quarantine_rollback_chunk c
  WHERE o.id = c.organization_id;
  GET DIAGNOSTICS v_organization_updates = ROW_COUNT;

  UPDATE public.locations l
  SET status = c.original_location_status,
      updated_at = v_now,
      updated_by_user_id = v_rollback_actor
  FROM pg_temp.oran_quarantine_rollback_chunk c
  WHERE l.id = c.location_id;
  GET DIAGNOSTICS v_location_updates = ROW_COUNT;

  IF v_service_updates <> v_chunk_count
     OR v_organization_updates <> v_chunk_count
     OR v_location_updates <> v_chunk_count THEN
    RAISE EXCEPTION
      'rollback chunk drift: expected %, services %, organizations %, locations %',
      v_chunk_count,
      v_service_updates,
      v_organization_updates,
      v_location_updates;
  END IF;

  UPDATE oran_internal.resource_quarantine_members m
  SET rolled_back_at = v_now
  FROM pg_temp.oran_quarantine_rollback_chunk c
  WHERE m.batch_id = v_batch_id
    AND m.service_id = c.service_id
    AND m.rolled_back_at IS NULL;

  SELECT count(*)
  INTO v_remaining
  FROM oran_internal.resource_quarantine_members m
  WHERE m.batch_id = v_batch_id
    AND m.applied_at IS NOT NULL
    AND m.rolled_back_at IS NULL;

  IF v_remaining = 0 THEN
    UPDATE oran_internal.resource_quarantine_batches b
    SET status = 'rolled_back', rolled_back_at = v_now
    WHERE b.id = v_batch_id;
    v_status := 'rolled_back';
  ELSE
    v_status := 'rolling_back';
  END IF;

  RETURN QUERY SELECT v_batch_id, v_chunk_count, v_remaining, v_status;
END
$function$;

REVOKE ALL ON FUNCTION oran_internal.prepare_usda_snap_retailer_quarantine(integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.apply_usda_snap_retailer_quarantine_chunk(integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.rollback_usda_snap_retailer_quarantine_chunk(integer)
  FROM PUBLIC;

COMMENT ON FUNCTION oran_internal.prepare_usda_snap_retailer_quarantine(integer) IS
  'Snapshots and validates the exact USDA retailer batch without changing visibility.';
COMMENT ON FUNCTION oran_internal.apply_usda_snap_retailer_quarantine_chunk(integer) IS
  'Resumably quarantines a bounded, audited batch of retailer-only records.';
COMMENT ON FUNCTION oran_internal.rollback_usda_snap_retailer_quarantine_chunk(integer) IS
  'Resumably restores a bounded chunk, refusing to overwrite newer changes.';
