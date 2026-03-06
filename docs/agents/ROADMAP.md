# Ingestion Agent — Status & Roadmap

> **Last updated**: 2026-03-08
>
> All Phases 1–7 are **complete and production-ready**. The pipeline is live in
> the codebase with full infrastructure-as-code, CI/CD, monitoring, runbooks,
> and scale-testing artifacts.

---

## What the Ingestion Agent Does

The ingestion agent is a fully-automated extraction–verification–routing pipeline:

1. **Fetch** — Fetches HTML from allowlisted sources (211.org, .gov, .org) via
   Azure Functions respecting `robots.txt` and rate limits.
2. **Extract** — GPT-4o extracts structured service data from raw HTML using a
   safety-constrained prompt. Output is Zod-validated JSON.
3. **Categorize** — A follow-on LLM call generates category tags with
   per-tag confidence scores.
4. **Verify** — 8-item automated checklist (domain allowlist, phone format,
   email format, URL reachability, geocoding, service area plausibility,
   required-field completeness, description length).
5. **Score** — Confidence score 0–100 with 4-tier color coding
   (red / amber / blue / green). Aggregates field-level extraction confidence +
   verification pass rate.
6. **Route** — Assigns the verified candidate to the ~5 nearest community admins
   by coverage zone (PostGIS `ST_Distance`). Admin capacity awareness prevents
   overload.
7. **Human approval** — Candidates stay in staging until a community-admin or
   oran-admin publishes them. Nothing reaches seeker-facing search without
   explicit approval.

---

## Phase 1: LLM Extraction Core ✅ Complete

- `src/agents/ingestion/llm/client.ts` — `LLMClient` interface + factory
- `src/agents/ingestion/llm/azureOpenAI.ts` — GPT-4o via Azure OpenAI
- `src/agents/ingestion/llm/prompts/extraction.ts` — Extraction prompt
- `src/agents/ingestion/llm/prompts/categorization.ts` — Tagging prompt
- `src/agents/ingestion/llm/parser.ts` — Zod-validated response parsing
- Confidence score mapping (LLM certainty → 0–100 scale)
- Field-level provenance tracking

---

## Phase 2: HTML Processing Pipeline ✅ Complete

- `src/agents/ingestion/html/sanitizer.ts` — Strip scripts/ads/nav, preserve
  semantic structure (headings, lists, tables)
- `src/agents/ingestion/html/chunker.ts` — 4K-token chunks with overlap
- `src/agents/ingestion/html/pdfExtractor.ts` — PDF text extraction
- Encoding / character-set handling

---

## Phase 3: Source Registry & Fetching ✅ Complete

- Source registry table in DB with domain patterns, quality tiers, crawl policy
- Respectful crawling: `robots.txt` compliance, rate limiting, redirect tracking
- Evidence snapshots (SHA-256 hash + timestamp stored per fetch)
- Link discovery: breadth-first, depth-limited, allowlist-filtered
- `db/seed/sources.sql` — Initial source seeds (211 network, .gov portals)

---

## Phase 4: Azure Functions Runtime ✅ Complete

| Function | Trigger | Status |
|---|---|---|
| `scheduledCrawl` | Timer (daily) | ✅ |
| `fetchPage` | Queue | ✅ |
| `extractService` | Queue | ✅ |
| `verifyCandidate` | Queue | ✅ |
| `routeToAdmin` | Queue | ✅ |
| `manualSubmit` | HTTP | ✅ |
| `checkSlaBreaches` | Timer | ✅ |

Queue architecture: `ingestion-fetch` → `ingestion-extract` → `ingestion-verify`
→ `ingestion-route` (Azure Storage Queues).

---

## Phase 5: Verification Pipeline ✅ Complete

9-stage stateless orchestrator:
`SourceCheck → FetchPage → ExtractHtml → LlmExtract → LlmCategorize →
Verify → Score → BuildCandidate → RouteToAdmin`

8 automated verification checks:
- Domain allowlist match
- Phone format (US)
- Email format
- URL reachability
- Geocoding validation
- Service area plausibility
- Required-field completeness
- Description minimum length

16 Drizzle ORM store implementations covering all pipeline state transitions.
19 test files with unit coverage across all pipeline stages.

---

## Phase 6: Admin UI ✅ Complete

- `/oran-admin/ingestion` — Ingestion job monitor (status, errors, retries)
- `/oran-admin/scopes` — Platform scope management
- `/oran-admin/approvals` — Candidate approval workflow (publish / reject)
- `/oran-admin/audit` — Full system audit trail
- `/oran-admin/rules` — Scoring weights + feature flags
- `/oran-admin/zone-management` — Coverage zone and admin assignments
- `/community-admin/queue` — Verification queue (wired to `candidate_assignments`)
- `/community-admin/verify` — Guided field-by-field review with tag confirmation UI

8+ admin API endpoints under `src/app/api/admin/**` and
`src/app/api/community/**`.

---

## Phase 7: Deployment & Ops ✅ Complete

### 7.1 Infrastructure Provisioning ✅
- Bicep IaC templates (`infra/main.bicep`): App Service, Function App (Consumption), Storage + queues, Key Vault (RBAC), PostgreSQL Flexible Server + PostGIS, Application Insights + Log Analytics, Azure Communication Services, Azure Cache for Redis
- Production parameters (`infra/main.prod.bicepparam`)
- Environment variables documented in `.env.example`

### 7.2 CI/CD Pipeline ✅
- GitHub Actions workflows: Functions deploy (`deploy-azure-functions.yml`), DB migration (`db-migrate.yml`), infrastructure deploy (`deploy-infra.yml`)
- Existing App Service deploy workflow (`deploy-azure-appservice.yml`)
- OIDC-based authentication to Azure (no stored secrets)

### 7.3 Monitoring & Alerting ✅
- Azure Monitor alert rules (`infra/monitoring.bicep`): web 5xx, web latency, function failures, SLA breaches, queue backlog, coverage gaps
- KQL query reference (`docs/ops/MONITORING_QUERIES.md`): 14+ queries across 6 sections
- Wired to `checkSlaBreaches` and `alertCoverageGaps` functions

### 7.4 Runbooks ✅
- `docs/ops/RUNBOOK_INGESTION.md` — Pipeline troubleshooting
- `docs/ops/RUNBOOK_ADMIN_ROUTING.md` — Routing failures + emergency procedures
- `docs/ops/RUNBOOK_LLM_OUTAGE.md` — Azure OpenAI outage handling

### 7.5 Load & Scale Testing ✅
- Queue concurrency tuned in `functions/host.json` (batchSize=4, maxDequeueCount=3)
- DB connection pool sized in `src/db/index.ts` (max=10)
- Load test script: `scripts/load-test.mjs`
- Scale triggers and upgrade paths documented in `docs/ops/LOAD_SCALE_TESTING.md`

---

## Phase 8: Internationalisation (i18n) ✅ Complete

### 8.1 File-based Locale Bundles ✅
- `src/locales/en.json` — canonical English strings (extracted from previous in-code dict)
- `src/locales/{es,zh,ar,vi,fr}.json` — English-fallback placeholders; ready for translator hand-off
- `src/services/i18n/i18n.ts` — loads from static JSON imports (bundled at build time, zero runtime I/O)
- `localeCache` pre-populated with all 6 supported locales on module load

### 8.2 Server-side Locale Detection ✅
- `src/lib/locale.ts` — `resolveLocale()` async Server Component helper
- Resolution order: `NEXT_LOCALE` cookie → `Accept-Language` header → `DEFAULT_LOCALE` ('en')
- Profile locale preference stored via `NEXT_LOCALE` cookie on save

### 8.3 RTL-ready `<html>` Attributes ✅
- `src/app/layout.tsx` — now async; calls `resolveLocale()` and sets `<html lang={locale} dir={dir}>`
- Arabic (`ar`) gets `dir="rtl"` enabling Tailwind's `rtl:` variant prefix
- `isRTL(locale)` helper available from `@/services/i18n/i18n`

### Still Pending
- Actual human translations for es / zh / ar / vi / fr (translator hand-off)
- Missing-key telemetry integration (no PII)

---

## Key Design Decisions (Stable)

| Decision | Choice | Rationale |
|---|---|---|
| LLM role | Extraction + categorization only | Never ranks or retrieves — retrieval-first contract |
| Auto-publish | Never | All candidates require human approval |
| Source gating | Allowlist only | No user-submitted URLs without oran_admin approval |
| Confidence model | 0–100 aggregate + field-level | Transparent to reviewers |
| Admin routing | PostGIS zone proximity + capacity | Fair load distribution |
| Queue tech | Azure Storage Queues | Simple, cost-effective, sufficient for current volume |
