-- Disposable-database-only executable regression for account-erasure paging.
-- Run only with an explicit opt-in, for example:
-- psql "$LOCAL_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--   -v allow_disposable_account_erasure_plan_test=true \
--   -f scripts/db/validate-account-erasure-plans.sql

\set ON_ERROR_STOP on
\if :{?allow_disposable_account_erasure_plan_test}
\else
  \echo 'refusing: set allow_disposable_account_erasure_plan_test=true'
  \quit false
\endif
\if :allow_disposable_account_erasure_plan_test
\else
  \echo 'refusing: disposable account-erasure plan test was not confirmed'
  \quit false
\endif

BEGIN;
SET LOCAL statement_timeout = '2min';

DO $seed_unrelated_corpus$
DECLARE
  v_organization_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO public.organizations (id, name, created_by_user_id, updated_by_user_id)
  VALUES (
    v_organization_id,
    'Disposable account-erasure plan fixture',
    'import:plan-unrelated',
    'import:plan-unrelated'
  );

  INSERT INTO public.services (
    id, organization_id, name, created_by_user_id, updated_by_user_id
  )
  SELECT pg_catalog.gen_random_uuid(),
         v_organization_id,
         'Unrelated imported service ' || series.number,
         'import:plan-unrelated',
         'import:plan-unrelated'
  FROM pg_catalog.generate_series(1, 50000) series(number);

  INSERT INTO public.audit_logs (action, resource_type, after)
  SELECT 'unrelated_test',
         'test',
         pg_catalog.jsonb_build_object(
           'message', 'unrelated imported audit ' || series.number
         )
  FROM pg_catalog.generate_series(1, 50000) series(number);
END
$seed_unrelated_corpus$;

ANALYZE public.services;
ANALYZE public.audit_logs;

DO $assert_matching_subset_plan$
DECLARE
  v_plan json;
  v_plan_text text;
BEGIN
  EXECUTE $explain$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT id
    FROM public.services
    WHERE ARRAY[
            created_by_user_id,
            updated_by_user_id,
            integrity_held_by_user_id
          ] @> ARRAY['user-plan-no-match']
      AND (
        (created_by_user_id IS NOT NULL
         AND created_by_user_id !~ '^import:')
        OR (updated_by_user_id IS NOT NULL
            AND updated_by_user_id !~ '^import:')
        OR (integrity_held_by_user_id IS NOT NULL
            AND integrity_held_by_user_id !~ '^import:')
      )
    ORDER BY id DESC
    LIMIT 1000
  $explain$
  INTO v_plan;

  v_plan_text := v_plan::text;
  IF pg_catalog.strpos(v_plan_text, 'idx_ae_services_human_actors') = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'account-erasure selector did not use the matching-subset index',
      DETAIL = v_plan_text;
  END IF;
  IF pg_catalog.strpos(v_plan_text, '"Actual Rows": 0') = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'zero-match account-erasure selector returned unrelated rows',
      DETAIL = v_plan_text;
  END IF;
END
$assert_matching_subset_plan$;

DO $assert_json_matching_subset_plan$
DECLARE
  v_plan json;
  v_plan_text text;
BEGIN
  EXECUTE $explain$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT id
    FROM public.audit_logs
    WHERE actor_user_id = 'user-json-no-match'
       OR before::text ~ 'user-json-no-match|user_clerk_no_match|11111111-1111-4111-8111-111111111111'
       OR after::text ~ 'user-json-no-match|user_clerk_no_match|11111111-1111-4111-8111-111111111111'
    ORDER BY id DESC
    LIMIT 1000
  $explain$
  INTO v_plan;

  v_plan_text := v_plan::text;
  IF pg_catalog.strpos(v_plan_text, 'idx_ae_audit_after_trgm') = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'JSON erasure selector did not use the trigram identity index',
      DETAIL = v_plan_text;
  END IF;
  IF pg_catalog.strpos(v_plan_text, '"Actual Rows": 0') = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'zero-match JSON erasure selector returned unrelated rows',
      DETAIL = v_plan_text;
  END IF;
END
$assert_json_matching_subset_plan$;

ROLLBACK;
