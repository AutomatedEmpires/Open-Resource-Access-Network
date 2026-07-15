-- 0071_account_erasure_workflow.sql
--
-- Revocation-first, bounded account erasure for Clerk-backed identities.
-- Queuing freezes authorization synchronously. Clerk deletion and every data
-- scrub are durable state transitions. A worker processes exactly one checked
-- primary-key page per database call; no request can trigger a whole-table
-- rewrite or caller-selected relation.

BEGIN;

CREATE SCHEMA IF NOT EXISTS oran_internal;
REVOKE ALL ON SCHEMA oran_internal FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS chk_user_profiles_auth_provider;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT chk_user_profiles_auth_provider
  CHECK (auth_provider IN ('azure-ad', 'google', 'credentials', 'clerk'));

CREATE TABLE IF NOT EXISTS oran_internal.account_erasure_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  clerk_user_id text,
  user_digest text NOT NULL,
  clerk_user_digest text NOT NULL,
  text_tombstone text NOT NULL,
  uuid_tombstone uuid NOT NULL,
  profile_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'blocked', 'completed')),
  clerk_deleted_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error_code text,
  rows_scrubbed bigint NOT NULL DEFAULT 0 CHECK (rows_scrubbed >= 0),
  requested_at timestamptz NOT NULL DEFAULT now(),
  blocked_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT account_erasure_user_digest_format CHECK (
    char_length(user_digest) = 64 AND user_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT account_erasure_clerk_digest_format CHECK (
    char_length(clerk_user_digest) = 64 AND clerk_user_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT account_erasure_text_tombstone_format CHECK (
    text_tombstone ~ '^deleted-user:[0-9a-f-]{36}$'
  ),
  CONSTRAINT account_erasure_completion_shape CHECK (
    (status = 'completed'
      AND user_id IS NULL
      AND clerk_user_id IS NULL
      AND completed_at IS NOT NULL)
    OR
    (status <> 'completed'
      AND user_id IS NOT NULL
      AND clerk_user_id IS NOT NULL
      AND completed_at IS NULL)
  ),
  UNIQUE (user_digest),
  UNIQUE (clerk_user_digest),
  UNIQUE (text_tombstone),
  UNIQUE (uuid_tombstone)
);

CREATE TABLE IF NOT EXISTS oran_internal.account_erasure_steps (
  request_id uuid NOT NULL
    REFERENCES oran_internal.account_erasure_requests(id) ON DELETE CASCADE,
  step_name text NOT NULL CHECK (step_name IN (
    'saved_collections', 'saved_services', 'notification_preferences',
    'notification_events', 'chat_sessions', 'seeker_feedback',
    'seeker_profiles', 'form_instances', 'chat_usage_events',
    'chat_inflight_leases', 'chat_rate_limit_windows', 'source_records',
    'submissions', 'admin_routing_rules', 'extracted_candidates',
    'tag_confirmation_queue', 'verification_queue_archive',
    'admin_review_profiles', 'user_scope_grants', 'pending_scope_grants',
    'organization_members', 'ownership_transfers',
    'ingestion_audit_events', 'lifecycle_events', 'llm_suggestions',
    'source_feed_states', 'import_batches', 'canonical_provenance',
    'resolution_candidates', 'resolution_decisions', 'resource_tags',
    'taxonomy_crosswalks', 'verified_service_links',
    'verification_evidence', 'audit_logs', 'scope_audit_log',
    'submission_transitions', 'resource_freshness_findings',
    'resource_quarantine_members', 'resource_quarantine_batches',
    'hotline_authority_members', 'hotline_quarantined_contacts',
    'hotline_authority_added_contacts', 'hotline_authority_batches',
    'accessibility_for_disabilities', 'addresses', 'contacts',
    'coverage_zones', 'dietary_options', 'eligibility', 'feature_flags',
    'form_templates', 'languages', 'locations', 'organizations', 'phones',
    'programs', 'required_documents', 'schedules', 'service_adaptations',
    'service_areas', 'service_at_location', 'service_attributes',
    'service_taxonomy', 'services', 'staging_locations',
    'staging_organizations', 'staging_services', 'taxonomy_terms',
    'user_profiles_refs', 'org_service_scope', 'content_templates'
  )),
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 72),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'blocked')),
  pass smallint NOT NULL DEFAULT 1 CHECK (pass BETWEEN 1 AND 3),
  highwater_captured boolean NOT NULL DEFAULT false,
  cursor_uuid uuid,
  cursor_uuid_2 uuid,
  cursor_text text,
  highwater_uuid uuid,
  highwater_uuid_2 uuid,
  highwater_text text,
  pass_rows_changed bigint NOT NULL DEFAULT 0 CHECK (pass_rows_changed >= 0),
  rows_scanned bigint NOT NULL DEFAULT 0 CHECK (rows_scanned >= 0),
  rows_changed bigint NOT NULL DEFAULT 0 CHECK (rows_changed >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, step_name),
  UNIQUE (request_id, ordinal)
);

CREATE TABLE IF NOT EXISTS oran_internal.account_erasure_identity_blocks (
  identity_digest text PRIMARY KEY CHECK (
    char_length(identity_digest) = 64
    AND identity_digest ~ '^[0-9a-f]{64}$'
  ),
  request_id uuid NOT NULL
    REFERENCES oran_internal.account_erasure_requests(id) ON DELETE RESTRICT,
  identity_length integer NOT NULL CHECK (identity_length BETWEEN 3 AND 512),
  identity_kind text NOT NULL CHECK (identity_kind IN (
    'user', 'clerk', 'profile', 'chat_identity', 'chat_rate'
  )),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_erasure_retry
  ON oran_internal.account_erasure_requests (next_attempt_at, requested_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_account_erasure_steps_next
  ON oran_internal.account_erasure_steps (request_id, ordinal)
  WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_account_erasure_identity_blocks_request
  ON oran_internal.account_erasure_identity_blocks (request_id);

-- Existing-table indexes are installed online by 0073_account_erasure_indexes.sql.
ALTER TABLE oran_internal.account_erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE oran_internal.account_erasure_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE oran_internal.account_erasure_identity_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE oran_internal.account_erasure_requests FROM PUBLIC;
REVOKE ALL ON TABLE oran_internal.account_erasure_steps FROM PUBLIC;
REVOKE ALL ON TABLE oran_internal.account_erasure_identity_blocks FROM PUBLIC;

CREATE OR REPLACE FUNCTION oran_internal.identity_digest(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8')),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION oran_internal.replace_json_text(
  p_value jsonb,
  p_needle text,
  p_replacement text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_result jsonb;
BEGIN
  v_type := pg_catalog.jsonb_typeof(p_value);
  IF v_type = 'object' THEN
    SELECT COALESCE(
      pg_catalog.jsonb_object_agg(
        pg_catalog.replace(entry.key, p_needle, p_replacement),
        oran_internal.replace_json_text(entry.value, p_needle, p_replacement)
        ORDER BY entry.key
      ),
      '{}'::jsonb
    )
    INTO v_result
    FROM pg_catalog.jsonb_each(p_value) AS entry(key, value);
    RETURN v_result;
  END IF;
  IF v_type = 'array' THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        oran_internal.replace_json_text(element.value, p_needle, p_replacement)
        ORDER BY element.ordinality
      ),
      '[]'::jsonb
    )
    INTO v_result
    FROM pg_catalog.jsonb_array_elements(p_value)
      WITH ORDINALITY AS element(value, ordinality);
    RETURN v_result;
  END IF;
  IF v_type = 'string' THEN
    RETURN pg_catalog.to_jsonb(
      pg_catalog.replace(p_value #>> '{}', p_needle, p_replacement)
    );
  END IF;
  RETURN p_value;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.remove_json_keys(
  p_value jsonb,
  p_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_result jsonb;
BEGIN
  v_type := pg_catalog.jsonb_typeof(p_value);
  IF v_type = 'object' THEN
    SELECT COALESCE(
      pg_catalog.jsonb_object_agg(
        entry.key,
        oran_internal.remove_json_keys(entry.value, p_keys)
      ) FILTER (WHERE NOT (entry.key = ANY(p_keys))),
      '{}'::jsonb
    )
    INTO v_result
    FROM pg_catalog.jsonb_each(p_value) AS entry(key, value);
    RETURN v_result;
  END IF;
  IF v_type = 'array' THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        oran_internal.remove_json_keys(element.value, p_keys)
        ORDER BY element.ordinality
      ),
      '[]'::jsonb
    )
    INTO v_result
    FROM pg_catalog.jsonb_array_elements(p_value)
      WITH ORDINALITY AS element(value, ordinality);
    RETURN v_result;
  END IF;
  RETURN p_value;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.regex_quote(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_result text := '';
  v_character text;
  v_position integer;
BEGIN
  FOR v_position IN 1..pg_catalog.length(p_value)
  LOOP
    v_character := pg_catalog.substr(p_value, v_position, 1);
    IF pg_catalog.strpos(E'\\.^$|()[]{}*+?', v_character) > 0 THEN
      v_result := v_result || E'\\' || v_character;
    ELSE
      v_result := v_result || v_character;
    END IF;
  END LOOP;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.scrub_json_identities(
  p_value jsonb,
  p_user_id text,
  p_clerk_user_id text,
  p_profile_id uuid,
  p_replacement text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  v_result := oran_internal.replace_json_text(
    p_value, p_user_id, p_replacement
  );
  IF p_clerk_user_id IS DISTINCT FROM p_user_id THEN
    v_result := oran_internal.replace_json_text(
      v_result, p_clerk_user_id, p_replacement
    );
  END IF;
  IF p_profile_id IS NOT NULL THEN
    v_result := oran_internal.replace_json_text(
      v_result, p_profile_id::text, p_replacement
    );
  END IF;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.scrub_text_identities(
  p_value text,
  p_user_id text,
  p_clerk_user_id text,
  p_profile_id uuid,
  p_replacement text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_result text;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  v_result := pg_catalog.replace(p_value, p_user_id, p_replacement);
  IF p_clerk_user_id IS DISTINCT FROM p_user_id THEN
    v_result := pg_catalog.replace(v_result, p_clerk_user_id, p_replacement);
  END IF;
  IF p_profile_id IS NOT NULL THEN
    v_result := pg_catalog.replace(
      v_result, p_profile_id::text, p_replacement
    );
  END IF;
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.scrub_json_identities_for_request(
  p_value jsonb,
  p_user_id text,
  p_replacement text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_clerk_user_id text;
  v_profile_id uuid;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  SELECT request.clerk_user_id, request.profile_id
  INTO v_clerk_user_id, v_profile_id
  FROM oran_internal.account_erasure_requests request
  WHERE request.user_id = p_user_id
  LIMIT 1;
  RETURN oran_internal.scrub_json_identities(
    p_value,
    p_user_id,
    COALESCE(v_clerk_user_id, p_user_id),
    v_profile_id,
    p_replacement
  );
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.scrub_text_identities_for_request(
  p_value text,
  p_user_id text,
  p_replacement text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_clerk_user_id text;
  v_profile_id uuid;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  SELECT request.clerk_user_id, request.profile_id
  INTO v_clerk_user_id, v_profile_id
  FROM oran_internal.account_erasure_requests request
  WHERE request.user_id = p_user_id
  LIMIT 1;
  RETURN oran_internal.scrub_text_identities(
    p_value,
    p_user_id,
    COALESCE(v_clerk_user_id, p_user_id),
    v_profile_id,
    p_replacement
  );
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.json_text_leaves(p_value jsonb)
RETURNS SETOF text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_type text;
  v_entry record;
BEGIN
  v_type := pg_catalog.jsonb_typeof(p_value);
  IF v_type = 'string' THEN
    RETURN NEXT p_value #>> '{}';
  ELSIF v_type = 'object' THEN
    FOR v_entry IN SELECT key, value FROM pg_catalog.jsonb_each(p_value)
    LOOP
      RETURN NEXT v_entry.key;
      RETURN QUERY SELECT * FROM oran_internal.json_text_leaves(v_entry.value);
    END LOOP;
  ELSIF v_type = 'array' THEN
    FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value)
    LOOP
      RETURN QUERY SELECT * FROM oran_internal.json_text_leaves(v_entry.value);
    END LOOP;
  END IF;
  RETURN;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.reject_erased_identity_reintroduction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_column text;
  v_value jsonb;
  v_old_value jsonb;
  v_leaf text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM oran_internal.account_erasure_identity_blocks LIMIT 1
  ) THEN
    RETURN NEW;
  END IF;

  FOREACH v_column IN ARRAY TG_ARGV
  LOOP
    IF NOT (pg_catalog.to_jsonb(NEW) ? v_column) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'account erasure write gate is misconfigured';
    END IF;
    v_value := pg_catalog.to_jsonb(NEW) -> v_column;
    IF TG_OP = 'UPDATE' THEN
      v_old_value := pg_catalog.to_jsonb(OLD) -> v_column;
      IF v_value IS NOT DISTINCT FROM v_old_value THEN
        CONTINUE;
      END IF;
    END IF;
    IF v_value IS NULL OR v_value = 'null'::jsonb THEN
      CONTINUE;
    END IF;

    FOR v_leaf IN SELECT * FROM oran_internal.json_text_leaves(v_value)
    LOOP
      IF EXISTS (
        WITH candidate_lengths AS (
          SELECT DISTINCT block.identity_length
          FROM oran_internal.account_erasure_identity_blocks block
          WHERE block.identity_length <= pg_catalog.length(v_leaf)
        ), candidates AS (
          SELECT v_leaf AS candidate
          UNION
          SELECT token
          FROM pg_catalog.regexp_split_to_table(
            v_leaf,
            '[^[:alnum:]_@.+:-]+'
          ) token
          WHERE pg_catalog.length(token) >= 3
          UNION
          SELECT pg_catalog.substr(
            v_leaf,
            position_series.character_position,
            length.identity_length
          )
          FROM candidate_lengths length
          CROSS JOIN LATERAL pg_catalog.generate_series(
            1,
            pg_catalog.length(v_leaf) - length.identity_length + 1
          ) position_series(character_position)
        )
        SELECT 1
        FROM candidates candidate
        JOIN oran_internal.account_erasure_identity_blocks block
          ON block.identity_digest =
             oran_internal.identity_digest(candidate.candidate)
        WHERE TG_OP <> 'UPDATE'
           OR NOT EXISTS (
             SELECT 1
             FROM oran_internal.json_text_leaves(v_old_value) old_leaf
             WHERE pg_catalog.strpos(old_leaf, candidate.candidate) > 0
           )
        LIMIT 1
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'write contains a revoked identity';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END
$function$;

-- Fixed write-gate manifest. The trigger examines only monitored values newly
-- supplied by an INSERT or changed by an UPDATE. There is deliberately no
-- session-variable bypass: custom GUCs are caller-settable in PostgreSQL.
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.saved_collections;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.saved_collections
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.saved_services;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.saved_services
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.notification_preferences;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.notification_preferences
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.notification_events;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.notification_events
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('recipient_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.chat_sessions;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.seeker_feedback;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.seeker_feedback
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.seeker_profiles;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.seeker_profiles
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id','created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.form_instances;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.form_instances
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('recipient_user_id','form_data','attachment_manifest','blob_storage_prefix');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.chat_usage_events;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.chat_usage_events
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('identity_key');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.chat_inflight_leases;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.chat_inflight_leases
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('identity_key');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.chat_rate_limit_windows;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.chat_rate_limit_windows
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('rate_key');

DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.source_records;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.source_records
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('raw_payload','parsed_payload','source_confidence_signals','processing_error');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.submissions;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.submissions
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('submitted_by_user_id','assigned_to_user_id','locked_by_user_id','payload','evidence');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.admin_routing_rules;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.admin_routing_rules
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('assigned_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.extracted_candidates;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.extracted_candidates
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('assigned_to_user_id','published_by_user_id','verification_checklist','investigation_pack','provenance_records');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.tag_confirmation_queue;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.tag_confirmation_queue
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('assigned_to_user_id','reviewed_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.verification_queue_archive;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.verification_queue_archive
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('assigned_to_user_id','submitted_by_user_id','created_by_user_id','updated_by_user_id','notes');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.admin_review_profiles;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.admin_review_profiles
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.user_scope_grants;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.user_scope_grants
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id','granted_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.pending_scope_grants;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.pending_scope_grants
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id','requested_by_user_id','decided_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.organization_members;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id','invited_by_user_id','created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.ownership_transfers;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.ownership_transfers
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('requested_by_user_id','current_admin_user_id','service_snapshot');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.ingestion_audit_events;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.ingestion_audit_events
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('actor_id','details');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.lifecycle_events;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.lifecycle_events
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('actor_id','metadata');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.llm_suggestions;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.llm_suggestions
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('reviewed_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.source_feed_states;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.source_feed_states
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('auto_publish_approved_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.import_batches;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('imported_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.canonical_provenance;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.canonical_provenance
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('decided_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.resolution_candidates;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.resolution_candidates
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('resolved_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.resolution_decisions;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.resolution_decisions
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('decided_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.resource_tags;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.resource_tags
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('added_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.taxonomy_crosswalks;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.taxonomy_crosswalks
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.verified_service_links;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.verified_service_links
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('verified_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.verification_evidence;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.verification_evidence
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('submitted_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.audit_logs;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('actor_user_id','before','after');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.scope_audit_log;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.scope_audit_log
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('actor_user_id','target_id','before_state','after_state');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.submission_transitions;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.submission_transitions
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('actor_user_id','gates_checked','metadata');

DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.resource_freshness_findings;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.resource_freshness_findings
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('original_integrity_held_by_user_id','evidence');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.resource_quarantine_members;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.resource_quarantine_members
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('original_integrity_held_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.resource_quarantine_batches;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.resource_quarantine_batches
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by','classifier');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.hotline_authority_members;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.hotline_authority_members
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('original_service','applied_service','original_organization','applied_organization','original_phones','applied_phones');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.hotline_quarantined_contacts;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.hotline_quarantined_contacts
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('phone_snapshot');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.hotline_authority_added_contacts;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.hotline_authority_added_contacts
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('phone_snapshot');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON oran_internal.hotline_authority_batches;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON oran_internal.hotline_authority_batches
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by','validation_summary');

DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.accessibility_for_disabilities;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.accessibility_for_disabilities
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.addresses;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.addresses
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.contacts;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.coverage_zones;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.coverage_zones
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id','assigned_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.dietary_options;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.dietary_options
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.eligibility;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.eligibility
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.feature_flags;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.feature_flags
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.form_templates;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.form_templates
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.languages;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.languages
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.locations;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.organizations;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id','verified_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.phones;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.phones
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.programs;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.programs
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.required_documents;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.required_documents
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.schedules;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.schedules
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.service_adaptations;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.service_adaptations
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.service_areas;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.service_areas
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.service_at_location;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.service_at_location
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.service_attributes;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.service_attributes
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.service_taxonomy;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.service_taxonomy
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.services;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id','integrity_held_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.staging_locations;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.staging_locations
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.staging_organizations;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.staging_organizations
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.staging_services;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.staging_services
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.taxonomy_terms;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.taxonomy_terms
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by_user_id','updated_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.user_profiles;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id','clerk_user_id','created_by_user_id','updated_by_user_id','suspended_by_user_id','restored_by_user_id');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.org_service_scope;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.org_service_scope
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('user_id','granted_by');
DROP TRIGGER IF EXISTS trg_reject_erased_identity ON public.content_templates;
CREATE TRIGGER trg_reject_erased_identity BEFORE INSERT OR UPDATE ON public.content_templates
FOR EACH ROW EXECUTE FUNCTION oran_internal.reject_erased_identity_reintroduction('created_by','updated_by');

DO $validate_erasure_gate_manifest$
DECLARE
  v_invalid text;
BEGIN
  WITH gate_triggers AS (
    SELECT trigger.tgrelid, trigger.tgargs
    FROM pg_catalog.pg_trigger trigger
    WHERE trigger.tgfoid =
      'oran_internal.reject_erased_identity_reintroduction()'::pg_catalog.regprocedure
      AND NOT trigger.tgisinternal
  ), trigger_columns AS (
    SELECT gate.tgrelid,
           pg_catalog.unnest(
             pg_catalog.string_to_array(
               pg_catalog.encode(gate.tgargs, 'escape'), E'\\000'
             )
           ) AS column_name
    FROM gate_triggers gate
  )
  SELECT pg_catalog.string_agg(
    trigger_column.tgrelid::pg_catalog.regclass::text
      || '.' || trigger_column.column_name,
    ', '
  )
  INTO v_invalid
  FROM trigger_columns trigger_column
  WHERE trigger_column.column_name <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid = trigger_column.tgrelid
        AND attribute.attname = trigger_column.column_name
        AND NOT attribute.attisdropped
    );
  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'invalid account-erasure write-gate manifest: %', v_invalid;
  END IF;
END
$validate_erasure_gate_manifest$;

CREATE OR REPLACE FUNCTION oran_internal.is_account_erased(p_clerk_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM oran_internal.account_erasure_requests request
    WHERE request.clerk_user_digest =
          oran_internal.identity_digest(p_clerk_user_id)
  );
$function$;

CREATE OR REPLACE FUNCTION oran_internal.queue_account_erasure(
  p_user_id text,
  p_clerk_user_id text,
  p_text_tombstone text,
  p_uuid_tombstone uuid
)
RETURNS TABLE (request_id uuid, request_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_digest text;
  v_clerk_digest text;
  v_request oran_internal.account_erasure_requests%ROWTYPE;
  v_profile_matches boolean;
  v_profile_exists boolean;
  v_profile_id uuid;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.length(p_user_id) NOT BETWEEN 3 AND 512
     OR p_user_id ~ '^import:'
     OR p_clerk_user_id IS NULL
     OR pg_catalog.length(p_clerk_user_id) NOT BETWEEN 3 AND 512
     OR p_text_tombstone !~ '^deleted-user:[0-9a-f-]{36}$'
     OR p_uuid_tombstone IS NULL THEN
    RAISE EXCEPTION 'invalid account erasure request';
  END IF;

  v_user_digest := oran_internal.identity_digest(p_user_id);
  v_clerk_digest := oran_internal.identity_digest(p_clerk_user_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:account-erasure:' || v_clerk_digest, 0)
  );

  SELECT profile.id
  INTO v_profile_id
  FROM public.user_profiles profile
  WHERE profile.user_id = p_user_id;
  v_profile_exists := FOUND;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.user_id = p_user_id
      AND (
        profile.clerk_user_id = p_clerk_user_id
        OR (profile.clerk_user_id IS NULL AND profile.user_id = p_clerk_user_id)
      )
  ) INTO v_profile_matches;

  IF (v_profile_exists AND NOT v_profile_matches)
     OR (NOT v_profile_exists AND p_user_id IS DISTINCT FROM p_clerk_user_id) THEN
    RAISE EXCEPTION 'authenticated identity does not match the ORAN profile';
  END IF;

  SELECT * INTO v_request
  FROM oran_internal.account_erasure_requests request
  WHERE request.clerk_user_digest = v_clerk_digest
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT v_request.id, v_request.status;
    RETURN;
  END IF;

  INSERT INTO oran_internal.account_erasure_requests (
    user_id, clerk_user_id, user_digest, clerk_user_digest,
    text_tombstone, uuid_tombstone, profile_id
  ) VALUES (
    p_user_id, p_clerk_user_id, v_user_digest, v_clerk_digest,
    p_text_tombstone, p_uuid_tombstone, v_profile_id
  ) RETURNING * INTO v_request;

  INSERT INTO oran_internal.account_erasure_identity_blocks (
    identity_digest, request_id, identity_length, identity_kind
  )
  SELECT DISTINCT ON (identity.digest)
         identity.digest, v_request.id, identity.value_length, identity.kind
  FROM (VALUES
    (v_user_digest, pg_catalog.length(p_user_id), 'user'),
    (v_clerk_digest, pg_catalog.length(p_clerk_user_id), 'clerk'),
    (CASE WHEN v_profile_id IS NULL THEN NULL ELSE
       oran_internal.identity_digest(v_profile_id::text) END,
       CASE WHEN v_profile_id IS NULL THEN NULL ELSE 36 END, 'profile'),
    (oran_internal.identity_digest(
       'user:' || oran_internal.identity_digest(p_user_id)
     ), 69, 'chat_identity'),
    (oran_internal.identity_digest(
       'rate:' || oran_internal.identity_digest('chat:user:' || p_user_id)
     ), 69, 'chat_rate')
  ) identity(digest, value_length, kind)
  WHERE identity.digest IS NOT NULL
  ORDER BY identity.digest, identity.kind
  ON CONFLICT (identity_digest) DO NOTHING;

  INSERT INTO oran_internal.account_erasure_steps (request_id, step_name, ordinal)
  SELECT v_request.id, manifest.step_name, manifest.ordinal
  FROM (VALUES
    (1, 'saved_collections'), (2, 'saved_services'),
    (3, 'notification_preferences'), (4, 'notification_events'),
    (5, 'chat_sessions'), (6, 'seeker_feedback'),
    (7, 'seeker_profiles'), (8, 'form_instances'),
    (9, 'chat_usage_events'), (10, 'chat_inflight_leases'),
    (11, 'chat_rate_limit_windows'), (12, 'source_records'),
    (13, 'submissions'), (14, 'admin_routing_rules'),
    (15, 'extracted_candidates'), (16, 'tag_confirmation_queue'),
    (17, 'verification_queue_archive'), (18, 'admin_review_profiles'),
    (19, 'user_scope_grants'), (20, 'pending_scope_grants'),
    (21, 'organization_members'), (22, 'ownership_transfers'),
    (23, 'ingestion_audit_events'), (24, 'lifecycle_events'),
    (25, 'llm_suggestions'), (26, 'source_feed_states'),
    (27, 'import_batches'), (28, 'canonical_provenance'),
    (29, 'resolution_candidates'), (30, 'resolution_decisions'),
    (31, 'resource_tags'), (32, 'taxonomy_crosswalks'),
    (33, 'verified_service_links'), (34, 'verification_evidence'),
    (35, 'audit_logs'), (36, 'scope_audit_log'),
    (37, 'submission_transitions'), (38, 'resource_freshness_findings'),
    (39, 'resource_quarantine_members'), (40, 'resource_quarantine_batches'),
    (41, 'hotline_authority_members'), (42, 'hotline_quarantined_contacts'),
    (43, 'hotline_authority_added_contacts'), (44, 'hotline_authority_batches'),
    (45, 'accessibility_for_disabilities'), (46, 'addresses'),
    (47, 'contacts'), (48, 'coverage_zones'), (49, 'dietary_options'),
    (50, 'eligibility'), (51, 'feature_flags'), (52, 'form_templates'),
    (53, 'languages'), (54, 'locations'), (55, 'organizations'),
    (56, 'phones'), (57, 'programs'), (58, 'required_documents'),
    (59, 'schedules'), (60, 'service_adaptations'),
    (61, 'service_areas'), (62, 'service_at_location'),
    (63, 'service_attributes'), (64, 'service_taxonomy'),
    (65, 'services'), (66, 'staging_locations'),
    (67, 'staging_organizations'), (68, 'staging_services'),
    (69, 'taxonomy_terms'), (70, 'user_profiles_refs'),
    (71, 'org_service_scope'), (72, 'content_templates')
  ) AS manifest(ordinal, step_name);

  -- This is the synchronous privacy boundary. It is intentionally small and
  -- index-backed; all historical scrubbing happens after Clerk deletion.
  UPDATE public.user_profiles
  SET account_status = 'frozen'
  WHERE user_id = p_user_id;
  UPDATE public.user_scope_grants
  SET is_active = false
  WHERE user_id = p_user_id AND is_active IS TRUE;
  UPDATE public.pending_scope_grants
  SET status = 'cancelled',
      decided_at = COALESCE(decided_at, pg_catalog.now()),
      decision_reason = 'Account erasure requested'
  WHERE user_id = p_user_id AND status = 'pending';
  UPDATE public.admin_review_profiles
  SET is_active = false, is_accepting_new = false
  WHERE user_id = p_user_id;
  UPDATE public.organization_members
  SET status = 'deactivated'
  WHERE user_id = p_user_id AND status IS DISTINCT FROM 'deactivated';

  RETURN QUERY SELECT v_request.id, v_request.status;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.claim_account_erasure_requests(
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  request_id uuid,
  user_id text,
  clerk_user_id text,
  clerk_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 25 THEN
    RAISE EXCEPTION 'account erasure claim limit must be between 1 and 25';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT request.id
    FROM oran_internal.account_erasure_requests request
    WHERE request.status IN ('pending', 'processing')
      AND (request.lease_expires_at IS NULL
           OR request.lease_expires_at <= pg_catalog.now())
      AND request.next_attempt_at <= pg_catalog.now()
    ORDER BY request.next_attempt_at, request.requested_at, request.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE oran_internal.account_erasure_requests request
  SET status = 'processing',
      lease_expires_at = pg_catalog.now() + interval '10 minutes',
      last_error_code = NULL
  FROM candidates
  WHERE request.id = candidates.id
  RETURNING request.id, request.user_id, request.clerk_user_id,
            request.clerk_deleted_at IS NOT NULL;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.record_account_erasure_failure(
  p_request_id uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid account erasure error code';
  END IF;
  UPDATE oran_internal.account_erasure_requests request
  SET status = CASE
        WHEN request.attempt_count + 1 >= 12 THEN 'blocked'
        WHEN request.clerk_deleted_at IS NULL THEN 'pending'
        ELSE 'processing'
      END,
      attempt_count = request.attempt_count + 1,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(
        secs => LEAST(
          3600,
          30 * (2 ^ LEAST(request.attempt_count + 1, 7))
        )::integer
      ),
      blocked_at = CASE
        WHEN request.attempt_count + 1 >= 12 THEN pg_catalog.now()
        ELSE request.blocked_at
      END
  WHERE request.id = p_request_id
    AND request.status IN ('pending', 'processing');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account erasure request is not retryable';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.mark_clerk_account_deleted(
  p_request_id uuid,
  p_user_id text,
  p_clerk_user_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE oran_internal.account_erasure_requests request
  SET clerk_deleted_at = COALESCE(request.clerk_deleted_at, pg_catalog.now()),
      status = CASE WHEN request.status = 'blocked' THEN 'blocked' ELSE 'processing' END,
      lease_expires_at = NULL,
      next_attempt_at = pg_catalog.now(),
      last_error_code = NULL
  WHERE request.id = p_request_id
    AND request.user_digest = oran_internal.identity_digest(p_user_id)
    AND request.clerk_user_digest = oran_internal.identity_digest(p_clerk_user_id)
    AND request.user_id = p_user_id
    AND request.clerk_user_id = p_clerk_user_id
    AND request.status <> 'completed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account erasure identity mismatch';
  END IF;

  -- UUID foreign keys can be repointed page-by-page only after their target
  -- exists. Seed the blank, frozen pseudonym after Clerk is gone; the original
  -- profile is retained (and frozen) until finalization proves every step done.
  INSERT INTO public.user_profiles (
    id, user_id, role, auth_provider, account_status, created_at, updated_at
  )
  SELECT request.uuid_tombstone,
         request.text_tombstone,
         'seeker',
         'clerk',
         'frozen',
         pg_catalog.now(),
         pg_catalog.now()
  FROM oran_internal.account_erasure_requests request
  WHERE request.id = p_request_id AND request.profile_id IS NOT NULL
  ON CONFLICT (id) DO NOTHING;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.finalize_account_erasure(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request oran_internal.account_erasure_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM oran_internal.account_erasure_requests request
  WHERE request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account erasure request was not found';
  END IF;
  IF v_request.status = 'completed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'completed', 'completed', true, 'alreadyCompleted', true
    );
  END IF;
  IF v_request.clerk_deleted_at IS NULL THEN
    RAISE EXCEPTION 'identity provider deletion has not completed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM oran_internal.account_erasure_steps step
    WHERE step.request_id = p_request_id AND step.status <> 'done'
  ) THEN
    RAISE EXCEPTION 'account erasure steps are incomplete';
  END IF;

  IF v_request.profile_id IS NOT NULL THEN
    INSERT INTO public.user_profiles (
      id, user_id, role, auth_provider, account_status, created_at, updated_at
    ) VALUES (
      v_request.uuid_tombstone,
      v_request.text_tombstone,
      'seeker',
      'clerk',
      'frozen',
      pg_catalog.now(),
      pg_catalog.now()
    )
    ON CONFLICT (id) DO NOTHING;

    DELETE FROM public.user_profiles profile
    WHERE profile.id = v_request.profile_id
      AND profile.user_id = v_request.user_id;
  END IF;

  UPDATE oran_internal.account_erasure_requests request
  SET status = 'completed',
      user_id = NULL,
      clerk_user_id = NULL,
      profile_id = NULL,
      lease_expires_at = NULL,
      next_attempt_at = pg_catalog.now(),
      last_error_code = NULL,
      completed_at = pg_catalog.now()
  WHERE request.id = p_request_id;

  INSERT INTO public.audit_logs (
    action, resource_type, resource_id, after, actor_user_id
  ) VALUES (
    'user_data_deleted',
    'user',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'gdpr', true,
      'identityErased', true,
      'requestId', p_request_id
    ),
    NULL
  );

  RETURN pg_catalog.jsonb_build_object(
    'status', 'completed', 'completed', true, 'requestId', p_request_id
  );
END
$function$;

-- One invocation scans at most p_page_size primary keys from exactly one
-- checked manifest step. A changed pass is followed by a verification pass.
-- A third changed pass is terminally blocked instead of retrying forever.
CREATE OR REPLACE FUNCTION oran_internal.process_account_erasure_page(
  p_request_id uuid,
  p_page_size integer DEFAULT 1000
)
RETURNS TABLE (
  request_status text,
  current_step text,
  next_step text,
  clerk_deleted boolean,
  completed boolean,
  scanned integer,
  changed integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request oran_internal.account_erasure_requests%ROWTYPE;
  v_step oran_internal.account_erasure_steps%ROWTYPE;
  v_page uuid[] := ARRAY[]::uuid[];
  v_page_2 uuid[] := ARRAY[]::uuid[];
  v_page_text text[] := ARRAY[]::text[];
  v_last uuid;
  v_last_2 uuid;
  v_last_text text;
  v_high uuid;
  v_high_2 uuid;
  v_high_text text;
  v_scanned integer := 0;
  v_changed integer := 0;
  v_extra integer := 0;
  v_exhausted boolean := false;
  v_pass_changed bigint;
  v_result jsonb;
  v_chat_identity_key text;
  v_chat_rate_key text;
  v_identity_pattern text;
BEGIN
  IF p_page_size < 500 OR p_page_size > 2000 THEN
    RAISE EXCEPTION 'account erasure page size must be between 500 and 2000';
  END IF;

  SELECT * INTO v_request
  FROM oran_internal.account_erasure_requests request
  WHERE request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account erasure request was not found';
  END IF;
  IF v_request.status = 'completed' THEN
    RETURN QUERY SELECT 'completed', NULL::text, NULL::text, true, true, 0, 0;
    RETURN;
  END IF;
  IF v_request.status = 'blocked' THEN
    RETURN QUERY SELECT 'blocked', NULL::text, 'operator_review',
      v_request.clerk_deleted_at IS NOT NULL, false, 0, 0;
    RETURN;
  END IF;
  IF v_request.clerk_deleted_at IS NULL THEN
    UPDATE oran_internal.account_erasure_requests request
    SET status = 'pending', lease_expires_at = NULL
    WHERE request.id = p_request_id;
    RETURN QUERY SELECT 'pending', NULL::text, 'identity_provider_deletion',
      false, false, 0, 0;
    RETURN;
  END IF;

  v_identity_pattern := oran_internal.regex_quote(v_request.user_id);
  IF v_request.clerk_user_id IS DISTINCT FROM v_request.user_id THEN
    v_identity_pattern := v_identity_pattern || '|'
      || oran_internal.regex_quote(v_request.clerk_user_id);
  END IF;
  IF v_request.profile_id IS NOT NULL THEN
    v_identity_pattern := v_identity_pattern || '|'
      || oran_internal.regex_quote(v_request.profile_id::text);
  END IF;

  SELECT * INTO v_step
  FROM oran_internal.account_erasure_steps step
  WHERE step.request_id = p_request_id
    AND step.status IN ('pending', 'running')
  ORDER BY step.ordinal
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    v_result := oran_internal.finalize_account_erasure(p_request_id);
    RETURN QUERY SELECT 'completed', NULL::text, NULL::text, true, true, 0, 0;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'oran:account-erasure:' || v_request.user_digest, 0
    )
  );
  -- Short page transactions share the same global lock order as publication,
  -- freshness, hotline authority, and quarantine maintenance.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:live-publication-merge', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'oran:authority:verified-national-hotlines-2026-07-13', 0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'oran:quarantine:usda-fns-snap-retailer-2026-07', 0
    )
  );
  PERFORM pg_catalog.set_config('oran.erasure_mode', 'on', true);

  UPDATE oran_internal.account_erasure_steps step
  SET status = 'running',
      started_at = COALESCE(step.started_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  WHERE step.request_id = p_request_id AND step.step_name = v_step.step_name;

  CASE v_step.step_name
    WHEN 'saved_collections' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.saved_collections
        WHERE user_id = v_request.user_id
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.saved_collections
              WHERE user_id = v_request.user_id
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        DELETE FROM public.saved_collections row
        WHERE row.id = ANY(v_page) AND row.user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'saved_services' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.saved_services
        WHERE (user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.saved_services
              WHERE (user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        DELETE FROM public.saved_services row
        WHERE row.id = ANY(v_page) AND row.user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'notification_preferences' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.notification_preferences
        WHERE (user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.notification_preferences
              WHERE (user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        DELETE FROM public.notification_preferences row
        WHERE row.id = ANY(v_page) AND row.user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'notification_events' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.notification_events
        WHERE (recipient_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.notification_events
              WHERE (recipient_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        DELETE FROM public.notification_events row
        WHERE row.id = ANY(v_page)
          AND row.recipient_user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'chat_sessions' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.chat_sessions
        WHERE (user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.chat_sessions
              WHERE (user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        DELETE FROM public.chat_sessions row
        WHERE row.id = ANY(v_page) AND row.user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'seeker_feedback' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.seeker_feedback
        WHERE created_by_user_id = v_request.user_id
           OR updated_by_user_id = v_request.user_id
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.seeker_feedback
              WHERE (created_by_user_id = v_request.user_id
                     OR updated_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.seeker_feedback row
        SET updated_by_user_id = v_request.text_tombstone
        WHERE row.id = ANY(v_page)
          AND row.updated_by_user_id = v_request.user_id
          AND row.created_by_user_id IS DISTINCT FROM v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        DELETE FROM public.seeker_feedback row
        WHERE row.id = ANY(v_page)
          AND row.created_by_user_id = v_request.user_id;
        GET DIAGNOSTICS v_extra = ROW_COUNT;
        v_changed := v_changed + v_extra;
      END IF;

    WHEN 'seeker_profiles' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.seeker_profiles
        WHERE user_id = v_request.user_id
           OR created_by_user_id = v_request.user_id
           OR updated_by_user_id = v_request.user_id
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.seeker_profiles
              WHERE (user_id = v_request.user_id
                     OR created_by_user_id = v_request.user_id
                     OR updated_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.seeker_profiles row
        SET created_by_user_id = CASE
              WHEN row.created_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE
              WHEN row.updated_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND row.user_id IS DISTINCT FROM v_request.user_id
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        DELETE FROM public.seeker_profiles row
        WHERE row.id = ANY(v_page) AND row.user_id = v_request.user_id;
        GET DIAGNOSTICS v_extra = ROW_COUNT;
        v_changed := v_changed + v_extra;
      END IF;

    WHEN 'form_instances' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.form_instances instance
        WHERE instance.recipient_user_id = v_request.user_id
           OR instance.form_data::text ~ v_identity_pattern
           OR instance.attachment_manifest::text ~ v_identity_pattern
           OR instance.blob_storage_prefix ~ v_identity_pattern
           OR EXISTS (
             SELECT 1 FROM public.submissions authored
             WHERE authored.id = instance.submission_id
               AND authored.submitted_by_user_id = v_request.user_id
           )
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.form_instances instance
              WHERE (
                  instance.recipient_user_id = v_request.user_id
                  OR instance.form_data::text ~ v_identity_pattern
                  OR instance.attachment_manifest::text ~ v_identity_pattern
                  OR instance.blob_storage_prefix ~ v_identity_pattern
                  OR EXISTS (
                    SELECT 1 FROM public.submissions authored
                    WHERE authored.id = instance.submission_id
                      AND authored.submitted_by_user_id = v_request.user_id
                  )
                )
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.form_instances row
        SET form_data = CASE WHEN row.recipient_user_id = v_request.user_id
              OR EXISTS (
                SELECT 1 FROM public.submissions authored
                WHERE authored.id = row.submission_id
                  AND authored.submitted_by_user_id = v_request.user_id
              ) THEN '{}'::jsonb ELSE oran_internal.scrub_json_identities(
                row.form_data, v_request.user_id, v_request.clerk_user_id,
                v_request.profile_id, v_request.text_tombstone
              ) END,
            attachment_manifest = CASE
              WHEN row.recipient_user_id = v_request.user_id OR EXISTS (
                SELECT 1 FROM public.submissions authored
                WHERE authored.id = row.submission_id
                  AND authored.submitted_by_user_id = v_request.user_id
              ) THEN '[]'::jsonb ELSE oran_internal.scrub_json_identities(
                row.attachment_manifest, v_request.user_id,
                v_request.clerk_user_id, v_request.profile_id,
                v_request.text_tombstone
              ) END,
            blob_storage_prefix = CASE
              WHEN row.recipient_user_id = v_request.user_id OR EXISTS (
                SELECT 1 FROM public.submissions authored
                WHERE authored.id = row.submission_id
                  AND authored.submitted_by_user_id = v_request.user_id
              ) THEN NULL ELSE oran_internal.scrub_text_identities(
                row.blob_storage_prefix, v_request.user_id,
                v_request.clerk_user_id, v_request.profile_id,
                v_request.text_tombstone
              ) END,
            recipient_user_id = CASE
              WHEN row.recipient_user_id = v_request.user_id THEN NULL
              ELSE row.recipient_user_id END
        WHERE row.id = ANY(v_page)
          AND (
            row.recipient_user_id = v_request.user_id
            OR EXISTS (
              SELECT 1 FROM public.submissions authored
              WHERE authored.id = row.submission_id
                AND authored.submitted_by_user_id = v_request.user_id
            )
            OR row.form_data::text ~ v_identity_pattern
            OR row.attachment_manifest::text ~ v_identity_pattern
            OR row.blob_storage_prefix ~ v_identity_pattern
          );
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'chat_usage_events' THEN
      v_chat_identity_key := 'user:' || oran_internal.identity_digest(v_request.user_id);
      IF NOT v_step.highwater_captured THEN
        SELECT request_id INTO v_high
        FROM oran_internal.chat_usage_events
        WHERE identity_key = v_chat_identity_key
        ORDER BY request_id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(request_id ORDER BY request_id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(request_id ORDER BY request_id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT request_id FROM oran_internal.chat_usage_events
              WHERE identity_key = v_chat_identity_key
                AND (v_step.cursor_uuid IS NULL OR request_id > v_step.cursor_uuid)
                AND request_id <= v_high
              ORDER BY request_id LIMIT p_page_size) page;
        DELETE FROM oran_internal.chat_usage_events row
        WHERE row.identity_key = v_chat_identity_key
          AND row.request_id = ANY(v_page);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'chat_inflight_leases' THEN
      v_chat_identity_key := 'user:' || oran_internal.identity_digest(v_request.user_id);
      v_scanned := 1;
      DELETE FROM oran_internal.chat_inflight_leases
      WHERE identity_key = v_chat_identity_key;
      GET DIAGNOSTICS v_changed = ROW_COUNT;
      v_exhausted := true;

    WHEN 'chat_rate_limit_windows' THEN
      v_chat_rate_key := 'rate:' || oran_internal.identity_digest(
        'chat:user:' || v_request.user_id
      );
      v_scanned := 1;
      DELETE FROM oran_internal.chat_rate_limit_windows
      WHERE rate_key = v_chat_rate_key;
      GET DIAGNOSTICS v_changed = ROW_COUNT;
      v_exhausted := true;

    WHEN 'source_records' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.source_records
        WHERE (raw_payload::text ~ v_identity_pattern
               OR parsed_payload::text ~ v_identity_pattern
               OR source_confidence_signals::text ~ v_identity_pattern
               OR processing_error ~ v_identity_pattern
               OR EXISTS (
                 SELECT 1 FROM public.submissions authored
                 WHERE authored.submitted_by_user_id = v_request.user_id
                   AND authored.id::text = raw_payload ->> 'submissionId'
               ))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.source_records
              WHERE (raw_payload::text ~ v_identity_pattern
                     OR parsed_payload::text ~ v_identity_pattern
                     OR source_confidence_signals::text ~ v_identity_pattern
                     OR processing_error ~ v_identity_pattern
                     OR EXISTS (
                       SELECT 1 FROM public.submissions authored
                       WHERE authored.submitted_by_user_id = v_request.user_id
                         AND authored.id::text = raw_payload ->> 'submissionId'
                     ))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        WITH sanitized AS MATERIALIZED (
          SELECT record.id,
                 CASE WHEN EXISTS (
                   SELECT 1 FROM public.submissions authored
                   WHERE authored.submitted_by_user_id = v_request.user_id
                     AND authored.id::text = record.raw_payload ->> 'submissionId'
                 ) THEN
                   oran_internal.scrub_json_identities_for_request(
                     (record.raw_payload - 'draft') || pg_catalog.jsonb_build_object(
                       '_erasure', pg_catalog.jsonb_build_object(
                         'personalContentRemoved', true, 'recordId', record.id
                       )
                     ),
                     v_request.user_id, v_request.text_tombstone
                   )
                 ELSE oran_internal.scrub_json_identities_for_request(
                   record.raw_payload, v_request.user_id, v_request.text_tombstone
                 ) END AS raw_payload,
                 CASE WHEN record.parsed_payload IS NULL THEN NULL
                   WHEN EXISTS (
                     SELECT 1 FROM public.submissions authored
                     WHERE authored.submitted_by_user_id = v_request.user_id
                       AND authored.id::text = record.raw_payload ->> 'submissionId'
                   ) THEN oran_internal.scrub_json_identities_for_request(
                     (record.parsed_payload - 'draft') || pg_catalog.jsonb_build_object(
                       '_erasure', pg_catalog.jsonb_build_object(
                         'personalContentRemoved', true, 'recordId', record.id
                       )
                     ),
                     v_request.user_id, v_request.text_tombstone
                   )
                   ELSE oran_internal.scrub_json_identities_for_request(
                     record.parsed_payload, v_request.user_id, v_request.text_tombstone
                   ) END AS parsed_payload,
                 oran_internal.scrub_json_identities_for_request(
                   record.source_confidence_signals,
                   v_request.user_id,
                   v_request.text_tombstone
                 ) AS confidence_signals,
                 CASE WHEN record.processing_error IS NULL THEN NULL ELSE
                   oran_internal.scrub_text_identities_for_request(
                     record.processing_error,
                     v_request.user_id,
                     v_request.text_tombstone
                   ) END AS processing_error
          FROM public.source_records record
          WHERE record.id = ANY(v_page)
            AND (
              record.raw_payload::text ~ v_identity_pattern
              OR record.parsed_payload::text ~ v_identity_pattern
              OR record.source_confidence_signals::text ~ v_identity_pattern
              OR record.processing_error ~ v_identity_pattern
              OR EXISTS (
                SELECT 1 FROM public.submissions authored
                WHERE authored.submitted_by_user_id = v_request.user_id
                  AND authored.id::text = record.raw_payload ->> 'submissionId'
              )
            )
        )
        UPDATE public.source_records record
        SET raw_payload = sanitized.raw_payload,
            parsed_payload = sanitized.parsed_payload,
            source_confidence_signals = sanitized.confidence_signals,
            processing_error = sanitized.processing_error,
            payload_sha256 = pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(sanitized.raw_payload::text, 'UTF8')
              ),
              'hex'
            )
        FROM sanitized
        WHERE record.id = sanitized.id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'submissions' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.submissions
        WHERE (submitted_by_user_id = v_request.user_id
               OR assigned_to_user_id = v_request.user_id
               OR locked_by_user_id = v_request.user_id
               OR payload::text ~ v_identity_pattern
               OR evidence::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.submissions
              WHERE (submitted_by_user_id = v_request.user_id
                     OR assigned_to_user_id = v_request.user_id
                     OR locked_by_user_id = v_request.user_id
                     OR payload::text ~ v_identity_pattern
                     OR evidence::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.submissions row
        SET submitted_by_user_id = CASE
              WHEN row.submitted_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.submitted_by_user_id END,
            assigned_to_user_id = CASE
              WHEN row.assigned_to_user_id = v_request.user_id
                THEN NULL ELSE row.assigned_to_user_id END,
            locked_by_user_id = CASE
              WHEN row.locked_by_user_id = v_request.user_id
                THEN NULL ELSE row.locked_by_user_id END,
            is_locked = CASE
              WHEN row.locked_by_user_id = v_request.user_id
                THEN false ELSE row.is_locked END,
            locked_at = CASE
              WHEN row.locked_by_user_id = v_request.user_id
                THEN NULL ELSE row.locked_at END,
            title = CASE WHEN row.submitted_by_user_id = v_request.user_id
              THEN NULL ELSE row.title END,
            notes = CASE WHEN row.submitted_by_user_id = v_request.user_id
              THEN NULL ELSE row.notes END,
            reviewer_notes = CASE WHEN row.submitted_by_user_id = v_request.user_id
              THEN NULL ELSE row.reviewer_notes END,
            payload = CASE WHEN row.submitted_by_user_id = v_request.user_id THEN
              oran_internal.remove_json_keys(
                oran_internal.scrub_json_identities_for_request(
                  row.payload, v_request.user_id, v_request.text_tombstone
                ),
                ARRAY['contact_email','contactEmail','submitterEmail',
                  'submitterPhone','additionalContext','details','comment',
                  'message','submitterRelationship']::text[]
              )
              ELSE oran_internal.scrub_json_identities_for_request(
                row.payload, v_request.user_id, v_request.text_tombstone
              ) END,
            evidence = CASE WHEN row.submitted_by_user_id = v_request.user_id THEN
              oran_internal.remove_json_keys(
                oran_internal.scrub_json_identities_for_request(
                  row.evidence, v_request.user_id, v_request.text_tombstone
                ),
                ARRAY['contact_email','contactEmail','submitterEmail',
                  'submitterPhone','additionalContext','details','comment',
                  'message','submitterRelationship']::text[]
              )
              ELSE oran_internal.scrub_json_identities_for_request(
                row.evidence, v_request.user_id, v_request.text_tombstone
              ) END
        WHERE row.id = ANY(v_page)
          AND (
            row.submitted_by_user_id = v_request.user_id
            OR row.assigned_to_user_id = v_request.user_id
            OR row.locked_by_user_id = v_request.user_id
            OR row.payload::text ~ v_identity_pattern
            OR row.evidence::text ~ v_identity_pattern
          );
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'admin_routing_rules' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.admin_routing_rules
        WHERE (assigned_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.admin_routing_rules
              WHERE (assigned_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.admin_routing_rules row
        SET assigned_user_id = NULL
        WHERE row.id = ANY(v_page) AND row.assigned_user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'extracted_candidates' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.extracted_candidates
        WHERE (assigned_to_user_id = v_request.user_id
               OR published_by_user_id = v_request.user_id
               OR verification_checklist::text ~ v_identity_pattern
               OR investigation_pack::text ~ v_identity_pattern
               OR provenance_records::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.extracted_candidates
              WHERE (assigned_to_user_id = v_request.user_id
                     OR published_by_user_id = v_request.user_id
                     OR verification_checklist::text ~ v_identity_pattern
                     OR investigation_pack::text ~ v_identity_pattern
                     OR provenance_records::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.extracted_candidates row
        SET assigned_to_user_id = CASE
              WHEN row.assigned_to_user_id = v_request.user_id
                THEN NULL ELSE row.assigned_to_user_id END,
            published_by_user_id = CASE
              WHEN row.published_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.published_by_user_id END,
            verification_checklist = oran_internal.scrub_json_identities_for_request(
              row.verification_checklist, v_request.user_id, v_request.text_tombstone
            ),
            investigation_pack = oran_internal.scrub_json_identities_for_request(
              row.investigation_pack, v_request.user_id, v_request.text_tombstone
            ),
            provenance_records = oran_internal.scrub_json_identities_for_request(
              row.provenance_records, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (
            row.assigned_to_user_id = v_request.user_id
            OR row.published_by_user_id = v_request.user_id
            OR row.verification_checklist::text ~ v_identity_pattern
            OR row.investigation_pack::text ~ v_identity_pattern
            OR row.provenance_records::text ~ v_identity_pattern
          );
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'tag_confirmation_queue' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.tag_confirmation_queue
        WHERE (assigned_to_user_id = v_request.user_id OR reviewed_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.tag_confirmation_queue
              WHERE (assigned_to_user_id = v_request.user_id OR reviewed_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.tag_confirmation_queue row
        SET assigned_to_user_id = CASE
              WHEN row.assigned_to_user_id = v_request.user_id
                THEN NULL ELSE row.assigned_to_user_id END,
            reviewed_by_user_id = CASE
              WHEN row.reviewed_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.reviewed_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.assigned_to_user_id = v_request.user_id
               OR row.reviewed_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'verification_queue_archive' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.verification_queue_archive
        WHERE assigned_to_user_id = v_request.user_id
           OR submitted_by_user_id = v_request.user_id
           OR created_by_user_id = v_request.user_id
           OR updated_by_user_id = v_request.user_id
           OR notes ~ v_identity_pattern
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.verification_queue_archive
              WHERE (assigned_to_user_id = v_request.user_id
                     OR submitted_by_user_id = v_request.user_id
                     OR created_by_user_id = v_request.user_id
                     OR updated_by_user_id = v_request.user_id
                     OR notes ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.verification_queue_archive row
        SET assigned_to_user_id = CASE
              WHEN row.assigned_to_user_id = v_request.user_id
                THEN NULL ELSE row.assigned_to_user_id END,
            submitted_by_user_id = CASE
              WHEN row.submitted_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.submitted_by_user_id END,
            created_by_user_id = CASE
              WHEN row.created_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE
              WHEN row.updated_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.updated_by_user_id END,
            notes = CASE WHEN row.submitted_by_user_id = v_request.user_id
              THEN NULL ELSE oran_internal.scrub_text_identities_for_request(
                row.notes, v_request.user_id, v_request.text_tombstone
              ) END
        WHERE row.id = ANY(v_page)
          AND (row.assigned_to_user_id = v_request.user_id
               OR row.submitted_by_user_id = v_request.user_id
               OR row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id
               OR row.notes ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'admin_review_profiles' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.admin_review_profiles
        WHERE (user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.admin_review_profiles
              WHERE (user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.admin_review_profiles row
        SET user_id = v_request.text_tombstone,
            is_active = false,
            is_accepting_new = false
        WHERE row.id = ANY(v_page) AND row.user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'user_scope_grants' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.user_scope_grants
        WHERE (user_id = v_request.user_id OR granted_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.user_scope_grants
              WHERE (user_id = v_request.user_id OR granted_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.user_scope_grants row
        SET user_id = CASE WHEN row.user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.user_id END,
            granted_by_user_id = CASE WHEN row.granted_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.granted_by_user_id END,
            is_active = CASE WHEN row.user_id = v_request.user_id
              THEN false ELSE row.is_active END
        WHERE row.id = ANY(v_page)
          AND (row.user_id = v_request.user_id
               OR row.granted_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'pending_scope_grants' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.pending_scope_grants
        WHERE (user_id = v_request.user_id OR requested_by_user_id = v_request.user_id OR decided_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.pending_scope_grants
              WHERE (user_id = v_request.user_id OR requested_by_user_id = v_request.user_id OR decided_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.pending_scope_grants row
        SET user_id = CASE WHEN row.user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.user_id END,
            requested_by_user_id = CASE WHEN row.requested_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.requested_by_user_id END,
            decided_by_user_id = CASE WHEN row.decided_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.decided_by_user_id END,
            status = CASE WHEN row.status = 'pending'
              AND (row.user_id = v_request.user_id
                   OR row.requested_by_user_id = v_request.user_id)
              THEN 'cancelled' ELSE row.status END,
            decided_at = CASE WHEN row.status = 'pending'
              AND (row.user_id = v_request.user_id
                   OR row.requested_by_user_id = v_request.user_id)
              THEN COALESCE(row.decided_at, pg_catalog.now()) ELSE row.decided_at END,
            decision_reason = CASE WHEN row.status = 'pending'
              AND (row.user_id = v_request.user_id
                   OR row.requested_by_user_id = v_request.user_id)
              THEN 'Account erased' ELSE row.decision_reason END
        WHERE row.id = ANY(v_page)
          AND (row.user_id = v_request.user_id
               OR row.requested_by_user_id = v_request.user_id
               OR row.decided_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'organization_members' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.organization_members
        WHERE (user_id = v_request.user_id OR invited_by_user_id = v_request.user_id OR created_by_user_id = v_request.user_id OR updated_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.organization_members
              WHERE (user_id = v_request.user_id OR invited_by_user_id = v_request.user_id OR created_by_user_id = v_request.user_id OR updated_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.organization_members row
        SET user_id = CASE WHEN row.user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.user_id END,
            status = CASE WHEN row.user_id = v_request.user_id
              THEN 'deactivated' ELSE row.status END,
            invited_by_user_id = CASE WHEN row.invited_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.invited_by_user_id END,
            created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.user_id = v_request.user_id
               OR row.invited_by_user_id = v_request.user_id
               OR row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'ownership_transfers' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.ownership_transfers
        WHERE (requested_by_user_id = v_request.user_id
               OR current_admin_user_id = v_request.user_id
               OR service_snapshot::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.ownership_transfers
              WHERE (requested_by_user_id = v_request.user_id
                     OR current_admin_user_id = v_request.user_id
                     OR service_snapshot::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.ownership_transfers row
        SET requested_by_user_id = CASE
              WHEN row.requested_by_user_id = v_request.user_id
                THEN v_request.text_tombstone ELSE row.requested_by_user_id END,
            current_admin_user_id = CASE
              WHEN row.current_admin_user_id = v_request.user_id
                THEN NULL ELSE row.current_admin_user_id END,
            status = CASE WHEN row.requested_by_user_id = v_request.user_id
              AND row.status IN ('pending','verified','approved')
              THEN 'cancelled' ELSE row.status END,
            verification_token = CASE WHEN row.requested_by_user_id = v_request.user_id
              THEN NULL ELSE row.verification_token END,
            verification_expires_at = CASE
              WHEN row.requested_by_user_id = v_request.user_id
              THEN NULL ELSE row.verification_expires_at END,
            transfer_notes = CASE WHEN row.requested_by_user_id = v_request.user_id
              THEN NULL ELSE row.transfer_notes END,
            admin_notes = CASE WHEN row.requested_by_user_id = v_request.user_id
              THEN NULL ELSE row.admin_notes END,
            rejection_reason = CASE WHEN row.requested_by_user_id = v_request.user_id
              THEN NULL ELSE row.rejection_reason END,
            service_snapshot = oran_internal.scrub_json_identities_for_request(
              row.service_snapshot, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (row.requested_by_user_id = v_request.user_id
               OR row.current_admin_user_id = v_request.user_id
               OR row.service_snapshot::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'ingestion_audit_events' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.ingestion_audit_events
        WHERE (actor_id = v_request.user_id
               OR details::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.ingestion_audit_events
              WHERE (actor_id = v_request.user_id
                     OR details::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.ingestion_audit_events row
        SET actor_id = CASE WHEN row.actor_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.actor_id END,
            details = oran_internal.scrub_json_identities_for_request(
              row.details, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (row.actor_id = v_request.user_id
               OR row.details::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'lifecycle_events' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.lifecycle_events
        WHERE (actor_id = v_request.user_id
               OR metadata::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.lifecycle_events
              WHERE (actor_id = v_request.user_id
                     OR metadata::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.lifecycle_events row
        SET actor_id = CASE WHEN row.actor_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.actor_id END,
            metadata = oran_internal.scrub_json_identities_for_request(
              row.metadata, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (row.actor_id = v_request.user_id
               OR row.metadata::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'llm_suggestions' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.llm_suggestions
        WHERE (reviewed_by = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.llm_suggestions
              WHERE (reviewed_by = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.llm_suggestions row SET reviewed_by = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.reviewed_by = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'source_feed_states' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT source_feed_id INTO v_high FROM public.source_feed_states
        WHERE auto_publish_approved_by = v_request.user_id
        ORDER BY source_feed_id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(source_feed_id ORDER BY source_feed_id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(source_feed_id ORDER BY source_feed_id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT source_feed_id FROM public.source_feed_states
              WHERE auto_publish_approved_by = v_request.user_id
                AND (v_step.cursor_uuid IS NULL OR source_feed_id > v_step.cursor_uuid)
                AND source_feed_id <= v_high
              ORDER BY source_feed_id LIMIT p_page_size) page;
        UPDATE public.source_feed_states row
        SET auto_publish_approved_by = v_request.text_tombstone
        WHERE row.source_feed_id = ANY(v_page)
          AND row.auto_publish_approved_by = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'import_batches' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.import_batches
        WHERE (imported_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.import_batches
              WHERE (imported_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.import_batches row
        SET imported_by_user_id = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.imported_by_user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'canonical_provenance' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.canonical_provenance
        WHERE (decided_by = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.canonical_provenance
              WHERE (decided_by = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.canonical_provenance row SET decided_by = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.decided_by = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'resolution_candidates' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.resolution_candidates
        WHERE (resolved_by = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.resolution_candidates
              WHERE (resolved_by = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.resolution_candidates row SET resolved_by = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.resolved_by = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'resolution_decisions' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.resolution_decisions
        WHERE (decided_by = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.resolution_decisions
              WHERE (decided_by = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.resolution_decisions row SET decided_by = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.decided_by = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'resource_tags' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.resource_tags
        WHERE (added_by = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.resource_tags
              WHERE (added_by = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.resource_tags row SET added_by = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.added_by = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'taxonomy_crosswalks' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.taxonomy_crosswalks
        WHERE (created_by = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.taxonomy_crosswalks
              WHERE (created_by = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.taxonomy_crosswalks row SET created_by = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.created_by = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'verified_service_links' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.verified_service_links
        WHERE (verified_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.verified_service_links
              WHERE (verified_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.verified_service_links row
        SET verified_by_user_id = v_request.text_tombstone
        WHERE row.id = ANY(v_page) AND row.verified_by_user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'verification_evidence' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.verification_evidence
        WHERE (submitted_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.verification_evidence
              WHERE (submitted_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.verification_evidence row
        SET submitted_by_user_id = v_request.text_tombstone,
            description = NULL,
            file_url = NULL,
            file_name = NULL,
            file_size_bytes = NULL
        WHERE row.id = ANY(v_page) AND row.submitted_by_user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'audit_logs' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.audit_logs
        WHERE (actor_user_id = v_request.user_id
               OR before::text ~ v_identity_pattern
               OR after::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.audit_logs
              WHERE (actor_user_id = v_request.user_id
                     OR before::text ~ v_identity_pattern
                     OR after::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.audit_logs row
        SET actor_user_id = CASE WHEN row.actor_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.actor_user_id END,
            before = CASE WHEN row.before IS NULL THEN NULL ELSE
              oran_internal.scrub_json_identities_for_request(
                row.before, v_request.user_id, v_request.text_tombstone
              ) END,
            after = CASE WHEN row.after IS NULL THEN NULL ELSE
              oran_internal.scrub_json_identities_for_request(
                row.after, v_request.user_id, v_request.text_tombstone
              ) END
        WHERE row.id = ANY(v_page)
          AND (row.actor_user_id = v_request.user_id
               OR row.before::text ~ v_identity_pattern
               OR row.after::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'scope_audit_log' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.scope_audit_log
        WHERE (actor_user_id = v_request.user_id
               OR target_id ~ v_identity_pattern
               OR before_state::text ~ v_identity_pattern
               OR after_state::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.scope_audit_log
              WHERE (actor_user_id = v_request.user_id
                     OR target_id ~ v_identity_pattern
                     OR before_state::text ~ v_identity_pattern
                     OR after_state::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.scope_audit_log row
        SET actor_user_id = CASE WHEN row.actor_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.actor_user_id END,
            target_id = oran_internal.scrub_text_identities_for_request(
              row.target_id, v_request.user_id, v_request.text_tombstone
            ),
            before_state = CASE WHEN row.before_state IS NULL THEN NULL ELSE
              oran_internal.scrub_json_identities_for_request(
                row.before_state, v_request.user_id, v_request.text_tombstone
              ) END,
            after_state = CASE WHEN row.after_state IS NULL THEN NULL ELSE
              oran_internal.scrub_json_identities_for_request(
                row.after_state, v_request.user_id, v_request.text_tombstone
              ) END
        WHERE row.id = ANY(v_page)
          AND (row.actor_user_id = v_request.user_id
               OR row.target_id ~ v_identity_pattern
               OR row.before_state::text ~ v_identity_pattern
               OR row.after_state::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'submission_transitions' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.submission_transitions
        WHERE (actor_user_id = v_request.user_id
               OR gates_checked::text ~ v_identity_pattern
               OR metadata::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.submission_transitions
              WHERE (actor_user_id = v_request.user_id
                     OR gates_checked::text ~ v_identity_pattern
                     OR metadata::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.submission_transitions row
        SET actor_user_id = CASE WHEN row.actor_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.actor_user_id END,
            gates_checked = oran_internal.scrub_json_identities_for_request(
              row.gates_checked, v_request.user_id, v_request.text_tombstone
            ),
            metadata = oran_internal.scrub_json_identities_for_request(
              row.metadata, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (row.actor_user_id = v_request.user_id
               OR row.gates_checked::text ~ v_identity_pattern
               OR row.metadata::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'resource_freshness_findings' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM oran_internal.resource_freshness_findings
        WHERE (original_integrity_held_by_user_id = v_request.user_id
               OR evidence::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM oran_internal.resource_freshness_findings
              WHERE (original_integrity_held_by_user_id = v_request.user_id
                     OR evidence::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE oran_internal.resource_freshness_findings row
        SET original_integrity_held_by_user_id = CASE
              WHEN row.original_integrity_held_by_user_id = v_request.user_id
                THEN v_request.text_tombstone
              ELSE row.original_integrity_held_by_user_id END,
            evidence = oran_internal.scrub_json_identities_for_request(
              row.evidence, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (row.original_integrity_held_by_user_id = v_request.user_id
               OR row.evidence::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'resource_quarantine_members' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT batch_id, service_id INTO v_high, v_high_2
        FROM oran_internal.resource_quarantine_members
        WHERE original_integrity_held_by_user_id = v_request.user_id
        ORDER BY batch_id DESC, service_id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; v_high_2 := v_step.highwater_uuid_2; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(batch_id ORDER BY batch_id, service_id), ARRAY[]::uuid[]),
               COALESCE(array_agg(service_id ORDER BY batch_id, service_id), ARRAY[]::uuid[]),
               count(*)::integer
        INTO v_page, v_page_2, v_scanned
        FROM (SELECT batch_id, service_id
              FROM oran_internal.resource_quarantine_members
              WHERE original_integrity_held_by_user_id = v_request.user_id
                AND (
                    v_step.cursor_uuid IS NULL
                    OR (batch_id, service_id) >
                       (v_step.cursor_uuid, v_step.cursor_uuid_2)
                  )
                AND (batch_id, service_id) <= (v_high, v_high_2)
              ORDER BY batch_id, service_id LIMIT p_page_size) page;
        IF v_scanned > 0 THEN
          v_last := v_page[v_scanned]; v_last_2 := v_page_2[v_scanned];
        END IF;
        UPDATE oran_internal.resource_quarantine_members row
        SET original_integrity_held_by_user_id = v_request.text_tombstone
        FROM pg_catalog.unnest(v_page, v_page_2) page(batch_id, service_id)
        WHERE row.batch_id = page.batch_id AND row.service_id = page.service_id
          AND row.original_integrity_held_by_user_id = v_request.user_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'resource_quarantine_batches' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM oran_internal.resource_quarantine_batches
        WHERE (created_by = v_request.user_id
               OR classifier::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM oran_internal.resource_quarantine_batches
              WHERE (created_by = v_request.user_id
                     OR classifier::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE oran_internal.resource_quarantine_batches row
        SET created_by = CASE WHEN row.created_by = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by END,
            classifier = oran_internal.scrub_json_identities_for_request(
              row.classifier, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (row.created_by = v_request.user_id
               OR row.classifier::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'hotline_authority_members' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT batch_id, service_id INTO v_high, v_high_2
        FROM oran_internal.hotline_authority_members
        WHERE original_service::text ~ v_identity_pattern
           OR applied_service::text ~ v_identity_pattern
           OR original_organization::text ~ v_identity_pattern
           OR applied_organization::text ~ v_identity_pattern
           OR original_phones::text ~ v_identity_pattern
           OR applied_phones::text ~ v_identity_pattern
        ORDER BY batch_id DESC, service_id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; v_high_2 := v_step.highwater_uuid_2; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(batch_id ORDER BY batch_id, service_id), ARRAY[]::uuid[]),
               COALESCE(array_agg(service_id ORDER BY batch_id, service_id), ARRAY[]::uuid[]),
               count(*)::integer
        INTO v_page, v_page_2, v_scanned
        FROM (SELECT batch_id, service_id
              FROM oran_internal.hotline_authority_members
              WHERE (
                  original_service::text ~ v_identity_pattern
                  OR applied_service::text ~ v_identity_pattern
                  OR original_organization::text ~ v_identity_pattern
                  OR applied_organization::text ~ v_identity_pattern
                  OR original_phones::text ~ v_identity_pattern
                  OR applied_phones::text ~ v_identity_pattern
                )
                AND (
                    v_step.cursor_uuid IS NULL
                    OR (batch_id, service_id) >
                       (v_step.cursor_uuid, v_step.cursor_uuid_2)
                  )
                AND (batch_id, service_id) <= (v_high, v_high_2)
              ORDER BY batch_id, service_id LIMIT p_page_size) page;
        IF v_scanned > 0 THEN
          v_last := v_page[v_scanned]; v_last_2 := v_page_2[v_scanned];
        END IF;
        UPDATE oran_internal.hotline_authority_members row
        SET original_service = oran_internal.scrub_json_identities_for_request(
              row.original_service, v_request.user_id, v_request.text_tombstone),
            applied_service = oran_internal.scrub_json_identities_for_request(
              row.applied_service, v_request.user_id, v_request.text_tombstone),
            original_organization = oran_internal.scrub_json_identities_for_request(
              row.original_organization, v_request.user_id, v_request.text_tombstone),
            applied_organization = oran_internal.scrub_json_identities_for_request(
              row.applied_organization, v_request.user_id, v_request.text_tombstone),
            original_phones = oran_internal.scrub_json_identities_for_request(
              row.original_phones, v_request.user_id, v_request.text_tombstone),
            applied_phones = oran_internal.scrub_json_identities_for_request(
              row.applied_phones, v_request.user_id, v_request.text_tombstone)
        FROM pg_catalog.unnest(v_page, v_page_2) page(batch_id, service_id)
        WHERE row.batch_id = page.batch_id AND row.service_id = page.service_id
          AND (row.original_service::text ~ v_identity_pattern
               OR row.applied_service::text ~ v_identity_pattern
               OR row.original_organization::text ~ v_identity_pattern
               OR row.applied_organization::text ~ v_identity_pattern
               OR row.original_phones::text ~ v_identity_pattern
               OR row.applied_phones::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'hotline_quarantined_contacts' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT batch_id, phone_id INTO v_high, v_high_2
        FROM oran_internal.hotline_quarantined_contacts
        WHERE phone_snapshot::text ~ v_identity_pattern
        ORDER BY batch_id DESC, phone_id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; v_high_2 := v_step.highwater_uuid_2; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(batch_id ORDER BY batch_id, phone_id), ARRAY[]::uuid[]),
               COALESCE(array_agg(phone_id ORDER BY batch_id, phone_id), ARRAY[]::uuid[]),
               count(*)::integer
        INTO v_page, v_page_2, v_scanned
        FROM (SELECT batch_id, phone_id
              FROM oran_internal.hotline_quarantined_contacts
              WHERE phone_snapshot::text ~ v_identity_pattern
                AND (
                    v_step.cursor_uuid IS NULL
                    OR (batch_id, phone_id) >
                       (v_step.cursor_uuid, v_step.cursor_uuid_2)
                  )
                AND (batch_id, phone_id) <= (v_high, v_high_2)
              ORDER BY batch_id, phone_id LIMIT p_page_size) page;
        IF v_scanned > 0 THEN
          v_last := v_page[v_scanned]; v_last_2 := v_page_2[v_scanned];
        END IF;
        UPDATE oran_internal.hotline_quarantined_contacts row
        SET phone_snapshot = oran_internal.scrub_json_identities_for_request(
          row.phone_snapshot, v_request.user_id, v_request.text_tombstone
        )
        FROM pg_catalog.unnest(v_page, v_page_2) page(batch_id, phone_id)
        WHERE row.batch_id = page.batch_id AND row.phone_id = page.phone_id
          AND row.phone_snapshot::text ~ v_identity_pattern;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'hotline_authority_added_contacts' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT batch_id, contact_key INTO v_high, v_high_text
        FROM oran_internal.hotline_authority_added_contacts
        WHERE phone_snapshot::text ~ v_identity_pattern
        ORDER BY batch_id DESC, contact_key DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; v_high_text := v_step.highwater_text; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(batch_id ORDER BY batch_id, contact_key), ARRAY[]::uuid[]),
               COALESCE(array_agg(contact_key ORDER BY batch_id, contact_key), ARRAY[]::text[]),
               count(*)::integer
        INTO v_page, v_page_text, v_scanned
        FROM (SELECT batch_id, contact_key
              FROM oran_internal.hotline_authority_added_contacts
              WHERE phone_snapshot::text ~ v_identity_pattern
                AND (
                    v_step.cursor_uuid IS NULL
                    OR (batch_id, contact_key) >
                       (v_step.cursor_uuid, v_step.cursor_text)
                  )
                AND (batch_id, contact_key) <= (v_high, v_high_text)
              ORDER BY batch_id, contact_key LIMIT p_page_size) page;
        IF v_scanned > 0 THEN
          v_last := v_page[v_scanned]; v_last_text := v_page_text[v_scanned];
        END IF;
        UPDATE oran_internal.hotline_authority_added_contacts row
        SET phone_snapshot = oran_internal.scrub_json_identities_for_request(
          row.phone_snapshot, v_request.user_id, v_request.text_tombstone
        )
        FROM pg_catalog.unnest(v_page, v_page_text) page(batch_id, contact_key)
        WHERE row.batch_id = page.batch_id AND row.contact_key = page.contact_key
          AND row.phone_snapshot::text ~ v_identity_pattern;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'hotline_authority_batches' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM oran_internal.hotline_authority_batches
        WHERE (created_by = v_request.user_id
               OR validation_summary::text ~ v_identity_pattern)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]),
               count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM oran_internal.hotline_authority_batches
              WHERE (created_by = v_request.user_id
                     OR validation_summary::text ~ v_identity_pattern)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE oran_internal.hotline_authority_batches row
        SET created_by = CASE WHEN row.created_by = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by END,
            validation_summary = oran_internal.scrub_json_identities_for_request(
              row.validation_summary, v_request.user_id, v_request.text_tombstone
            )
        WHERE row.id = ANY(v_page)
          AND (row.created_by = v_request.user_id
               OR row.validation_summary::text ~ v_identity_pattern);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'accessibility_for_disabilities' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.accessibility_for_disabilities
        WHERE ARRAY[created_by_user_id, updated_by_user_id]
                @> ARRAY[v_request.user_id]
          AND ((created_by_user_id IS NOT NULL
                AND created_by_user_id !~ '^import:')
               OR (updated_by_user_id IS NOT NULL
                   AND updated_by_user_id !~ '^import:'))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.accessibility_for_disabilities
              WHERE ARRAY[created_by_user_id, updated_by_user_id]
                      @> ARRAY[v_request.user_id]
                AND ((created_by_user_id IS NOT NULL
                      AND created_by_user_id !~ '^import:')
                     OR (updated_by_user_id IS NOT NULL
                         AND updated_by_user_id !~ '^import:'))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.accessibility_for_disabilities row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'addresses' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.addresses
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.addresses
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.addresses row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'contacts' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.contacts
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.contacts
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.contacts row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'coverage_zones' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.coverage_zones
        WHERE (ARRAY[created_by_user_id, updated_by_user_id, assigned_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
                                     OR (assigned_user_id IS NOT NULL AND assigned_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.coverage_zones
              WHERE (ARRAY[created_by_user_id, updated_by_user_id, assigned_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
                                           OR (assigned_user_id IS NOT NULL AND assigned_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.coverage_zones row
        SET assigned_user_id = CASE WHEN row.assigned_user_id = v_request.user_id
              THEN NULL ELSE row.assigned_user_id END,
            created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.assigned_user_id = v_request.user_id
               OR row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'dietary_options' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.dietary_options
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.dietary_options
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.dietary_options row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'eligibility' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.eligibility
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.eligibility
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.eligibility row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'feature_flags' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.feature_flags
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.feature_flags
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.feature_flags row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'form_templates' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.form_templates
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.form_templates
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.form_templates row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'languages' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.languages
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.languages
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.languages row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'locations' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.locations
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.locations
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.locations row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'organizations' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.organizations
        WHERE (
            ARRAY[created_by_user_id, updated_by_user_id]
              @> ARRAY[v_request.user_id]
            AND ((created_by_user_id IS NOT NULL
                  AND created_by_user_id !~ '^import:')
                 OR (updated_by_user_id IS NOT NULL
                     AND updated_by_user_id !~ '^import:'))
          ) OR (
            v_request.profile_id IS NOT NULL
            AND verified_by_user_id = v_request.profile_id
          )
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.organizations
              WHERE ((
                  ARRAY[created_by_user_id, updated_by_user_id]
                    @> ARRAY[v_request.user_id]
                  AND ((created_by_user_id IS NOT NULL
                        AND created_by_user_id !~ '^import:')
                       OR (updated_by_user_id IS NOT NULL
                           AND updated_by_user_id !~ '^import:'))
                ) OR (
                  v_request.profile_id IS NOT NULL
                  AND verified_by_user_id = v_request.profile_id
                ))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.organizations row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END,
            verified_by_user_id = CASE WHEN v_request.profile_id IS NOT NULL
              AND row.verified_by_user_id = v_request.profile_id
              THEN v_request.uuid_tombstone ELSE row.verified_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id
               OR (v_request.profile_id IS NOT NULL
                   AND row.verified_by_user_id = v_request.profile_id));
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'phones' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.phones
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.phones
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.phones row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'programs' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.programs
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.programs
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.programs row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'required_documents' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.required_documents
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.required_documents
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.required_documents row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'schedules' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.schedules
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.schedules
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.schedules row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'service_adaptations' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.service_adaptations
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.service_adaptations
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.service_adaptations row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'service_areas' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.service_areas
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.service_areas
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.service_areas row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'service_at_location' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.service_at_location
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.service_at_location
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.service_at_location row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'service_attributes' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.service_attributes
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.service_attributes
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.service_attributes row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'service_taxonomy' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.service_taxonomy
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.service_taxonomy
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.service_taxonomy row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'services' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.services
        WHERE (ARRAY[created_by_user_id, updated_by_user_id, integrity_held_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
                                     OR (integrity_held_by_user_id IS NOT NULL AND integrity_held_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.services
              WHERE (ARRAY[created_by_user_id, updated_by_user_id, integrity_held_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')
                                           OR (integrity_held_by_user_id IS NOT NULL AND integrity_held_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.services row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END,
            integrity_held_by_user_id = CASE
              WHEN row.integrity_held_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.integrity_held_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id
               OR row.integrity_held_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'staging_locations' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.staging_locations
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.staging_locations
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.staging_locations row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'staging_organizations' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.staging_organizations
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.staging_organizations
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.staging_organizations row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'staging_services' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.staging_services
        WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                   AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                     OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.staging_services
              WHERE (ARRAY[created_by_user_id, updated_by_user_id] @> ARRAY[v_request.user_id]
                                         AND ((created_by_user_id IS NOT NULL AND created_by_user_id !~ '^import:')
                                           OR (updated_by_user_id IS NOT NULL AND updated_by_user_id !~ '^import:')))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.staging_services row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'taxonomy_terms' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.taxonomy_terms
        WHERE ARRAY[created_by_user_id, updated_by_user_id]
                @> ARRAY[v_request.user_id]
          AND ((created_by_user_id IS NOT NULL
                AND created_by_user_id !~ '^import:')
               OR (updated_by_user_id IS NOT NULL
                   AND updated_by_user_id !~ '^import:'))
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.taxonomy_terms
              WHERE ARRAY[created_by_user_id, updated_by_user_id]
                      @> ARRAY[v_request.user_id]
                AND ((created_by_user_id IS NOT NULL
                      AND created_by_user_id !~ '^import:')
                     OR (updated_by_user_id IS NOT NULL
                         AND updated_by_user_id !~ '^import:'))
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.taxonomy_terms row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END
        WHERE row.id = ANY(v_page)
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'user_profiles_refs' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.user_profiles
        WHERE user_id IS DISTINCT FROM v_request.user_id
          AND (created_by_user_id = v_request.user_id
               OR updated_by_user_id = v_request.user_id
               OR suspended_by_user_id = v_request.user_id
               OR restored_by_user_id = v_request.user_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.user_profiles
              WHERE user_id IS DISTINCT FROM v_request.user_id
                AND (created_by_user_id = v_request.user_id
                     OR updated_by_user_id = v_request.user_id
                     OR suspended_by_user_id = v_request.user_id
                     OR restored_by_user_id = v_request.user_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.user_profiles row
        SET created_by_user_id = CASE WHEN row.created_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.created_by_user_id END,
            updated_by_user_id = CASE WHEN row.updated_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.updated_by_user_id END,
            suspended_by_user_id = CASE WHEN row.suspended_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.suspended_by_user_id END,
            restored_by_user_id = CASE WHEN row.restored_by_user_id = v_request.user_id
              THEN v_request.text_tombstone ELSE row.restored_by_user_id END
        WHERE row.id = ANY(v_page)
          AND row.user_id IS DISTINCT FROM v_request.user_id
          AND (row.created_by_user_id = v_request.user_id
               OR row.updated_by_user_id = v_request.user_id
               OR row.suspended_by_user_id = v_request.user_id
               OR row.restored_by_user_id = v_request.user_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    WHEN 'org_service_scope' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.org_service_scope
        WHERE v_request.profile_id IS NOT NULL
          AND (user_id = v_request.profile_id
               OR granted_by = v_request.profile_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.org_service_scope
              WHERE v_request.profile_id IS NOT NULL
                AND (user_id = v_request.profile_id
                     OR granted_by = v_request.profile_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.org_service_scope row
        SET granted_by = v_request.uuid_tombstone
        WHERE row.id = ANY(v_page)
          AND v_request.profile_id IS NOT NULL
          AND row.granted_by = v_request.profile_id
          AND row.user_id IS DISTINCT FROM v_request.profile_id;
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        DELETE FROM public.org_service_scope row
        WHERE row.id = ANY(v_page)
          AND v_request.profile_id IS NOT NULL
          AND row.user_id = v_request.profile_id;
        GET DIAGNOSTICS v_extra = ROW_COUNT;
        v_changed := v_changed + v_extra;
      END IF;

    WHEN 'content_templates' THEN
      IF NOT v_step.highwater_captured THEN
        SELECT id INTO v_high FROM public.content_templates
        WHERE v_request.profile_id IS NOT NULL
          AND (created_by = v_request.profile_id
               OR updated_by = v_request.profile_id)
        ORDER BY id DESC LIMIT 1;
      ELSE v_high := v_step.highwater_uuid; END IF;
      IF v_high IS NOT NULL THEN
        SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer, (array_agg(id ORDER BY id DESC))[1]
        INTO v_page, v_scanned, v_last
        FROM (SELECT id FROM public.content_templates
              WHERE v_request.profile_id IS NOT NULL
                AND (created_by = v_request.profile_id
                     OR updated_by = v_request.profile_id)
                AND (v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid)
                AND id <= v_high
              ORDER BY id LIMIT p_page_size) page;
        UPDATE public.content_templates row
        SET created_by = CASE WHEN v_request.profile_id IS NOT NULL
              AND row.created_by = v_request.profile_id
              THEN v_request.uuid_tombstone ELSE row.created_by END,
            updated_by = CASE WHEN v_request.profile_id IS NOT NULL
              AND row.updated_by = v_request.profile_id
              THEN v_request.uuid_tombstone ELSE row.updated_by END
        WHERE row.id = ANY(v_page)
          AND v_request.profile_id IS NOT NULL
          AND (row.created_by = v_request.profile_id
               OR row.updated_by = v_request.profile_id);
        GET DIAGNOSTICS v_changed = ROW_COUNT;
      END IF;

    ELSE
      RAISE EXCEPTION 'unrecognized checked account erasure step';
  END CASE;

  IF NOT v_step.highwater_captured THEN
    v_step.highwater_captured := true;
    v_step.highwater_uuid := v_high;
    v_step.highwater_uuid_2 := v_high_2;
    v_step.highwater_text := v_high_text;
  END IF;

  IF NOT v_exhausted THEN
    v_exhausted := v_step.highwater_uuid IS NULL
      OR v_scanned < p_page_size
      OR (
        v_step.highwater_uuid_2 IS NOT NULL
        AND (v_last, v_last_2) >=
            (v_step.highwater_uuid, v_step.highwater_uuid_2)
      )
      OR (
        v_step.highwater_text IS NOT NULL
        AND (v_last, v_last_text) >=
            (v_step.highwater_uuid, v_step.highwater_text)
      )
      OR (
        v_step.highwater_uuid_2 IS NULL
        AND v_step.highwater_text IS NULL
        AND v_last IS NOT NULL
        AND v_last >= v_step.highwater_uuid
      );
  END IF;

  v_pass_changed := v_step.pass_rows_changed + v_changed;
  -- Pass one is never terminal, even when it observes zero changes. Without a
  -- relation-wide writer trigger, a fresh high-water verification pass closes
  -- the pass-one race. Pass three is the finite terminal boundary.
  IF v_exhausted AND v_pass_changed = 0 AND v_step.pass >= 2 THEN
    UPDATE oran_internal.account_erasure_steps step
    SET status = 'done',
        highwater_captured = true,
        cursor_uuid = COALESCE(v_last, step.cursor_uuid),
        cursor_uuid_2 = COALESCE(v_last_2, step.cursor_uuid_2),
        cursor_text = COALESCE(v_last_text, step.cursor_text),
        highwater_uuid = v_step.highwater_uuid,
        highwater_uuid_2 = v_step.highwater_uuid_2,
        highwater_text = v_step.highwater_text,
        rows_scanned = step.rows_scanned + v_scanned,
        rows_changed = step.rows_changed + v_changed,
        completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE step.request_id = p_request_id AND step.step_name = v_step.step_name;
  ELSIF v_exhausted AND v_step.pass < 3 THEN
    UPDATE oran_internal.account_erasure_steps step
    SET status = 'running',
        pass = step.pass + 1,
        highwater_captured = false,
        cursor_uuid = NULL,
        cursor_uuid_2 = NULL,
        cursor_text = NULL,
        highwater_uuid = NULL,
        highwater_uuid_2 = NULL,
        highwater_text = NULL,
        pass_rows_changed = 0,
        rows_scanned = step.rows_scanned + v_scanned,
        rows_changed = step.rows_changed + v_changed,
        updated_at = pg_catalog.now()
    WHERE step.request_id = p_request_id AND step.step_name = v_step.step_name;
  ELSIF v_exhausted THEN
    UPDATE oran_internal.account_erasure_steps step
    SET status = 'blocked',
        pass_rows_changed = v_pass_changed,
        rows_scanned = step.rows_scanned + v_scanned,
        rows_changed = step.rows_changed + v_changed,
        updated_at = pg_catalog.now()
    WHERE step.request_id = p_request_id AND step.step_name = v_step.step_name;
    UPDATE oran_internal.account_erasure_requests request
    SET status = 'blocked',
        blocked_at = pg_catalog.now(),
        last_error_code = 'writer_reintroduction_detected',
        lease_expires_at = NULL
    WHERE request.id = p_request_id;
  ELSE
    UPDATE oran_internal.account_erasure_steps step
    SET status = 'running',
        highwater_captured = true,
        cursor_uuid = COALESCE(v_last, step.cursor_uuid),
        cursor_uuid_2 = COALESCE(v_last_2, step.cursor_uuid_2),
        cursor_text = COALESCE(v_last_text, step.cursor_text),
        highwater_uuid = v_step.highwater_uuid,
        highwater_uuid_2 = v_step.highwater_uuid_2,
        highwater_text = v_step.highwater_text,
        pass_rows_changed = v_pass_changed,
        rows_scanned = step.rows_scanned + v_scanned,
        rows_changed = step.rows_changed + v_changed,
        updated_at = pg_catalog.now()
    WHERE step.request_id = p_request_id AND step.step_name = v_step.step_name;
  END IF;

  UPDATE oran_internal.account_erasure_requests request
  SET rows_scrubbed = request.rows_scrubbed + v_changed,
      lease_expires_at = NULL,
      next_attempt_at = pg_catalog.now()
  WHERE request.id = p_request_id;

  SELECT request.status INTO request_status
  FROM oran_internal.account_erasure_requests request
  WHERE request.id = p_request_id;
  IF request_status = 'blocked' THEN
    current_step := v_step.step_name;
    next_step := 'operator_review';
    clerk_deleted := true;
    completed := false;
    scanned := v_scanned;
    changed := v_changed;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT step.step_name INTO next_step
  FROM oran_internal.account_erasure_steps step
  WHERE step.request_id = p_request_id
    AND step.status IN ('pending', 'running')
  ORDER BY step.ordinal
  LIMIT 1;

  IF next_step IS NULL THEN
    v_result := oran_internal.finalize_account_erasure(p_request_id);
    request_status := 'completed';
    current_step := v_step.step_name;
    clerk_deleted := true;
    completed := true;
  ELSE
    request_status := 'processing';
    current_step := v_step.step_name;
    clerk_deleted := true;
    completed := false;
  END IF;
  scanned := v_scanned;
  changed := v_changed;
  RETURN NEXT;
END
$function$;

-- Compatibility guard for older workers. This function performs no scrub; it
-- can only finalize a request whose Clerk deletion and checked manifest have
-- already completed.
CREATE OR REPLACE FUNCTION oran_internal.complete_account_erasure(
  p_request_id uuid,
  p_user_id text,
  p_clerk_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request oran_internal.account_erasure_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM oran_internal.account_erasure_requests request
  WHERE request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.user_digest IS DISTINCT FROM oran_internal.identity_digest(p_user_id)
     OR v_request.clerk_user_digest IS DISTINCT FROM
        oran_internal.identity_digest(p_clerk_user_id) THEN
    RAISE EXCEPTION 'account erasure identity mismatch';
  END IF;
  IF v_request.status = 'completed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'completed', 'completed', true, 'alreadyCompleted', true
    );
  END IF;
  IF v_request.user_id IS DISTINCT FROM p_user_id
     OR v_request.clerk_user_id IS DISTINCT FROM p_clerk_user_id THEN
    RAISE EXCEPTION 'account erasure identity mismatch';
  END IF;
  RETURN oran_internal.finalize_account_erasure(p_request_id);
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.export_user_governance_data(
  p_user_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH subject_submission_rows AS MATERIALIZED (
    SELECT submission.id, submission.submission_type, submission.status,
           submission.service_id, submission.target_type,
           CASE WHEN submission.target_type = 'user'
             THEN NULL ELSE submission.target_id END AS target_id,
           submission.title, submission.notes,
           submission.priority, submission.sla_deadline,
           submission.sla_breached, submission.submitted_at,
           submission.created_at, submission.updated_at
    FROM public.submissions submission
    WHERE submission.submitted_by_user_id = p_user_id
    ORDER BY submission.created_at DESC, submission.id
    LIMIT 1001
  ),
  admin_profile_rows AS MATERIALIZED (
    SELECT profile.id, profile.is_active, profile.is_accepting_new,
           profile.coverage_zone_id, profile.coverage_states,
           profile.coverage_counties, profile.category_expertise,
           profile.created_at, profile.updated_at
    FROM public.admin_review_profiles profile
    WHERE profile.user_id = p_user_id
    ORDER BY profile.created_at DESC, profile.id
    LIMIT 101
  ),
  scope_grant_rows AS MATERIALIZED (
    SELECT grant_row.id, grant_row.scope_id, grant_row.organization_id,
           grant_row.granted_at, grant_row.expires_at,
           grant_row.is_active, grant_row.created_at,
           grant_row.user_id = p_user_id AS subject_is_grantee,
           grant_row.granted_by_user_id = p_user_id AS subject_is_grantor
    FROM public.user_scope_grants grant_row
    WHERE grant_row.user_id = p_user_id
       OR grant_row.granted_by_user_id = p_user_id
    ORDER BY grant_row.created_at DESC, grant_row.id
    LIMIT 1001
  ),
  pending_grant_rows AS MATERIALIZED (
    SELECT pending.id, pending.scope_id, pending.organization_id,
           pending.status, pending.requested_at, pending.decided_at,
           pending.expires_at, pending.created_at,
           pending.user_id = p_user_id AS subject_is_target,
           pending.requested_by_user_id = p_user_id AS subject_is_requester,
           pending.decided_by_user_id = p_user_id AS subject_is_decider,
           CASE WHEN pending.requested_by_user_id = p_user_id
             THEN pending.justification ELSE NULL END AS requester_justification
    FROM public.pending_scope_grants pending
    WHERE pending.user_id = p_user_id
       OR pending.requested_by_user_id = p_user_id
       OR pending.decided_by_user_id = p_user_id
    ORDER BY pending.created_at DESC, pending.id
    LIMIT 1001
  ),
  ownership_transfer_rows AS MATERIALIZED (
    SELECT transfer.id, transfer.service_id, transfer.organization_id,
           transfer.verification_method, transfer.status,
           transfer.created_at, transfer.updated_at,
           transfer.requested_by_user_id = p_user_id AS subject_is_requester,
           transfer.current_admin_user_id = p_user_id AS subject_is_current_admin,
           CASE WHEN transfer.requested_by_user_id = p_user_id
             THEN transfer.transfer_notes ELSE NULL END AS requester_notes
    FROM public.ownership_transfers transfer
    WHERE transfer.requested_by_user_id = p_user_id
       OR transfer.current_admin_user_id = p_user_id
    ORDER BY transfer.created_at DESC, transfer.id
    LIMIT 1001
  ),
  transition_rows AS MATERIALIZED (
    SELECT transition.id, transition.submission_id,
           transition.from_status, transition.to_status,
           transition.actor_user_id = p_user_id AS subject_is_actor,
           transition.created_at
    FROM public.submission_transitions transition
    WHERE transition.actor_user_id = p_user_id
       OR EXISTS (
         SELECT 1 FROM public.submissions authored
         WHERE authored.id = transition.submission_id
           AND authored.submitted_by_user_id = p_user_id
       )
    ORDER BY transition.created_at DESC, transition.id
    LIMIT 5001
  ),
  lifecycle_rows AS MATERIALIZED (
    SELECT event.id, event.entity_type, event.entity_id,
           event.event_type, event.from_status, event.to_status,
           event.created_at
    FROM public.lifecycle_events event
    WHERE event.actor_id = p_user_id
    ORDER BY event.created_at DESC, event.id
    LIMIT 5001
  ),
  form_rows AS MATERIALIZED (
    SELECT * FROM (
      SELECT instance.id, instance.submission_id, instance.template_id,
             instance.template_version, instance.storage_scope,
             instance.owner_organization_id, instance.coverage_zone_id,
             CASE WHEN instance.recipient_user_id = p_user_id
               THEN instance.recipient_role ELSE NULL END AS recipient_role,
             true AS subject_is_author,
             instance.recipient_user_id = p_user_id AS subject_is_recipient,
             instance.created_at, instance.updated_at
      FROM public.form_instances instance
      WHERE EXISTS (
        SELECT 1 FROM public.submissions authored
        WHERE authored.id = instance.submission_id
          AND authored.submitted_by_user_id = p_user_id
      )
      UNION ALL
      SELECT instance.id, instance.submission_id, instance.template_id,
             instance.template_version, instance.storage_scope,
             NULL::uuid, NULL::uuid, instance.recipient_role,
             false, true, instance.created_at, instance.updated_at
      FROM public.form_instances instance
      WHERE instance.recipient_user_id = p_user_id
        AND NOT EXISTS (
          SELECT 1 FROM public.submissions authored
          WHERE authored.id = instance.submission_id
            AND authored.submitted_by_user_id = p_user_id
        )
    ) combined
    ORDER BY combined.created_at DESC, combined.id
    LIMIT 1001
  ),
  source_assertion_rows AS MATERIALIZED (
    SELECT record.id, record.source_record_type, record.source_record_id,
           record.processing_status, record.created_at
    FROM public.source_records record
    WHERE EXISTS (
      SELECT 1 FROM public.submissions authored
      WHERE authored.submitted_by_user_id = p_user_id
        AND authored.id::text = record.raw_payload ->> 'submissionId'
    )
    ORDER BY record.created_at DESC, record.id
    LIMIT 2001
  ),
  evidence_rows AS MATERIALIZED (
    SELECT evidence.id, evidence.evidence_type, evidence.description,
           evidence.file_name, evidence.file_size_bytes,
           evidence.submission_id, evidence.created_at
    FROM public.verification_evidence evidence
    WHERE evidence.submitted_by_user_id = p_user_id
    ORDER BY evidence.created_at DESC, evidence.id
    LIMIT 1001
  )
  SELECT pg_catalog.jsonb_build_object(
    'subjectSubmissions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM subject_submission_rows
            ORDER BY created_at DESC, id LIMIT 1000) rows
    ), '[]'::jsonb),
    'adminReviewProfiles', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM admin_profile_rows
            ORDER BY created_at DESC, id LIMIT 100) rows
    ), '[]'::jsonb),
    'scopeGrants', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM scope_grant_rows
            ORDER BY created_at DESC, id LIMIT 1000) rows
    ), '[]'::jsonb),
    'pendingScopeGrants', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM pending_grant_rows
            ORDER BY created_at DESC, id LIMIT 1000) rows
    ), '[]'::jsonb),
    'ownershipTransfers', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM ownership_transfer_rows
            ORDER BY created_at DESC, id LIMIT 1000) rows
    ), '[]'::jsonb),
    'workflowTransitions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM transition_rows
            ORDER BY created_at DESC, id LIMIT 5000) rows
    ), '[]'::jsonb),
    'lifecycleEvents', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM lifecycle_rows
            ORDER BY created_at DESC, id LIMIT 5000) rows
    ), '[]'::jsonb),
    'formInstances', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM form_rows
            ORDER BY created_at DESC, id LIMIT 1000) rows
    ), '[]'::jsonb),
    'sourceAssertions', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM source_assertion_rows
            ORDER BY created_at DESC, id LIMIT 2000) rows
    ), '[]'::jsonb),
    'verificationEvidence', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rows)
        ORDER BY rows.created_at DESC, rows.id)
      FROM (SELECT * FROM evidence_rows
            ORDER BY created_at DESC, id LIMIT 1000) rows
    ), '[]'::jsonb),
    'exportMetadata', pg_catalog.jsonb_build_object(
      'bounded', true,
      'buckets', pg_catalog.jsonb_build_object(
        'subjectSubmissions', pg_catalog.jsonb_build_object(
          'limit', 1000,
          'returned', LEAST((SELECT count(*) FROM subject_submission_rows), 1000),
          'hasMore', (SELECT count(*) > 1000 FROM subject_submission_rows),
          'truncated', (SELECT count(*) > 1000 FROM subject_submission_rows)
        ),
        'adminReviewProfiles', pg_catalog.jsonb_build_object(
          'limit', 100,
          'returned', LEAST((SELECT count(*) FROM admin_profile_rows), 100),
          'hasMore', (SELECT count(*) > 100 FROM admin_profile_rows),
          'truncated', (SELECT count(*) > 100 FROM admin_profile_rows)
        ),
        'scopeGrants', pg_catalog.jsonb_build_object(
          'limit', 1000,
          'returned', LEAST((SELECT count(*) FROM scope_grant_rows), 1000),
          'hasMore', (SELECT count(*) > 1000 FROM scope_grant_rows),
          'truncated', (SELECT count(*) > 1000 FROM scope_grant_rows)
        ),
        'pendingScopeGrants', pg_catalog.jsonb_build_object(
          'limit', 1000,
          'returned', LEAST((SELECT count(*) FROM pending_grant_rows), 1000),
          'hasMore', (SELECT count(*) > 1000 FROM pending_grant_rows),
          'truncated', (SELECT count(*) > 1000 FROM pending_grant_rows)
        ),
        'ownershipTransfers', pg_catalog.jsonb_build_object(
          'limit', 1000,
          'returned', LEAST((SELECT count(*) FROM ownership_transfer_rows), 1000),
          'hasMore', (SELECT count(*) > 1000 FROM ownership_transfer_rows),
          'truncated', (SELECT count(*) > 1000 FROM ownership_transfer_rows)
        ),
        'workflowTransitions', pg_catalog.jsonb_build_object(
          'limit', 5000,
          'returned', LEAST((SELECT count(*) FROM transition_rows), 5000),
          'hasMore', (SELECT count(*) > 5000 FROM transition_rows),
          'truncated', (SELECT count(*) > 5000 FROM transition_rows)
        ),
        'lifecycleEvents', pg_catalog.jsonb_build_object(
          'limit', 5000,
          'returned', LEAST((SELECT count(*) FROM lifecycle_rows), 5000),
          'hasMore', (SELECT count(*) > 5000 FROM lifecycle_rows),
          'truncated', (SELECT count(*) > 5000 FROM lifecycle_rows)
        ),
        'formInstances', pg_catalog.jsonb_build_object(
          'limit', 1000,
          'returned', LEAST((SELECT count(*) FROM form_rows), 1000),
          'hasMore', (SELECT count(*) > 1000 FROM form_rows),
          'truncated', (SELECT count(*) > 1000 FROM form_rows)
        ),
        'sourceAssertions', pg_catalog.jsonb_build_object(
          'limit', 2000,
          'returned', LEAST((SELECT count(*) FROM source_assertion_rows), 2000),
          'hasMore', (SELECT count(*) > 2000 FROM source_assertion_rows),
          'truncated', (SELECT count(*) > 2000 FROM source_assertion_rows)
        ),
        'verificationEvidence', pg_catalog.jsonb_build_object(
          'limit', 1000,
          'returned', LEAST((SELECT count(*) FROM evidence_rows), 1000),
          'hasMore', (SELECT count(*) > 1000 FROM evidence_rows),
          'truncated', (SELECT count(*) > 1000 FROM evidence_rows)
        )
      ),
      'omitted', pg_catalog.jsonb_build_array(
        'thirdPartyIdentityFields', 'reviewerInternalFields',
        'attachmentStoragePaths', 'rawSourcePayloads',
        'highVolumeAttributionReferences', 'unstructuredSubmissionPayloads',
        'unstructuredSubmissionEvidence', 'unstructuredFormData'
      )
    )
  );
$function$;

-- Do not turn attribution-only scrub pages into resource freshness events.
-- Setting the custom GUC is insufficient: the current user must also own the
-- private bounded dispatcher.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_erasure_owner text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(proc.proowner)
  INTO v_erasure_owner
  FROM pg_catalog.pg_proc proc
  WHERE proc.oid =
    'oran_internal.process_account_erasure_page(uuid,integer)'::pg_catalog.regprocedure;

  IF pg_catalog.current_setting('oran.erasure_mode', true) = 'on'
     AND current_user = v_erasure_owner THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION oran_internal.identity_digest(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.replace_json_text(jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.remove_json_keys(jsonb, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.regex_quote(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.scrub_json_identities(jsonb, text, text, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.scrub_text_identities(text, text, text, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.scrub_json_identities_for_request(jsonb, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.scrub_text_identities_for_request(text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.json_text_leaves(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.reject_erased_identity_reintroduction()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.is_account_erased(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.queue_account_erasure(text, text, text, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.claim_account_erasure_requests(integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.record_account_erasure_failure(uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.mark_clerk_account_deleted(uuid, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.finalize_account_erasure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.process_account_erasure_page(uuid, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.complete_account_erasure(uuid, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.export_user_governance_data(text) FROM PUBLIC;

DO $acl$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'oran_runtime',
    'oran_backend_runtime'
  ]
  LOOP
    IF pg_catalog.to_regrole(v_role) IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON TABLE oran_internal.account_erasure_requests FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON TABLE oran_internal.account_erasure_steps FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON TABLE '
        || 'oran_internal.account_erasure_identity_blocks FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION oran_internal.identity_digest(text) FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.replace_json_text(jsonb,text,text) FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.remove_json_keys(jsonb,text[]) FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION oran_internal.regex_quote(text) FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.scrub_json_identities(jsonb,text,text,uuid,text) '
        || 'FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.scrub_text_identities(text,text,text,uuid,text) '
        || 'FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.scrub_json_identities_for_request(jsonb,text,text) '
        || 'FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.scrub_text_identities_for_request(text,text,text) '
        || 'FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION oran_internal.json_text_leaves(jsonb) '
        || 'FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.reject_erased_identity_reintroduction() FROM %I',
        v_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION '
        || 'oran_internal.finalize_account_erasure(uuid) FROM %I',
        v_role
      );
    END IF;
  END LOOP;

  IF pg_catalog.to_regrole('oran_backend_runtime') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION '
      || 'oran_internal.is_account_erased(text) TO oran_backend_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '
      || 'oran_internal.queue_account_erasure(text,text,text,uuid) '
      || 'TO oran_backend_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '
      || 'oran_internal.claim_account_erasure_requests(integer) '
      || 'TO oran_backend_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '
      || 'oran_internal.record_account_erasure_failure(uuid,text) '
      || 'TO oran_backend_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '
      || 'oran_internal.mark_clerk_account_deleted(uuid,text,text) '
      || 'TO oran_backend_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '
      || 'oran_internal.process_account_erasure_page(uuid,integer) '
      || 'TO oran_backend_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '
      || 'oran_internal.export_user_governance_data(text) '
      || 'TO oran_backend_runtime';
  END IF;
END
$acl$;

COMMENT ON TABLE oran_internal.account_erasure_requests IS
  'Private revocation-first outbox for Clerk deletion and bounded identity erasure.';
COMMENT ON TABLE oran_internal.account_erasure_steps IS
  'Checked, finite, high-water account-erasure manifest; one PK page per worker call.';
COMMENT ON TABLE oran_internal.account_erasure_identity_blocks IS
  'Private digest-only write gate that prevents erased identities from being reintroduced.';
COMMENT ON FUNCTION oran_internal.is_account_erased(text) IS
  'Index-backed fail-closed block that remains true in every request state.';
COMMENT ON FUNCTION oran_internal.queue_account_erasure(text, text, text, uuid) IS
  'Queues an idempotent request and freezes application authorization before Clerk deletion.';
COMMENT ON FUNCTION oran_internal.mark_clerk_account_deleted(uuid, text, text) IS
  'Durably records successful or idempotent-not-found Clerk deletion.';
COMMENT ON FUNCTION oran_internal.process_account_erasure_page(uuid, integer) IS
  'Processes one 500-2000 row checked PK page and advances a finite verification pass.';
COMMENT ON FUNCTION oran_internal.complete_account_erasure(uuid, text, text) IS
  'Compatibility finalizer that refuses to run before Clerk deletion and every step is done.';
COMMENT ON FUNCTION oran_internal.export_user_governance_data(text) IS
  'Exports bounded privacy-filtered governance data with per-bucket truncation metadata.';

COMMIT;
