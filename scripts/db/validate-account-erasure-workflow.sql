-- Disposable-database-only executable account-erasure regression.
-- Requires the same explicit opt-in convention as the plan validator.

\set ON_ERROR_STOP on
\if :{?allow_disposable_account_erasure_workflow_test}
\else
  \echo 'refusing: set allow_disposable_account_erasure_workflow_test=true'
  \quit false
\endif
\if :allow_disposable_account_erasure_workflow_test
\else
  \echo 'refusing: disposable account-erasure workflow test was not confirmed'
  \quit false
\endif

BEGIN;
SET LOCAL statement_timeout = '2min';

DO $account_erasure_workflow_test$
DECLARE
  v_user_id text := 'workflow-erasure-user';
  v_clerk_user_id text := 'user_workflow_erasure_clerk';
  v_text_tombstone text :=
    'deleted-user:' || pg_catalog.gen_random_uuid()::text;
  v_uuid_tombstone uuid := pg_catalog.gen_random_uuid();
  v_request_id uuid;
  v_completed boolean := false;
  v_status text;
  v_step_status text;
  v_iteration integer;
BEGIN
  INSERT INTO public.user_profiles (user_id, clerk_user_id, auth_provider)
  VALUES (v_user_id, v_clerk_user_id, 'clerk');

  SELECT request_id INTO v_request_id
  FROM oran_internal.queue_account_erasure(
    v_user_id, v_clerk_user_id, v_text_tombstone, v_uuid_tombstone
  );

  IF NOT oran_internal.is_account_erased(v_clerk_user_id) THEN
    RAISE EXCEPTION 'queued identity was not revoked immediately';
  END IF;
  IF (SELECT account_status FROM public.user_profiles WHERE user_id = v_user_id)
       IS DISTINCT FROM 'frozen' THEN
    RAISE EXCEPTION 'queue did not synchronously freeze access';
  END IF;

  PERFORM oran_internal.mark_clerk_account_deleted(
    v_request_id, v_user_id, v_clerk_user_id
  );
  PERFORM * FROM oran_internal.process_account_erasure_page(v_request_id, 500);
  PERFORM * FROM oran_internal.process_account_erasure_page(v_request_id, 500);
  SELECT status INTO v_step_status
  FROM oran_internal.account_erasure_steps
  WHERE request_id = v_request_id AND step_name = 'saved_collections';
  IF v_step_status IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'zero-match step did not complete its verification pass';
  END IF;

  -- A caller-set custom GUC cannot bypass the SECURITY DEFINER trigger. This
  -- simulates the global race where an already-finished step is repopulated.
  PERFORM pg_catalog.set_config('oran.erasure_control', 'on', true);
  BEGIN
    INSERT INTO public.saved_collections (user_id, name)
    VALUES (v_user_id, 'must be rejected');
    RAISE EXCEPTION 'blocked identity was reintroduced after step completion';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Embedded fragments and JSON object keys are checked, not only exact scalar
  -- leaves. The row is otherwise structurally valid.
  BEGIN
    INSERT INTO public.audit_logs (action, resource_type, after)
    VALUES (
      'test',
      'test',
      pg_catalog.jsonb_build_object(
        'prefix-' || v_user_id || '-suffix',
        'embedded/' || v_clerk_user_id || '/value'
      )
    );
    RAISE EXCEPTION 'embedded blocked JSON identity was reintroduced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  FOR v_iteration IN 1..250
  LOOP
    SELECT page.completed, page.request_status
    INTO v_completed, v_status
    FROM oran_internal.process_account_erasure_page(v_request_id, 500) page;
    EXIT WHEN v_completed;
    IF v_status = 'blocked' THEN
      RAISE EXCEPTION 'empty account-erasure workflow blocked unexpectedly';
    END IF;
  END LOOP;
  IF NOT v_completed THEN
    RAISE EXCEPTION 'account-erasure workflow did not finish within finite passes';
  END IF;
  IF NOT oran_internal.is_account_erased(v_clerk_user_id) THEN
    RAISE EXCEPTION 'completed identity lost its durable revocation block';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM oran_internal.account_erasure_requests request
    WHERE request.id = v_request_id
      AND (request.user_id IS NOT NULL OR request.clerk_user_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'completed erasure retained raw request identities';
  END IF;

  BEGIN
    INSERT INTO public.saved_collections (user_id, name)
    VALUES (v_user_id, 'must still be rejected');
    RAISE EXCEPTION 'completed identity was reintroduced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$account_erasure_workflow_test$;

ROLLBACK;
