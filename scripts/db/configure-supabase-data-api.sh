#!/usr/bin/env bash

set -euo pipefail

usage="usage: configure-supabase-data-api.sh <project-ref> <exposed-schemas> [extra-search-path]"
project_ref="${1:?$usage}"
exposed_schemas="${2:?$usage}"
extra_search_path="${3:-extensions}"

if [[ ! "$project_ref" =~ ^[a-z]{20}$ ]]; then
  echo "Invalid Supabase project ref." >&2
  exit 1
fi
if [[ ! "$exposed_schemas" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ ]]; then
  echo "Invalid exposed-schema list." >&2
  exit 1
fi
if [[ ! "$extra_search_path" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ ]]; then
  echo "Invalid extra-search-path list." >&2
  exit 1
fi

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

response="$({
  curl --fail --silent --show-error \
    --request PATCH \
    --header "Authorization: Bearer $access_token" \
    --header "Content-Type: application/json" \
    --data "{\"db_schema\":\"$exposed_schemas\",\"db_extra_search_path\":\"$extra_search_path\"}" \
    "https://api.supabase.com/v1/projects/$project_ref/postgrest"
} 2>&1)" || {
  printf '%s\n' "$response" >&2
  exit 1
}

printf '%s\n' "$response"

if [[ "${VERIFY_DATA_API_ISOLATION:-false}" == "true" ]]; then
  keys_response="$({
    curl --fail --silent --show-error \
      --header "Authorization: Bearer $access_token" \
      "https://api.supabase.com/v1/projects/$project_ref/api-keys?reveal=true"
  } 2>&1)" || {
    printf '%s\n' "$keys_response" >&2
    exit 1
  }
  publishable_key="$(
    printf '%s' "$keys_response" | node --input-type=module -e '
      let body = "";
      for await (const chunk of process.stdin) body += chunk;
      const keys = JSON.parse(body);
      const key = keys.find((candidate) =>
        candidate.type === "publishable" && candidate.disabled !== true
      ) ?? keys.find((candidate) =>
        candidate.name === "anon" && candidate.disabled !== true
      );
      if (!key?.api_key) process.exit(1);
      process.stdout.write(key.api_key);
    '
  )"
  if [[ -z "$publishable_key" ]]; then
    echo "No enabled publishable or legacy anon key is available." >&2
    exit 1
  fi

  for relation in services spatial_ref_sys; do
    status="$(
      curl --silent --show-error \
        --output /dev/null \
        --write-out '%{http_code}' \
        --header "apikey: $publishable_key" \
        "https://$project_ref.supabase.co/rest/v1/$relation?select=*&limit=1"
    )"
    if [[ "$status" != "404" && "$status" != "406" ]]; then
      echo "Data API unexpectedly exposed $relation (HTTP $status)." >&2
      exit 1
    fi
  done
  echo "Data API isolation verified for public services and spatial_ref_sys."
fi
