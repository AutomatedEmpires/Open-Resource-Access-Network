-- Atomic chat usage controls for horizontally scaled Vercel runtimes.
--
-- Successful non-crisis responses are recorded as rolling usage events:
--   * anonymous device: 10 events / trailing 24 hours
--   * authenticated request: 20 events / trailing 24 hours, enforced against
--     both the account and its device key
--
-- Capacity is reserved before search and finalized only after a chargeable
-- response. This closes concurrent overshoot without charging crisis,
-- distress-safe, temporarily unavailable, or error responses.

CREATE SCHEMA IF NOT EXISTS oran_internal;
REVOKE ALL ON SCHEMA oran_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS oran_internal.chat_usage_events (
  identity_key   text        NOT NULL
    CHECK (char_length(identity_key) BETWEEN 8 AND 96),
  request_id     uuid        NOT NULL,
  state          text        NOT NULL
    CHECK (state IN ('reserved', 'consumed')),
  reserved_until timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_key, request_id),
  CHECK (
    (state = 'reserved' AND consumed_at IS NULL)
    OR (state = 'consumed' AND consumed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_chat_usage_events_consumed
  ON oran_internal.chat_usage_events (identity_key, consumed_at)
  WHERE state = 'consumed';

CREATE INDEX IF NOT EXISTS idx_chat_usage_events_reserved
  ON oran_internal.chat_usage_events (identity_key, reserved_until)
  WHERE state = 'reserved';

CREATE INDEX IF NOT EXISTS idx_chat_usage_events_created
  ON oran_internal.chat_usage_events (created_at);

CREATE TABLE IF NOT EXISTS oran_internal.chat_rate_limit_windows (
  rate_key          text        PRIMARY KEY
    CHECK (char_length(rate_key) BETWEEN 8 AND 96),
  request_count     integer     NOT NULL CHECK (request_count > 0),
  window_started_at timestamptz NOT NULL,
  reset_at          timestamptz NOT NULL,
  CHECK (reset_at > window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_chat_rate_limit_windows_reset
  ON oran_internal.chat_rate_limit_windows (reset_at);

CREATE TABLE IF NOT EXISTS oran_internal.chat_inflight_leases (
  identity_key text        PRIMARY KEY
    CHECK (char_length(identity_key) BETWEEN 8 AND 96),
  request_id   uuid        NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_inflight_leases_expires
  ON oran_internal.chat_inflight_leases (expires_at);

REVOKE ALL ON ALL TABLES IN SCHEMA oran_internal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA oran_internal FROM PUBLIC;

CREATE OR REPLACE FUNCTION oran_internal.check_chat_quota(
  p_device_key text,
  p_user_key text,
  p_quota_window_seconds integer
)
RETURNS TABLE (
  quota_remaining integer,
  quota_reset_at timestamptz,
  message_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_keys text[];
  v_limit integer;
  v_count integer := 0;
  v_reset_at timestamptz;
BEGIN
  IF p_quota_window_seconds IS NULL
     OR p_quota_window_seconds < 60
     OR p_quota_window_seconds > 172800 THEN
    RAISE EXCEPTION 'quota window seconds are outside the allowed range';
  END IF;

  IF p_device_key IS NOT NULL
     AND char_length(p_device_key) NOT BETWEEN 8 AND 96 THEN
    RAISE EXCEPTION 'invalid device key';
  END IF;

  IF p_user_key IS NOT NULL
     AND char_length(p_user_key) NOT BETWEEN 8 AND 96 THEN
    RAISE EXCEPTION 'invalid user key';
  END IF;

  v_keys := array_remove(ARRAY[p_user_key, p_device_key]::text[], NULL);
  v_limit := CASE WHEN p_user_key IS NULL THEN 10 ELSE 20 END;

  IF coalesce(array_length(v_keys, 1), 0) = 0 THEN
    RETURN QUERY SELECT v_limit, NULL::timestamptz, 0;
    RETURN;
  END IF;

  WITH per_identity AS (
    SELECT
      keys.identity_key,
      count(events.request_id)::integer AS usage_count,
      min(
        CASE
          WHEN events.state = 'consumed'
            THEN events.consumed_at
              + make_interval(secs => p_quota_window_seconds)
          ELSE events.reserved_until
        END
      ) AS earliest_reset
    FROM unnest(v_keys) AS keys(identity_key)
    LEFT JOIN oran_internal.chat_usage_events AS events
      ON events.identity_key = keys.identity_key
     AND (
       (events.state = 'consumed'
         AND events.consumed_at > v_now
           - make_interval(secs => p_quota_window_seconds))
       OR (events.state = 'reserved' AND events.reserved_until > v_now)
     )
    GROUP BY keys.identity_key
  )
  SELECT usage_count, earliest_reset
  INTO v_count, v_reset_at
  FROM per_identity
  ORDER BY usage_count DESC, earliest_reset ASC NULLS LAST
  LIMIT 1;

  RETURN QUERY
  SELECT greatest(0, v_limit - coalesce(v_count, 0)),
         v_reset_at,
         coalesce(v_count, 0);
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.reserve_chat_request(
  p_request_id uuid,
  p_device_key text,
  p_user_key text,
  p_rate_key text,
  p_quota_window_seconds integer,
  p_rate_window_seconds integer,
  p_rate_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  decision text,
  quota_remaining integer,
  quota_reset_at timestamptz,
  message_count integer,
  retry_after_seconds integer,
  rate_count integer,
  rate_reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_keys text[];
  v_lock_key text;
  v_rate_count integer;
  v_rate_reset_at timestamptz;
  v_quota_remaining integer;
  v_quota_reset_at timestamptz;
  v_message_count integer;
  v_inflight_reset_at timestamptz;
  v_retry_after integer;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id is required';
  END IF;

  IF p_device_key IS NULL OR char_length(p_device_key) NOT BETWEEN 8 AND 96 THEN
    RAISE EXCEPTION 'valid device key is required';
  END IF;

  IF p_user_key IS NOT NULL
     AND char_length(p_user_key) NOT BETWEEN 8 AND 96 THEN
    RAISE EXCEPTION 'invalid user key';
  END IF;

  IF p_rate_key IS NULL OR char_length(p_rate_key) NOT BETWEEN 8 AND 96 THEN
    RAISE EXCEPTION 'valid rate key is required';
  END IF;

  IF p_quota_window_seconds IS NULL
     OR p_quota_window_seconds < 60
     OR p_quota_window_seconds > 172800
     OR p_rate_window_seconds IS NULL
     OR p_rate_window_seconds < 10
     OR p_rate_window_seconds > 3600
     OR p_rate_limit IS NULL
     OR p_rate_limit < 1
     OR p_rate_limit > 60
     OR p_lease_seconds IS NULL
     OR p_lease_seconds < 30
     OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'usage-control settings are outside the allowed range';
  END IF;

  v_keys := array_remove(ARRAY[p_user_key, p_device_key]::text[], NULL);

  -- Every mutation for these identities and the rate key follows the same
  -- sorted advisory-lock order. Concurrent Vercel instances therefore cannot
  -- both observe spare quota and reserve the final slot.
  FOR v_lock_key IN
    SELECT DISTINCT locks.lock_key
    FROM unnest(v_keys || ARRAY['rate:' || p_rate_key]) AS locks(lock_key)
    ORDER BY locks.lock_key
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('oran:chat-usage:' || v_lock_key, 0)
    );
  END LOOP;

  INSERT INTO oran_internal.chat_rate_limit_windows AS windows (
    rate_key,
    request_count,
    window_started_at,
    reset_at
  )
  VALUES (
    p_rate_key,
    1,
    v_now,
    v_now + make_interval(secs => p_rate_window_seconds)
  )
  ON CONFLICT (rate_key) DO UPDATE
  SET request_count = CASE
        WHEN windows.reset_at <= v_now THEN 1
        ELSE least(windows.request_count + 1, p_rate_limit + 1)
      END,
      window_started_at = CASE
        WHEN windows.reset_at <= v_now THEN v_now
        ELSE windows.window_started_at
      END,
      reset_at = CASE
        WHEN windows.reset_at <= v_now
          THEN v_now + make_interval(secs => p_rate_window_seconds)
        ELSE windows.reset_at
      END
  RETURNING windows.request_count, windows.reset_at
  INTO v_rate_count, v_rate_reset_at;

  SELECT checked.quota_remaining,
         checked.quota_reset_at,
         checked.message_count
  INTO v_quota_remaining, v_quota_reset_at, v_message_count
  FROM oran_internal.check_chat_quota(
    p_device_key,
    p_user_key,
    p_quota_window_seconds
  ) AS checked;

  IF v_rate_count > p_rate_limit THEN
    v_retry_after := greatest(
      1,
      ceil(extract(epoch FROM (v_rate_reset_at - v_now)))::integer
    );
    RETURN QUERY
    SELECT 'rate_limited'::text,
           v_quota_remaining,
           v_quota_reset_at,
           v_message_count,
           v_retry_after,
           v_rate_count,
           v_rate_reset_at;
    RETURN;
  END IF;

  SELECT min(leases.expires_at)
  INTO v_inflight_reset_at
  FROM oran_internal.chat_inflight_leases AS leases
  WHERE leases.identity_key = ANY(v_keys)
    AND leases.expires_at > v_now
    AND leases.request_id <> p_request_id;

  IF v_inflight_reset_at IS NOT NULL THEN
    v_retry_after := greatest(
      1,
      ceil(extract(epoch FROM (v_inflight_reset_at - v_now)))::integer
    );
    RETURN QUERY
    SELECT 'in_flight'::text,
           v_quota_remaining,
           v_quota_reset_at,
           v_message_count,
           v_retry_after,
           v_rate_count,
           v_rate_reset_at;
    RETURN;
  END IF;

  DELETE FROM oran_internal.chat_usage_events AS events
  WHERE events.identity_key = ANY(v_keys)
    AND (
      (events.state = 'reserved' AND events.reserved_until <= v_now)
      OR (events.state = 'consumed'
        AND events.consumed_at <= v_now
          - make_interval(secs => p_quota_window_seconds))
    );

  SELECT checked.quota_remaining,
         checked.quota_reset_at,
         checked.message_count
  INTO v_quota_remaining, v_quota_reset_at, v_message_count
  FROM oran_internal.check_chat_quota(
    p_device_key,
    p_user_key,
    p_quota_window_seconds
  ) AS checked;

  IF v_quota_remaining <= 0 THEN
    v_retry_after := CASE
      WHEN v_quota_reset_at IS NULL
        THEN p_quota_window_seconds
      ELSE greatest(
        1,
        ceil(extract(epoch FROM (v_quota_reset_at - v_now)))::integer
      )
    END;
    RETURN QUERY
    SELECT 'quota_exceeded'::text,
           0,
           v_quota_reset_at,
           v_message_count,
           v_retry_after,
           v_rate_count,
           v_rate_reset_at;
    RETURN;
  END IF;

  INSERT INTO oran_internal.chat_inflight_leases AS leases (
    identity_key,
    request_id,
    expires_at
  )
  SELECT keys.identity_key,
         p_request_id,
         v_now + make_interval(secs => p_lease_seconds)
  FROM unnest(v_keys) AS keys(identity_key)
  ON CONFLICT (identity_key) DO UPDATE
  SET request_id = EXCLUDED.request_id,
      expires_at = EXCLUDED.expires_at,
      created_at = v_now;

  INSERT INTO oran_internal.chat_usage_events (
    identity_key,
    request_id,
    state,
    reserved_until
  )
  SELECT keys.identity_key,
         p_request_id,
         'reserved',
         v_now + make_interval(secs => p_lease_seconds)
  FROM unnest(v_keys) AS keys(identity_key)
  ON CONFLICT (identity_key, request_id) DO NOTHING;

  SELECT checked.quota_remaining,
         checked.quota_reset_at,
         checked.message_count
  INTO v_quota_remaining, v_quota_reset_at, v_message_count
  FROM oran_internal.check_chat_quota(
    p_device_key,
    p_user_key,
    p_quota_window_seconds
  ) AS checked;

  v_retry_after := greatest(
    1,
    ceil(extract(epoch FROM (v_rate_reset_at - v_now)))::integer
  );
  RETURN QUERY
  SELECT 'allowed'::text,
         v_quota_remaining,
         v_quota_reset_at,
         v_message_count,
         v_retry_after,
         v_rate_count,
         v_rate_reset_at;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.finalize_chat_request(
  p_request_id uuid,
  p_consume boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_affected integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_id IS NULL OR p_consume IS NULL THEN
    RAISE EXCEPTION 'request id and consume decision are required';
  END IF;

  IF p_consume THEN
    UPDATE oran_internal.chat_usage_events AS events
    SET state = 'consumed',
        consumed_at = v_now
    WHERE events.request_id = p_request_id
      AND events.state = 'reserved';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  ELSE
    DELETE FROM oran_internal.chat_usage_events AS events
    WHERE events.request_id = p_request_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  END IF;

  DELETE FROM oran_internal.chat_inflight_leases AS leases
  WHERE leases.request_id = p_request_id;

  RETURN v_affected;
END
$function$;

REVOKE ALL ON FUNCTION oran_internal.check_chat_quota(text, text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.reserve_chat_request(
  uuid, text, text, text, integer, integer, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.finalize_chat_request(uuid, boolean)
  FROM PUBLIC;

-- The application connects through the dedicated no-DDL ORAN runtime login.
-- Keep the functions unavailable to Data API roles and expose only EXECUTE to
-- that private connection role when it exists.
DO $grant_runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'oran_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA oran_internal TO oran_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION oran_internal.check_chat_quota(text, text, integer) TO oran_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION oran_internal.reserve_chat_request(uuid, text, text, text, integer, integer, integer, integer) TO oran_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION oran_internal.finalize_chat_request(uuid, boolean) TO oran_runtime';
  END IF;
END
$grant_runtime$;

COMMENT ON TABLE oran_internal.chat_usage_events IS
  'Opaque, rolling successful-chat usage plus short-lived pre-response reservations.';
COMMENT ON TABLE oran_internal.chat_rate_limit_windows IS
  'Atomic shared chat request windows for horizontally scaled application instances.';
COMMENT ON TABLE oran_internal.chat_inflight_leases IS
  'Short-lived per-account and per-device leases preventing overlapping chat work.';
COMMENT ON FUNCTION oran_internal.reserve_chat_request(
  uuid, text, text, text, integer, integer, integer, integer
) IS
  'Atomically rate-limits and reserves rolling quota for one chat request.';
COMMENT ON FUNCTION oran_internal.finalize_chat_request(uuid, boolean) IS
  'Commits chargeable chat usage or releases an unchargeable/error reservation.';
