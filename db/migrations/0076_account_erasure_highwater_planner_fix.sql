-- Prevent the services high-water lookup from choosing a backward primary-key
-- scan over the purpose-built human-actor GIN index. The installed dispatcher
-- is intentionally patched in place so its 72-step manifest, owner, ACL, and
-- security-definer configuration remain unchanged.
DO $migration$
DECLARE
  v_signature constant pg_catalog.regprocedure :=
    'oran_internal.process_account_erasure_page(uuid,integer)'::pg_catalog.regprocedure;
  v_definition text;
  v_patched_definition text;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_old_fragment constant text := $old$
        SELECT id INTO v_high FROM public.services
        WHERE (ARRAY[created_by_user_id, updated_by_user_id, integrity_held_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
                                     OR (integrity_held_by_user_id IS NOT NULL AND integrity_held_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
$old$;
  v_new_fragment constant text := $new$
        WITH matching_services AS MATERIALIZED (
          SELECT id
          FROM public.services
          WHERE (ARRAY[created_by_user_id, updated_by_user_id, integrity_held_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
                                     OR (integrity_held_by_user_id IS NOT NULL AND integrity_held_by_user_id !~ '^import:')))
        )
        SELECT id INTO v_high
        FROM matching_services
        ORDER BY id DESC
        LIMIT 1;
$new$;
BEGIN
  SELECT function_state.proowner,
         function_state.proacl,
         function_state.prosecdef,
         function_state.proconfig,
         pg_catalog.pg_get_functiondef(function_state.oid)
  INTO v_owner,
       v_acl,
       v_security_definer,
       v_config,
       v_definition
  FROM pg_catalog.pg_proc function_state
  WHERE function_state.oid = v_signature;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account erasure dispatcher was not found';
  END IF;

  IF pg_catalog.strpos(v_definition, v_new_fragment) > 0 THEN
    IF pg_catalog.strpos(v_definition, v_old_fragment) > 0 THEN
      RAISE EXCEPTION 'account erasure dispatcher contains mixed high-water implementations';
    END IF;
  ELSE
    IF pg_catalog.strpos(v_definition, v_old_fragment) = 0 THEN
      RAISE EXCEPTION 'account erasure services high-water selector has unexpected shape';
    END IF;
    IF pg_catalog.strpos(
      pg_catalog.substr(
        v_definition,
        pg_catalog.strpos(v_definition, v_old_fragment)
          + pg_catalog.length(v_old_fragment)
      ),
      v_old_fragment
    ) > 0 THEN
      RAISE EXCEPTION 'account erasure services high-water selector is not unique';
    END IF;

    v_patched_definition := pg_catalog.replace(
      v_definition,
      v_old_fragment,
      v_new_fragment
    );
    EXECUTE v_patched_definition;
  END IF;

  SELECT pg_catalog.pg_get_functiondef(function_state.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc function_state
  WHERE function_state.oid = v_signature;

  IF pg_catalog.strpos(v_definition, v_new_fragment) = 0
     OR pg_catalog.strpos(v_definition, v_old_fragment) > 0 THEN
    RAISE EXCEPTION 'account erasure services high-water planner fix was not installed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc function_state
    WHERE function_state.oid = v_signature
      AND function_state.proowner = v_owner
      AND function_state.proacl IS NOT DISTINCT FROM v_acl
      AND function_state.prosecdef = v_security_definer
      AND function_state.proconfig IS NOT DISTINCT FROM v_config
  ) THEN
    RAISE EXCEPTION 'account erasure dispatcher security metadata changed unexpectedly';
  END IF;
END
$migration$;
