#!/usr/bin/env bash

set -euo pipefail

usage="usage: rehearse-supabase-branch.sh <branch-name> <production-project-ref> <branch-project-ref> [session-pooler-host]"
branch_name="${1:?$usage}"
production_project_ref="${2:?$usage}"
branch_project_ref="${3:?$usage}"
session_pooler_host="${4:-aws-0-us-east-1.pooler.supabase.com}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$repository_root"

supabase_bin="$(command -v supabase)"
if [[ -z "$supabase_bin" ]]; then
  echo "Supabase CLI is required." >&2
  exit 1
fi

# The CLI emits shell assignments. Evaluate them without printing the branch
# password or connection strings to the terminal or CI log.
eval "$(NO_COLOR=1 "$supabase_bin" branches get "$branch_name" \
  --project-ref "$production_project_ref" -o env \
  | grep -E '^[A-Z][A-Z0-9_]*=')"

: "${POSTGRES_URL_NON_POOLING:?Supabase branch did not return a direct database URL}"
export BRANCH_PROJECT_REF="$branch_project_ref"
export SESSION_POOLER_HOST="$session_pooler_host"
export POSTGRES_URL_NON_POOLING
DATABASE_URL="$(node --input-type=module -e '
  const direct = new URL(process.env.POSTGRES_URL_NON_POOLING);
  const host = process.env.SESSION_POOLER_HOST;
  const ref = process.env.BRANCH_PROJECT_REF;
  if (!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/u.test(host)) {
    throw new Error("Invalid Supabase session pooler host");
  }
  direct.username = `postgres.${ref}`;
  direct.hostname = host;
  direct.port = "5432";
  process.stdout.write(direct.toString());
')"
export DATABASE_URL
node scripts/validate-runtime-endpoint.mjs \
  DATABASE_URL BRANCH_PROJECT_REF

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" "$@"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "PostgreSQL client or Docker is required." >&2
    exit 1
  fi

  docker run --rm -i \
    --env DATABASE_URL="$DATABASE_URL" \
    --volume "$repository_root:/workspace:ro" \
    --workdir /workspace \
    postgres:17-alpine \
    sh -c 'exec psql "$DATABASE_URL" "$@"' psql "$@"
}

existing_ledger="$(
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT pg_catalog.to_regclass('public.schema_migrations');"
)"
existing_business_tables="$(
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT count(*)
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('schema_migrations', 'spatial_ref_sys');"
)"
if [[ "$existing_business_tables" != "0" \
  && "$existing_ledger" != "schema_migrations" ]]; then
  echo "Refusing greenfield rehearsal: the branch already has public application tables." >&2
  exit 1
fi

run_psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

declare -A applied_migrations=()
while IFS= read -r filename; do
  if [[ -n "$filename" ]]; then
    applied_migrations["$filename"]=1
  fi
done < <(
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    'SELECT filename FROM public.schema_migrations ORDER BY filename;'
)

reapply_provider_data_api_lockdown() {
  run_psql -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
DO $enable_rls$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'spatial_ref_sys'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      target.tablename
    );
  END LOOP;
END
$enable_rls$;
COMMIT;
SQL
}

apply_tracked_migration() {
  local file="$1"
  local filename

  filename="$(basename "$file")"
  if [[ -n "${applied_migrations[$filename]:-}" ]]; then
    echo "Skipping already applied migration: $filename"
    return
  fi

  echo "Applying migration: $filename"
  run_psql -X -v ON_ERROR_STOP=1 -f "$file"
  run_psql -X -v ON_ERROR_STOP=1 \
    --set=filename="$filename" <<'SQL'
INSERT INTO public.schema_migrations (filename) VALUES (:'filename');
SQL
  applied_migrations["$filename"]=1
}

mapfile -t migrations < <(
  find db/migrations -maxdepth 1 -type f -name '*.sql' -printf '%p\n' | sort
)
if [[ -n "${MIGRATION_FINAL:-}" ]]; then
  limited_migrations=()
  found_final=false
  for file in "${migrations[@]}"; do
    limited_migrations+=("$file")
    if [[ "$(basename "$file")" == "$MIGRATION_FINAL" ]]; then
      found_final=true
      break
    fi
  done
  if [[ "$found_final" != true ]]; then
    echo "Requested final migration was not found: $MIGRATION_FINAL" >&2
    exit 1
  fi
  migrations=("${limited_migrations[@]}")
fi
if [[ "${#migrations[@]}" -lt "71" ]]; then
  pending_migrations=()
  for file in "${migrations[@]}"; do
    filename="$(basename "$file")"
    if [[ -z "${applied_migrations[$filename]:-}" ]]; then
      pending_migrations+=("$file")
    fi
  done
  if [[ "${#pending_migrations[@]}" -gt "0" ]]; then
    {
      printf '\\set ON_ERROR_STOP on\n'
      for file in "${pending_migrations[@]}"; do
        filename="$(basename "$file")"
        if [[ ! "$filename" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]]; then
          echo "Invalid migration filename: $filename" >&2
          exit 1
        fi
        printf '\\echo Applying migration: %s\n' "$filename"
        printf '\\ir %s\n' "$file"
        printf "INSERT INTO public.schema_migrations (filename) VALUES ('%s');\n" \
          "$filename"
      done
    } | run_psql -X -v ON_ERROR_STOP=1
  fi
  if [[ "${REAPPLY_DATA_API_LOCKDOWN:-false}" == "true" ]]; then
    reapply_provider_data_api_lockdown
  fi
  run_psql -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT count(*) || '|' || max(filename) FROM public.schema_migrations;"
  exit 0
fi

if [[ "$(basename "${migrations[68]}")" != "0070_services_fulltext_index.sql" \
  || "$(basename "${migrations[69]}")" != "0071_account_erasure_workflow.sql" \
  || "$(basename "${migrations[70]}")" != "0072_account_erasure_index_gate.sql" ]]; then
  echo "The required 0000-0072 migration sequence is incomplete or reordered." >&2
  exit 1
fi

for file in "${migrations[@]:0:68}"; do
  apply_tracked_migration "$file"
done

# 0070 is deliberately executed by psql without an enclosing transaction
# because it creates the service search index concurrently.
apply_tracked_migration "${migrations[68]}"

# 0071 installs the dark erasure workflow. The release gate in 0072 must not be
# recorded until every online index is present and valid.
apply_tracked_migration "${migrations[69]}"
if [[ -z "${applied_migrations[0072_account_erasure_index_gate.sql]:-}" ]]; then
  run_psql -X -v ON_ERROR_STOP=1 \
    -f scripts/db/build-account-erasure-indexes.sql
fi
apply_tracked_migration "${migrations[70]}"

# Later migrations are ordinary tracked SQL and run only after the account
# erasure gate is valid and recorded.
for file in "${migrations[@]:71}"; do
  apply_tracked_migration "$file"
done

run_psql -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT count(*) || '|' || max(filename) FROM public.schema_migrations;"
