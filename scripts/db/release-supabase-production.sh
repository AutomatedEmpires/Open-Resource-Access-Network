#!/usr/bin/env bash

set -euo pipefail

usage="usage: release-supabase-production.sh <project-ref> [session-pooler-host]"
project_ref="${1:?$usage}"
session_pooler_host="${2:-aws-0-us-east-1.pooler.supabase.com}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ! "$project_ref" =~ ^[a-z]{20}$ ]]; then
  echo "Invalid Supabase project ref." >&2
  exit 1
fi
if [[ ! "$session_pooler_host" =~ ^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$ ]]; then
  echo "Invalid Supabase session pooler host." >&2
  exit 1
fi

cd "$repository_root"

access_token="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$access_token" ]]; then
  token_file="${SUPABASE_ACCESS_TOKEN_FILE:-$HOME/.supabase/access-token}"
  if [[ ! -r "$token_file" ]]; then
    echo "Supabase access token is required." >&2
    exit 1
  fi
  access_token="$(tr -d '\r\n' < "$token_file")"
fi
if [[ ! "$access_token" =~ ^sbp_[A-Za-z0-9]{40}$ ]]; then
  echo "Supabase access token has an unexpected format." >&2
  exit 1
fi

backups_response="$({
  curl --fail --silent --show-error \
    --header "Authorization: Bearer $access_token" \
    "https://api.supabase.com/v1/projects/$project_ref/database/backups"
} 2>&1)" || {
  printf '%s\n' "$backups_response" >&2
  exit 1
}
backup_summary="$(
  printf '%s' "$backups_response" | node --input-type=module -e '
    let body = "";
    for await (const chunk of process.stdin) body += chunk;
    const response = JSON.parse(body);
    const completed = response.backups
      .filter((backup) => backup.status === "COMPLETED")
      .sort((left, right) =>
        Date.parse(right.inserted_at) - Date.parse(left.inserted_at)
      );
    const latest = completed[0];
    if (!latest) throw new Error("No completed backup is available");
    const ageHours = (Date.now() - Date.parse(latest.inserted_at)) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 36) {
      throw new Error(`Latest completed backup is ${ageHours.toFixed(1)} hours old`);
    }
    process.stdout.write(JSON.stringify({
      inserted_at: latest.inserted_at,
      physical: latest.is_physical_backup,
      walg_enabled: response.walg_enabled,
      pitr_enabled: response.pitr_enabled,
      region: response.region,
      age_hours: Number(ageHours.toFixed(1)),
    }));
  '
)"
echo "Backup preflight: $backup_summary"

# The application connects through its dedicated runtime login. This rotates
# only the owner credential used for the controlled release session and keeps
# the generated value in this process rather than writing it to disk.
database_password="$(openssl rand -hex 32)"
password_response="$({
  curl --fail --silent --show-error \
    --request PATCH \
    --header "Authorization: Bearer $access_token" \
    --header "Content-Type: application/json" \
    --data "{\"password\":\"$database_password\"}" \
    "https://api.supabase.com/v1/projects/$project_ref/database/password"
} 2>&1)" || {
  printf '%s\n' "$password_response" >&2
  exit 1
}
if [[ "$password_response" != *"message"* ]]; then
  echo "Supabase did not confirm the owner-password rotation." >&2
  exit 1
fi

export DATABASE_PASSWORD="$database_password"
export SUPABASE_PROJECT_REF="$project_ref"
export SESSION_POOLER_HOST="$session_pooler_host"
SUPABASE_DB_URL="$(node --input-type=module -e '
  const url = new URL("postgresql://localhost:5432/postgres");
  url.username = `postgres.${process.env.SUPABASE_PROJECT_REF}`;
  url.password = process.env.DATABASE_PASSWORD;
  url.hostname = process.env.SESSION_POOLER_HOST;
  process.stdout.write(url.toString());
')"
export SUPABASE_DB_URL
export DATABASE_URL="$SUPABASE_DB_URL"

node scripts/validate-runtime-endpoint.mjs \
  SUPABASE_DB_URL SUPABASE_PROJECT_REF

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$SUPABASE_DB_URL" "$@"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "PostgreSQL client or Docker is required." >&2
    exit 1
  fi

  docker run --rm -i \
    --env SUPABASE_DB_URL="$SUPABASE_DB_URL" \
    --volume "$repository_root:/workspace:ro" \
    --workdir /workspace \
    postgres:17-alpine \
    sh -c 'exec psql "$SUPABASE_DB_URL" "$@"' psql "$@"
}

connected=false
for _attempt in $(seq 1 30); do
  if run_psql -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT current_user || '|' || current_database();" >/dev/null 2>&1; then
    connected=true
    break
  fi
  sleep 2
done
if [[ "$connected" != "true" ]]; then
  echo "Rotated owner credential did not become usable within 60 seconds." >&2
  exit 1
fi

mapfile -t migrations < <(
  find db/migrations -maxdepth 1 -type f -name '*.sql' -printf '%p\n' | sort
)
if [[ "${#migrations[@]}" != "76" \
  || "$(basename "${migrations[66]}")" != "0068_shared_rate_limit_windows.sql" \
  || "$(basename "${migrations[67]}")" != "0069_backend_contact_read_capability.sql" \
  || "$(basename "${migrations[68]}")" != "0070_services_fulltext_index.sql" \
  || "$(basename "${migrations[69]}")" != "0071_account_erasure_workflow.sql" \
  || "$(basename "${migrations[70]}")" != "0072_account_erasure_index_gate.sql" \
  || "$(basename "${migrations[73]}")" != "0075_data_api_acl_lockdown.sql" \
  || "$(basename "${migrations[74]}")" != "0076_account_erasure_highwater_planner_fix.sql" \
  || "$(basename "${migrations[75]}")" != "0077_candidate_revision_lineage.sql" ]]; then
  echo "Repository migration manifest does not match the reviewed 76-file release." >&2
  exit 1
fi

for file in "${migrations[@]}"; do
  filename="$(basename "$file")"
  if [[ ! "$filename" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]]; then
    echo "Invalid migration filename: $filename" >&2
    exit 1
  fi
done

existing_ledger="$(
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT pg_catalog.to_regclass('public.schema_migrations');"
)"
business_tables="$(
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT count(*)
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('schema_migrations', 'spatial_ref_sys');"
)"
if [[ "$business_tables" -lt "90" ]]; then
  echo "Production baseline is unexpectedly incomplete ($business_tables public tables)." >&2
  exit 1
fi

if [[ -z "$existing_ledger" ]]; then
  if [[ "${BASELINE_PRODUCTION_SCHEMA:-false}" != "true" ]]; then
    echo "Set BASELINE_PRODUCTION_SCHEMA=true after semantic baseline comparison." >&2
    exit 1
  fi
  {
    printf '%s\n' \
      '\set ON_ERROR_STOP on' \
      'BEGIN;' \
      "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('oran:repository-migration-ledger', 0));" \
      'CREATE TABLE public.schema_migrations (' \
      '  filename text PRIMARY KEY,' \
      '  applied_at timestamptz NOT NULL DEFAULT now()' \
      ');' \
      'ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;' \
      'REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM PUBLIC, anon, authenticated, service_role;'
    for file in "${migrations[@]:0:67}"; do
      printf "INSERT INTO public.schema_migrations (filename) VALUES ('%s');\n" \
        "$(basename "$file")"
    done
    printf '%s\n' 'COMMIT;'
  } | run_psql -X -v ON_ERROR_STOP=1
fi

declare -A applied_migrations=()
while IFS= read -r filename; do
  if [[ -n "$filename" ]]; then
    applied_migrations["$filename"]=1
  fi
done < <(
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    'SELECT filename FROM public.schema_migrations ORDER BY filename;'
)

for file in "${migrations[@]:0:67}"; do
  filename="$(basename "$file")"
  if [[ -z "${applied_migrations[$filename]:-}" ]]; then
    echo "Production ledger is missing baseline migration $filename." >&2
    exit 1
  fi
done

apply_tracked_migration() {
  local file="$1"
  local filename
  filename="$(basename "$file")"
  if [[ -n "${applied_migrations[$filename]:-}" ]]; then
    echo "Skipping already applied migration: $filename"
    return
  fi

  echo "Applying production migration: $filename"
  if [[ "$filename" == "0070_services_fulltext_index.sql" ]]; then
    search_index_state="$(
      run_psql -X -v ON_ERROR_STOP=1 -Atc \
        "SELECT coalesce(
           (SELECT (index_state.indisready AND index_state.indisvalid)::text
              FROM pg_catalog.pg_index index_state
              JOIN pg_catalog.pg_class index_class
                ON index_class.oid = index_state.indexrelid
             WHERE index_class.relname = 'idx_services_fts_name_description'),
           'missing'
         );"
    )"
    if [[ "$search_index_state" == "false" ]]; then
      run_psql -X -v ON_ERROR_STOP=1 \
        -c 'DROP INDEX CONCURRENTLY IF EXISTS public.idx_services_fts_name_description;'
    fi
  fi
  run_psql -X -v ON_ERROR_STOP=1 -f "$file"
  if [[ "$filename" == "0070_services_fulltext_index.sql" ]]; then
    search_index_state="$(
      run_psql -X -v ON_ERROR_STOP=1 -Atc \
        "SELECT coalesce(
           (SELECT (index_state.indisready AND index_state.indisvalid)::text
              FROM pg_catalog.pg_index index_state
              JOIN pg_catalog.pg_class index_class
                ON index_class.oid = index_state.indexrelid
             WHERE index_class.relname = 'idx_services_fts_name_description'),
           'false'
         );"
    )"
    if [[ "$search_index_state" != "true" ]]; then
      echo "Services full-text index is not ready and valid; refusing to record 0070." >&2
      exit 1
    fi
  fi
  run_psql -X -v ON_ERROR_STOP=1 --set=filename="$filename" <<'SQL'
INSERT INTO public.schema_migrations (filename) VALUES (:'filename');
SQL
  applied_migrations["$filename"]=1
}

apply_tracked_migration "${migrations[67]}"
apply_tracked_migration "${migrations[68]}"
apply_tracked_migration "${migrations[69]}"
if [[ -z "${applied_migrations[0072_account_erasure_index_gate.sql]:-}" ]]; then
  indexes_built=false
  for index_attempt in $(seq 1 5); do
    mapfile -t invalid_erasure_indexes < <(
      run_psql -X -v ON_ERROR_STOP=1 -Atc \
        "SELECT index_class.relname
           FROM pg_catalog.pg_index index_state
           JOIN pg_catalog.pg_class index_class
             ON index_class.oid = index_state.indexrelid
           JOIN pg_catalog.pg_namespace index_schema
             ON index_schema.oid = index_class.relnamespace
          WHERE index_schema.nspname = 'public'
            AND index_class.relname LIKE 'idx_ae_%'
            AND (NOT index_state.indisready OR NOT index_state.indisvalid)
          ORDER BY index_class.relname;"
    )
    for index_name in "${invalid_erasure_indexes[@]}"; do
      if [[ ! "$index_name" =~ ^idx_ae_[a-z0-9_]+$ ]]; then
        echo "Refusing to drop unexpected invalid index: $index_name" >&2
        exit 1
      fi
      echo "Dropping invalid erasure index before retry: $index_name"
      run_psql -X -v ON_ERROR_STOP=1 --set=index_name="$index_name" <<'SQL'
DROP INDEX CONCURRENTLY IF EXISTS public.:"index_name";
SQL
    done
    if run_psql -X -v ON_ERROR_STOP=1 \
      -f scripts/db/build-account-erasure-indexes.sql; then
      indexes_built=true
      break
    fi
    echo "Online index build attempt $index_attempt hit a transient conflict." >&2
    sleep 5
  done
  if [[ "$indexes_built" != "true" ]]; then
    echo "Account-erasure indexes did not converge after five attempts." >&2
    exit 1
  fi
fi
apply_tracked_migration "${migrations[70]}"
for file in "${migrations[@]:71}"; do
  apply_tracked_migration "$file"
done

release_state="$(
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT concat_ws('|',
      (SELECT count(*) FROM public.schema_migrations),
      (SELECT max(filename) FROM public.schema_migrations),
      (SELECT indexes_ready
         FROM oran_internal.account_erasure_release_gate
        WHERE singleton),
      (SELECT count(*) FROM pg_catalog.pg_index
        WHERE NOT indisvalid OR NOT indisready),
      coalesce((
        SELECT index_state.indisready AND index_state.indisvalid
          FROM pg_catalog.pg_index index_state
          JOIN pg_catalog.pg_class index_class
            ON index_class.oid = index_state.indexrelid
         WHERE index_class.relname = 'idx_services_fts_name_description'
      ), false),
      has_schema_privilege('anon', 'public', 'USAGE'),
      has_schema_privilege('authenticated', 'public', 'USAGE')
    );"
)"
if [[ "$release_state" != \
  "76|0077_candidate_revision_lineage.sql|t|0|t|f|f" ]]; then
  echo "Production release-state assertion failed: $release_state" >&2
  exit 1
fi

run_psql -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT json_build_object(
    'migration_count', (SELECT count(*) FROM public.schema_migrations),
    'final_migration', (SELECT max(filename) FROM public.schema_migrations),
    'erasure_indexes_ready', (
      SELECT indexes_ready
      FROM oran_internal.account_erasure_release_gate
      WHERE singleton
    ),
    'invalid_indexes', (
      SELECT count(*) FROM pg_catalog.pg_index
      WHERE NOT indisvalid OR NOT indisready
    ),
    'anon_public_usage', has_schema_privilege('anon', 'public', 'USAGE'),
    'authenticated_public_usage',
      has_schema_privilege('authenticated', 'public', 'USAGE')
  );"
