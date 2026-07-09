# ORAN Portfolio Convergence & Azure Exit

Status: **Azure exit essentially complete in code. App-layer adapters migrated;
Bicep infra + Azure deploy workflows + Azure Functions runtime removed; Supabase
schema live; Clerk auth code-complete; repo is Vercel-native (`vercel.json` +
cron). Remaining is provisioning/activation: Vercel deploy (auth), Clerk app,
`DATABASE_URL`, and the crawl-pipeline queue substitute — see §4 + §8 runbook.**

Last updated: 2026-07-08 · Branch: `feat/portfolio-convergence-azure-exit`

This document is the single source of truth for aligning ORAN with the Automated
Empires portfolio stack and removing its dependence on Azure / Microsoft-cloud
services. It records what has already been migrated, what remains, and the exact
plan and file surface for each remaining slice so any future maintainer (human or
agent) can continue without re-discovering the terrain.

---

## 1. Target stack (established from portfolio evidence)

The rest of the portfolio (Sweepza, Explore&Earn, BidSpace, LogLoads, Lake&Pine,
PinnedAtlas) has converged on one stack. ORAN is being aligned to it:

| Concern | ORAN today (legacy) | Portfolio target | Migration status |
| --- | --- | --- | --- |
| Runtime / framework | Next.js 16 + React 19 + TS | same | ✅ already aligned |
| Package manager | npm | pnpm | ⏳ deferred (low risk) |
| Database | Postgres via `pg` / Neon driver | **Supabase** (Postgres + PostGIS) | ✅ schema live (`tpatxospkuqvajusuryw`); DATABASE_URL gated |
| Auth | NextAuth v4 + Entra ID (Azure AD) | **Clerk** | ✅ code-complete; needs Clerk app to activate |
| Hosting | Azure App Service | **Vercel** | ⏳ Vercel-native (`vercel.json`); Bicep + Azure deploy workflows removed; deploy needs Vercel auth |
| Workers | Azure Functions (9) | **Vercel cron + route handlers** | ✅ timer jobs → `/api/cron/*` + `vercel.json` crons; ⏳ queue crawl-pipeline substitute |
| Secrets | Azure Key Vault | **Doppler** | ⏳ doc/ops |
| Email | Azure Communication Services | **Resend** | ✅ migrated |
| Error monitoring | Azure Application Insights | **Sentry** | ✅ migrated |
| Product analytics | (none) | **PostHog** | ⏳ instrument (optional) |
| Maps | Azure Maps (`azure-maps-control`, SAS broker) | **OpenStreetMap / Leaflet** (tokenless) | ✅ migrated |
| Geocoding | Azure Maps geocoder | **OSM Nominatim** (free) | ✅ migrated |
| LLM (seeker chat) | Azure OpenAI | **OpenAI** (`openai` SDK) | ✅ migrated (Azure fallback kept) |
| Cache / rate limit | Azure Cache for Redis | any Redis (e.g. Upstash) | ✅ provider-neutral already |
| Translation (i18n) | Azure AI Translator | provider-neutral / drop | ⏳ deferred |
| Text-to-speech | Azure Speech | provider-neutral / drop | ⏳ deferred |

Principle: **shared foundations where they create leverage** — not forcing ORAN's
legitimate domain needs (long-running ingestion, scheduled jobs, PostGIS,
pgvector, human review) into an identical shape.

---

## 2. Preserved intelligence (do NOT regress)

The Azure exit is infrastructure-only. ORAN's hard-earned domain logic is
preserved verbatim and protected by tests:

- **Deterministic three-score model** — `overall = 0.45·verification +
  0.40·eligibility + 0.15·constraint`, clamped 0–100. Weights in
  `src/domain/constants.ts`; implementation in `src/services/scoring/scorer.ts`.
  Seeker-facing **Trust** = verification-only; **Match** = renormalized
  `(0.40·elig + 0.15·constraint)/0.55`. Bands HIGH ≥80 / LIKELY ≥60 / POSSIBLE <60.
- **Trust-first deterministic ranking** — pure SQL/PostGIS `ORDER BY` in
  `src/services/search/engine.ts` (verification DESC → profile-match → score →
  distance). Distance never widens eligibility or bypasses trust.
- **Crisis hard-gate** — keyword match (`CRISIS_KEYWORDS`) runs first,
  unconditionally, before quota/rate-limit/retrieval/LLM, returning 911/988/211
  and never consuming quota (`src/services/chat/orchestrator.ts`). See §6 for a
  safety hardening landed in this pass.
- **Retrieval-first / no-fabrication** — chat retrieval is pure SQL; the optional
  post-retrieval summariser receives ONLY already-retrieved records, is
  prompt-constrained against inventing facts, and force-appends the eligibility
  disclaimer (`src/services/chat/llm.ts`).
- **Provenance + import→verify→publish lifecycle**, HSDS/211 federation
  (ADR-0007), pgvector embeddings, coverage zones — all untouched.

---

## 3. Migrated this pass (application-layer Azure adapters)

All changes are on `feat/portfolio-convergence-azure-exit`. Typecheck passes and
the affected + full unit suites are green (see §7).

### 3.1 Telemetry: Application Insights → Sentry
- **New:** `src/services/telemetry/events.ts` — provider-neutral
  `trackEvent/trackAiEvent/trackMetric/trackTrace/trackException/flush`, backed
  by the existing Sentry wrapper (`src/services/telemetry/sentry.ts`), fully
  fail-open, same public surface as before.
- **Removed:** `src/services/telemetry/appInsights.ts` (+ test); the
  `applicationinsights` dependency.
- **Rewired:** `src/instrumentation.ts` now initialises Sentry (optional,
  code-ready) instead of Azure Monitor; 7 consumers repointed; `platform-shell`
  test updated.
- Sentry stays an **optional, code-ready** integration (matches the portfolio
  "Sentry code-ready, DSN missing" pattern). Activate by installing
  `@sentry/nextjs` and setting `NEXT_PUBLIC_SENTRY_DSN`.

### 3.2 Email: Azure Communication Services → Resend
- **New:** `src/services/email/resend.ts` — dependency-free Resend REST adapter,
  identical `EmailMessage` / `sendEmail` / `isEmailConfigured` surface, fail-open.
- **Removed:** `src/services/email/azureEmail.ts` (+ test); `@azure/communication-email`.
- Consumers (`workflow/engine.ts`, `notifications/service.ts`) repointed. Env:
  `RESEND_API_KEY`, `RESEND_FROM`.

### 3.3 Maps: Azure Maps → OpenStreetMap / Leaflet (tokenless)
- **Rewrote** `src/components/map/MapContainer.tsx` to a tokenless react-leaflet
  map (OSM tiles), preserving the props contract, confidence-tier pins, popups,
  bounds emission, a11y and skip-to-results. No external CDN icon dependency.
- **Removed:** the Azure `atlas` code path, `src/components/map/LeafletFallback.tsx`
  (folded in), the `/api/maps/token` SAS broker route (+ test), the
  `rotate-azure-maps-sas.yml` workflow, and the `azure-maps-control` dependency.

### 3.4 Geocoding: Azure Maps → OSM Nominatim
- **New:** `src/services/geocoding/nominatim.ts` — free/tokenless geocoder, same
  `geocode/reverseGeocode/isConfigured/GeocodingResult` surface. Env (optional):
  `NOMINATIM_BASE_URL`, `GEOCODER_USER_AGENT` (self-host for volume).
- **Removed:** `src/services/geocoding/azureMaps.ts` (+ test). Consumers and the
  ingestion campaign script repointed.

### 3.5 LLM (seeker chat): Azure OpenAI → OpenAI
- `src/services/chat/llm.ts` now prefers standard OpenAI (`OPENAI_API_KEY`,
  `OPENAI_CHAT_MODEL`, optional `OPENAI_BASE_URL`) and falls back to Azure OpenAI
  only when that is the configured provider — so existing Azure deployments keep
  working during migration.

### 3.6 Contract / config reconciliation
- `src/services/runtime/envContractCore.js` — dropped the migrated Azure vars
  (App Insights, both Azure Maps); added portfolio-standard optional integrations
  (`NEXT_PUBLIC_SENTRY_DSN`, `RESEND_API_KEY`, `OPENAI_API_KEY`). Test updated.
- `.env.example` fully rewritten around the portfolio stack (Supabase, Resend,
  Sentry, PostHog, OpenAI, tokenless OSM) with legacy Azure vars clearly marked.
- `package.json` — removed `@azure/communication-email`, `applicationinsights`,
  `azure-maps-control`, and the unused `@azure/openai`. **No `@azure/*` runtime
  dependency remains.**

---

## 4. Remaining slices (with plans)

### 4.1 Auth: NextAuth + Entra ID → Clerk  ✅ *(code-complete; needs a Clerk application to activate)*
- **Done (code):** identity migrated to Clerk while **authorization stays
  DB-driven** (`user_profiles.role` + `organization_members`), so the entire
  server side moved through one seam:
  - `src/services/auth/session.ts` — `getAuthContext()` now reads the Clerk
    `auth()` user id, resolves role/account-status/org-memberships from Postgres,
    and creates a `seeker` profile on first sign-in (no webhook needed). All ~100
    API routes use this seam unchanged; `guards.ts` was already Clerk-agnostic.
  - `src/app/providers.tsx` → `ClerkProvider`; `src/proxy.ts` → `clerkMiddleware`
    (keeps CSRF; gates protected routes on sign-in — role enforcement stays in the
    DB-driven server layer since Edge can't read `user_profiles`).
  - Client seam: `src/services/auth/useOranSession.ts` — a NextAuth-shaped
    `useSession()`/`signIn`/`signOut` backed by Clerk + `/api/me`, so the ~13
    client components migrated by import only.
  - Clerk `<SignIn/>`/`<SignUp/>` at `/sign-in` and `/sign-up`; the branded
    `/auth/signin` chooser now routes into Clerk. Removed `next-auth`, the
    `[...nextauth]` route, `api/auth/register`, and the NextAuth config.
- **Remaining (founder gate — dashboard-only, no API):** create the Clerk
  application, set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`,
  configure OAuth providers in the Clerk dashboard, then run the live sign-in /
  role-resolution flow (which cannot be exercised here without the instance).
  Optional: a `/api/webhooks/clerk` consumer if you prefer webhook-time profile
  creation over the on-demand path.

### 4.2 Database: Neon/`pg` → Supabase  ✅ *(schema live; DATABASE_URL secret is the only founder gate)*
- **Done:** Supabase project **`oran`** created (`tpatxospkuqvajusuryw`, us-east-1,
  Postgres 17). All 53 migrations applied (100 tables; `postgis` + `vector` +
  `uuid-ossp`); seeds present (feature_flags, platform_scopes/roles,
  role_scope_assignments). Verified live via the Management API: PostGIS and
  pgvector operators work, and the deterministic three-score columns exist. The
  app DB layer now auto-configures TLS (`src/db/ssl.ts`), and the unused
  `@neondatabase/serverless` dependency was removed.
- **Remaining:** set `DATABASE_URL` to the pooler connection string — founder gate,
  since the DB password is only shown at creation / password-reset in the
  dashboard; wire `db-migrate.yml` to Supabase CI (`SUPABASE_ACCESS_TOKEN` +
  `SUPABASE_PROJECT_ID` secrets, as Explore&Earn does); decide the RLS posture.
- **RLS posture:** the schema was applied with RLS disabled on all tables. ORAN
  connects via **direct `pg`** (not the Supabase client / anon key), so RLS is not
  in the app's data path — but the project's auto-generated PostgREST Data API
  would otherwise expose these tables to the `anon`/`authenticated` roles.
  Recommended (matches BidSpace's D025): disable the Data API, or `REVOKE` table
  privileges from `anon`/`authenticated`, or enable deny-all RLS (the app's owner
  role bypasses it). Not auto-applied — surfaced from the Supabase security advisor.

### 4.3 Hosting + workers: App Service + Azure Functions → Vercel  ✅ *(Vercel-native; deploy is founder-gated)*
- **Done:** removed `infra/*.bicep` + `main.json` + `monitoring.bicep`, the
  `deploy-azure-appservice.yml` / `deploy-azure-functions.yml` / `deploy-infra.yml`
  workflows, the entire `functions/` Azure Functions runtime (host.json + all
  wrappers), and the `build:functions` script. Added `vercel.json` (framework +
  cron). The 5 timer functions became **Vercel cron routes** (`/api/cron/*`,
  `CRON_SECRET`-gated via `src/lib/cron.ts`) that invoke the existing internal job
  endpoints:

  | Former Azure timer function | Vercel cron route | Schedule | Internal endpoint |
  | --- | --- | --- | --- |
  | `checkSlaBreaches` | `/api/cron/sla-check` | `0 * * * *` | `/api/internal/sla-check` |
  | `pollSourceFeeds` | `/api/cron/feed-poll` | `0 * * * *` | `/api/internal/ingestion/feed-poll` |
  | `alertCoverageGaps` | `/api/cron/coverage-gaps` | `0 8 * * *` | `/api/internal/coverage-gaps` |
  | `scanConfidenceRegressions` | `/api/cron/confidence-regression-scan` | `0 */6 * * *` | `/api/internal/confidence-regression-scan` |

  (Hourly crons require Vercel Pro; adjust for Hobby.) Verified: `next build` compiles the cron routes.
- **Remaining — crawl-pipeline queue substitute (ingestion follow-up, NOT launch-critical):**
  `scheduledCrawl` + the queue chain `fetchPage → extractService → verifyCandidate
  → routeToAdmin` + `manualSubmit` moved data through Azure Storage Queues. Their
  logic lives in `src/agents/ingestion/*` (the deleted functions were thin
  wrappers). Rebuild the invocation on a queue substitute — Upstash QStash, or a
  DB-backed work table drained by a `/api/cron/ingestion-drain` cron — and expose
  `manualSubmit` as an internal route. The **seeker product does not depend on
  this** (it reads *published* records), so it can follow the launch.
- **Deploy (founder gate):** the repo is Vercel-native; going live needs Vercel
  auth (no CLI token or dashboard access is available from the automation
  environment). See §8.

### 4.4 Remaining Azure AI adapters *(optional, fail-open today)*
- **Ingestion LLM provider** — `src/agents/ingestion/llm/providers/azureOpenai.ts`
  already uses the standard `openai` SDK's `AzureOpenAI` class (the deprecated
  `@azure/openai` package was unused and has been removed). Remaining work: add an
  `openai.ts` provider to the self-registration factory and default to standard
  OpenAI, mirroring the seeker-chat summariser.
- **Translator** — `src/services/i18n/translator.ts` (Azure AI Translator). Swap
  to a provider-neutral shape (self-hosted LibreTranslate or drop). Currently
  fails open to pass-through when unset.
- **Text-to-speech** — `src/services/tts/azureSpeech.ts` (Azure Speech). Swap or
  drop; fails open to `null` when unset.
- Env still referencing these (`AZURE_TRANSLATOR_*`, `AZURE_SPEECH_*`) is retained
  in `.env.example` under "legacy" until swapped.

### 4.5 Control-plane self-model
- `src/services/agentic/controlPlane.ts` still describes `app_insights` and
  `azure_maps` integrations and "App Service / Functions" operators. Update this
  descriptive catalog to Sentry / tokenless-map / Vercel once §4.1–4.3 land. (No
  runtime behaviour depends on it; the stale evidence path to the deleted
  `appInsights.ts` was already corrected to `events.ts`.)

### 4.6 Docs + package manager
- Retire/redirect `docs/platform/PLATFORM_AZURE.md`,
  `docs/platform/DEPLOYMENT_AZURE.md`, `docs/platform/AZURE_DASHBOARD_MODERNIZATION.md`,
  `infra/README.md`, and the Azure-first badges in `README.md`.
- Adopt pnpm (workspace-consistent) once the above stabilises.

---

## 5. Sequencing recommendation

1. **DB (Supabase)** and **Auth (Clerk)** are the two provisioning gates — do them
   first because deploy depends on them.
2. **Vercel deploy + Functions→cron** once DB/Auth are live.
3. **Ingestion AI provider / Translator / Speech** cleanup (pure code).
4. **Infra/Bicep + Azure workflow removal + docs** last, when nothing references them.

Each step should land as a green vertical slice; never leave dual cloud paths.

---

## 6. Safety hardening landed with this pass

The crisis classifier had a first-person bypass: a keyworded self-disclosure that
also matched a broad third-party/informational pattern (e.g. *"what should I do if
I want to die"*, *"how do I help myself, I can't go on"*) was demoted to
`third_party`/`informational`, skipping the crisis hard-stop and consuming quota.

Fix (`src/services/chat/orchestrator.ts`): a **first-person override** evaluated
before any downgrade — a first-person disclosure always classifies as `self`
crisis. The change can only ever *promote* a keyworded message to crisis, never
demote a genuine disclosure. Regression tests added in
`src/services/chat/__tests__/crisis-completeness.test.ts` cover the disguised
cases and confirm genuine third-party messages still classify correctly.

---

## 7. Verification (this pass)

- `npx tsc --noEmit` — **pass**.
- Affected + crisis unit suites — **145/145 pass** (telemetry, email, geocoding,
  map, llm, envContract, control-plane, workflow, adversarial-audit, crisis).
- Full unit suite baseline before changes: 3840 pass / 3 pre-existing
  **wall-clock-dependent** failures unrelated to this work
  (`lib/format` date-only in PDT, `plans/feasibility` "closes soon",
  `forms/instances/[id]` — an SLA deadline of 2026-06-01 is now in the past).
  This pass does not touch those and does not add regressions.
- After the Supabase + Clerk + Vercel-native passes: `tsc` pass, `eslint` 0 errors,
  `next build` pass (Clerk + cron routes compiled), unit suite green apart from the
  same 3 pre-existing wall-clock failures. **No `@azure/*` runtime dependency, no
  Bicep, no Azure deploy workflows, no Azure Functions runtime remain.**

---

## 8. Launch runbook (founder-gated activation)

The software is Azure-free and Vercel-native. Going live is provisioning, in this
order. Items marked "automation-blocked" could not be done from the repo-resident
automation environment (no Vercel auth token; Clerk has no creation API).

1. **Supabase `DATABASE_URL`** (automation-blocked — DB password is dashboard-only):
   Supabase → project `oran` (`tpatxospkuqvajusuryw`) → Settings → Database →
   Connection string → Transaction pooler. Copy it (with the password) — this is
   `DATABASE_URL`. Schema + extensions + seeds are already applied; RLS/Data-API is
   already locked down (anon/authenticated revoked, deny-all RLS; the app's
   `postgres` owner connection bypasses it).
2. **Clerk application** (automation-blocked — dashboard-only, no API): create the
   ORAN Clerk app, enable the OAuth providers you want, and copy
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`.
3. **Vercel project** (automation-blocked — needs Vercel auth): import
   `AutomatedEmpires/Open-Resource-Access-Network` into the AutomatedEmpires Vercel
   team (git integration). Framework auto-detects Next.js; `vercel.json` supplies
   the cron schedules.
4. **Vercel env vars** (Production): `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `INTERNAL_API_KEY` (generate: `openssl rand -base64 32`),
   `CRON_SECRET` (generate). Optional: `NEXT_PUBLIC_SENTRY_DSN` (+ install
   `@sentry/nextjs`), `NEXT_PUBLIC_POSTHOG_KEY`, `RESEND_API_KEY` + `RESEND_FROM`,
   `OPENAI_API_KEY`. Legacy/optional: `AZURE_TRANSLATOR_*`, `AZURE_SPEECH_*`.
5. **Deploy** and verify: `/api/health` (200 when `DATABASE_URL` is set), the public
   seeker surfaces (`/`, `/directory`, `/map`, `/chat`), and a signed-in role flow
   once Clerk is live. `run validate:runtime` checks the env contract.
6. **Data**: the seeker product needs published resources to be useful. Load real
   verified records via the ingestion pipeline (needs the crawl-queue substitute in
   §4.3 and any source keys, e.g. the 211 subscription key) or a curated import. The
   product is intentionally honest about empty state until then.

Public-product note: the seeker browse/search/map surfaces are public and work with
only `DATABASE_URL` + data. Clerk gates the host/community-admin/oran-admin portals
and saved-items — those stay dormant (fail-closed) until step 2, matching the
portfolio pattern (e.g. PinnedAtlas "free product live; accounts founder-gated").
