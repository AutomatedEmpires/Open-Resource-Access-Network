-- Atomic shared rate limiting for horizontally scaled application routes.
--
-- Raw caller identifiers are hashed in the application before this boundary.
-- The table remains private; the dedicated backend login can execute only the
-- bounded mutation function and receives no direct relation privileges.

BEGIN;

CREATE SCHEMA IF NOT EXISTS oran_internal;
REVOKE ALL ON SCHEMA oran_internal FROM PUBLIC, anon, authenticated, service_role, oran_runtime;

CREATE TABLE IF NOT EXISTS oran_internal.shared_rate_limit_windows (
  rate_key          text        PRIMARY KEY
    CHECK (
      pg_catalog.char_length(rate_key) = 64
      AND rate_key ~ '^[0-9a-f]{64}$'
    ),
  request_count     integer     NOT NULL CHECK (request_count > 0),
  window_started_at timestamptz NOT NULL,
  reset_at          timestamptz NOT NULL,
  CHECK (reset_at > window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_shared_rate_limit_windows_reset
  ON oran_internal.shared_rate_limit_windows (reset_at);

ALTER TABLE oran_internal.shared_rate_limit_windows ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE oran_internal.shared_rate_limit_windows
  FROM PUBLIC, anon, authenticated, service_role, oran_runtime, oran_backend_runtime;

CREATE OR REPLACE FUNCTION oran_internal.consume_shared_rate_limit(
  p_rate_key text,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS TABLE (
  request_count integer,
  window_started_at timestamptz,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_count integer;
  v_window_started_at timestamptz;
  v_reset_at timestamptz;
BEGIN
  IF p_rate_key IS NULL
     OR pg_catalog.char_length(p_rate_key) <> 64
     OR p_rate_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid shared rate-limit key';
  END IF;

  IF p_window_seconds IS NULL
     OR p_window_seconds < 1
     OR p_window_seconds > 86400
     OR p_max_requests IS NULL
     OR p_max_requests < 1
     OR p_max_requests > 10000 THEN
    RAISE EXCEPTION 'shared rate-limit settings are outside the allowed range';
  END IF;

  -- The primary-key conflict serializes concurrent mutations for one key. The
  -- count is capped at limit + 1 because callers need only the exceeded state.
  INSERT INTO oran_internal.shared_rate_limit_windows AS windows (
    rate_key,
    request_count,
    window_started_at,
    reset_at
  )
  VALUES (
    p_rate_key,
    1,
    v_now,
    v_now + pg_catalog.make_interval(secs => p_window_seconds)
  )
  ON CONFLICT (rate_key) DO UPDATE
  SET request_count = CASE
        WHEN windows.reset_at <= v_now THEN 1
        ELSE least(windows.request_count + 1, p_max_requests + 1)
      END,
      window_started_at = CASE
        WHEN windows.reset_at <= v_now THEN v_now
        ELSE windows.window_started_at
      END,
      reset_at = CASE
        WHEN windows.reset_at <= v_now
          THEN v_now + pg_catalog.make_interval(secs => p_window_seconds)
        ELSE windows.reset_at
      END
  RETURNING windows.request_count, windows.window_started_at, windows.reset_at
  INTO v_request_count, v_window_started_at, v_reset_at;

  -- Opportunistic bounded cleanup avoids retaining expired opaque keys forever
  -- without adding another required scheduler. SKIP LOCKED keeps cleanup from
  -- waiting on a caller whose window is being refreshed concurrently.
  IF pg_catalog.random() < 0.01 THEN
    DELETE FROM oran_internal.shared_rate_limit_windows AS expired
    WHERE expired.ctid IN (
      SELECT candidates.ctid
      FROM oran_internal.shared_rate_limit_windows AS candidates
      WHERE candidates.reset_at < v_now - pg_catalog.make_interval(hours => 24)
      ORDER BY candidates.reset_at
      LIMIT 250
      FOR UPDATE SKIP LOCKED
    );
  END IF;

  RETURN QUERY
  SELECT v_request_count, v_window_started_at, v_reset_at;
END
$function$;

REVOKE ALL PRIVILEGES
  ON FUNCTION oran_internal.consume_shared_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role, oran_runtime, oran_backend_runtime;

GRANT EXECUTE
  ON FUNCTION oran_internal.consume_shared_rate_limit(text, integer, integer)
  TO oran_backend_runtime;

COMMIT;
