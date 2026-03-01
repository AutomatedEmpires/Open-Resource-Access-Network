#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

# Keep apt noise low, but still fail fast if something goes wrong.
if ! command -v psql >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y --no-install-recommends postgresql-client
fi

if ! command -v jq >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y --no-install-recommends jq
fi

# Ensure Azure Bicep support is available when needed.
if command -v az >/dev/null 2>&1; then
  if ! az bicep version >/dev/null 2>&1; then
    az bicep install >/dev/null
  fi
fi

# Install Node dependencies (use lockfile for reproducibility).
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
