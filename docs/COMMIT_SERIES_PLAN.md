# Clean Commit Series Plan (grouped + reproducible)

Goal: commit everything currently in your working tree, but in a **small number of clean, reviewable commits** (DB/migrations → ingestion agent → APIs → UI → docs, etc.).

This plan assumes you’re on `main` and want to keep history readable.

---

## 0) Preflight: avoid accidental secrets

You’ve already used Key Vault for secrets (good). Before committing, do a quick scan to ensure nothing secret-like ended up in files:

```bash
# Search for common secret patterns (tweak as needed)
git grep -n "AZURE_MAPS_KEY" || true
git grep -n "azure-maps" || true
git grep -n "keyvault secret set" || true

# If you have a known key prefix, search for a short substring
# (don’t paste the full secret into your terminal history)
# git grep -n "<prefix>" || true
```

Also confirm `.env.example` contains **no real secrets** (it should only contain placeholders / docs).

---

## 1) Commit: dependencies / tooling

Rationale: reviewers like seeing dependency drift isolated.

```bash
git add package.json package-lock.json

git commit -m "chore(deps): update dependencies"
```

---

## 2) Commit: database layer (migrations + db tooling + seed)

Includes **new SQL migrations**, DB local dev compose, importer scripts, seed.

```bash
# New migrations + seed
git add db/migrations db/seed/demo.sql

# DB runtime/dev tooling
git add db/docker-compose.yml db/README.md db/import

git commit -m "db: add migrations and db tooling"
```

---

## 3) Commit: domain model primitives (types + constants + taxonomy/confidence)

Rationale: keeps “SSOT-ish” domain changes isolated.

```bash
git add src/domain

git commit -m "domain: expand types/constants and shared primitives"
```

---

## 4) Commit: ingestion agent + ingestion service + Drizzle ingestion schema

This is the core ingestion pipeline code + prompt/taxonomy helpers, plus the Drizzle schema used by the ingestion agent.

```bash
# Ingestion agent implementation + tests
git add src/agents/ingestion

# Drizzle schema + db wiring
git add src/db

# Ingestion helper service (prompting/tag extraction, etc.)
git add src/services/ingestion

git commit -m "ingestion: add ingestion agent pipeline and schema"
```

---

## 5) Commit: backend services (db client, auth/guards, security, telemetry, search, scoring, i18n, geocoding)

Rationale: this is the “server-side library layer” used by API routes.

```bash
# DB client / query helpers
git add src/services/db

# Auth service + type augmentations
git add src/services/auth src/lib/auth.ts src/types

# Security + telemetry (rate limits, PII redaction, IP helper)
git add src/services/security src/services/telemetry

# Admin/community service layers used by API routes
git add src/services/admin src/services/community

# Core backend capabilities
git add src/services/search src/services/scoring src/services/i18n src/services/geocoding

# Seeker personalization backends (if present)
git add src/services/profile src/services/saved

# Chat service internals (orchestrator, types, tests)
git add src/services/chat

git commit -m "services: add core backend services (auth/security/search/scoring/chat)"
```

---

## 6) Commit: API routes (Next.js App Router)

Rationale: routes are the public contract; keep them separate from service internals.

```bash
git add src/app/api

git commit -m "api: add/expand app router endpoints"
```

---

## 7) Commit: UI pages + components + styling + middleware route gating

Rationale: keep UI in one commit so it’s easy to review visually.

```bash
# Pages / layouts
git add src/app

# Shared UI components
git add src/components

# Middleware is runtime routing/security surface
git add src/middleware.ts

git commit -m "ui: add seeker/host/admin shells and components"
```

Note: this commit includes **both UI + middleware**, because they’re tightly coupled (route groups must match protection patterns).

---

## 8) Commit: docs + repo governance files

Rationale: docs changes are numerous; keep them separate so product/ops can review.

```bash
# Docs
git add docs available_resources.md

# Repo guidance
git add .github

# Env example is documentation-level config
git add .env.example

git commit -m "docs: update architecture, audit notes, and ops guidance"
```

---

## 9) Post-commit verification (recommended)

If you want “ready to merge” hygiene, run these after the final commit:

```bash
npm run lint
npx tsc --noEmit
npm test
```

If lint/typecheck are currently failing, consider fixing before pushing so main stays green.
