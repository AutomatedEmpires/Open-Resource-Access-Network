#!/usr/bin/env bash

set -euo pipefail

usage="usage: with-supabase-branch.sh <branch-name> <production-project-ref> <branch-project-ref> -- <command> [args...]"
branch_name="${1:?$usage}"
production_project_ref="${2:?$usage}"
branch_project_ref="${3:?$usage}"
shift 3
if [[ "${1:-}" != "--" ]]; then
  echo "$usage" >&2
  exit 1
fi
shift
if [[ "$#" -eq 0 ]]; then
  echo "$usage" >&2
  exit 1
fi

supabase_bin="$(command -v supabase)"
if [[ -z "$supabase_bin" ]]; then
  echo "Supabase CLI is required." >&2
  exit 1
fi

eval "$(NO_COLOR=1 "$supabase_bin" branches get "$branch_name" \
  --project-ref "$production_project_ref" -o env \
  | grep -E '^[A-Z][A-Z0-9_]*=')"
: "${POSTGRES_URL_NON_POOLING:?Supabase branch did not return a direct database URL}"

export POSTGRES_URL_NON_POOLING
export BRANCH_PROJECT_REF="$branch_project_ref"
SUPABASE_DB_URL="$(node --input-type=module -e '
  const direct = new URL(process.env.POSTGRES_URL_NON_POOLING);
  const ref = process.env.BRANCH_PROJECT_REF;
  direct.username = `postgres.${ref}`;
  direct.hostname = "aws-0-us-east-1.pooler.supabase.com";
  direct.port = "5432";
  process.stdout.write(direct.toString());
')"
export SUPABASE_DB_URL
export DATABASE_URL="$SUPABASE_DB_URL"
export SUPABASE_PROJECT_REF="$branch_project_ref"

node scripts/validate-runtime-endpoint.mjs \
  SUPABASE_DB_URL SUPABASE_PROJECT_REF

exec "$@"
