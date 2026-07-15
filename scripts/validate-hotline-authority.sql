-- Read-only production check for migration 0065.
-- Run with a role permitted to execute oran_internal maintenance functions.
BEGIN TRANSACTION READ ONLY;

DO $validation$
DECLARE
  v_exact_trigger_count bigint;
BEGIN
  SELECT count(*) INTO v_exact_trigger_count
  FROM pg_catalog.pg_trigger t
  WHERE t.tgname = 'trg_protect_verified_hotline_source_records'
    AND t.tgrelid = 'public.source_records'::pg_catalog.regclass
    AND t.tgfoid =
      'oran_internal.protect_verified_hotline_source_records()'::pg_catalog.regprocedure
    AND t.tgtype = 27
    AND t.tgenabled = 'O'
    AND t.tgisinternal IS FALSE
    AND t.tgnargs = 0
    AND t.tgqual IS NULL
    AND t.tgparentid = 0;

  IF v_exact_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'verified hotline immutability trigger definition drift: expected 1 exact trigger, found %',
      v_exact_trigger_count;
  END IF;
END
$validation$;

SELECT oran_internal.assert_verified_hotline_authority('applied');

ROLLBACK;
