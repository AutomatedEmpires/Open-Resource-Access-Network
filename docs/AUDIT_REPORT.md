# ORAN Repository Forensic Audit (as of 2026-02-28)

Update note:
- `next.config.ts` now configures baseline security headers (e.g., `X-Frame-Options`, `Permissions-Policy`). Treat this audit as point-in-time; if you change enforcement, update the audit summary sections accordingly.

Scope: This report audits the repository *as it exists right now* in the `codespace` branch. It is an alignment and compliance audit only; no product features were implemented as part of this work.

Method: Repo-truth mapping across:
- Contracts in `/docs` and top-level governance files
- Implemented behavior in `/src/app/api`, `/src/services`, `/src/components`, and `/src/middleware.ts`
- Database reality in `/db/migrations/0000_initial_schema.sql` and importer scaffolding in `/db/import`
- Tests in `/src/services/**/__tests__` and CI workflows in `/.github/workflows`

---

## 1) Executive Summary (1 page max)

### What ORAN currently is (as implemented)
- A **Next.js App Router + TypeScript** scaffold with a working **chat UI** (`/chat`) that calls a **retrieval-first chat orchestrator**.
- A **deterministic chat pipeline** implemented in `src/services/chat/orchestrator.ts` with:
  - keyword-based **crisis detection** → 911/988/211
  - per-session **quota** (in-memory)
  - per-IP/user **rate limiting** (in-memory; enforced at the chat API layer)
  - keyword-based **intent detection**
  - strict **eligibility disclaimers** via shared constants
  - an optional **LLM summarization hook** gated behind a feature flag (no actual LLM integration present)
- A **PostgreSQL/PostGIS schema** created by `db/migrations/0000_initial_schema.sql` that covers core HSDS-ish tables plus ORAN extensions (confidence scoring, verification queue, feedback, flags).
- A **search query builder + search engine abstraction** (`src/services/search/engine.ts`) that generates parameterized SQL for radius/bbox/text queries, but is currently wired to a **mock executor** in `src/app/api/search/route.ts`.
- A **confidence scoring implementation** (`src/services/scoring/scorer.ts`) that matches the documented 3-score + weights contract and has unit tests.

### What it is NOT yet (explicitly)
- Not a functioning directory/map/search product yet:
  - `/directory` is a placeholder page.
  - `MapContainer` is a placeholder; no map library integration.
  - `/api/search` uses a **mock engine** returning `[]`.
- Not a functioning retrieval-backed chat recommender yet:
  - `/api/chat` uses a **mock retrieval function** that returns `[]`.
- Not an authenticated / role-enforced application yet:
  - `src/middleware.ts` checks “authenticated vs anonymous” when Clerk is configured; it does **not** enforce role hierarchy.
  - In production, protected routes fail closed (503) if auth is misconfigured or temporarily unavailable.
  - App layout does not currently wire Clerk providers.
- Not an implemented import pipeline:
  - `db/import/hsds-csv-importer.ts` validates some CSVs but does not stage, diff, or publish data to the DB.
- Not implementing privacy/consent flows in UI/API:
  - `/profile` and `/saved` are placeholders; there are no persistence APIs for user profiles or consent.
- Not implementing audit logging, RLS, or production security headers as described in docs.

### Biggest strengths (top 5)
1. **Safety-first intent in contracts**: strong non-negotiables clearly stated in `docs/VISION.md` and reinforced in templates.
2. **Deterministic scoring module** aligned with the 0–100 x3 model + 0.45/0.40/0.15 weights, with tests.
3. **Deterministic search engine abstraction** that generates parameterized SQL (good foundation for “no LLM in retrieval/ranking”).
4. **Crisis routing implemented** (keyword gate) with unit tests and accessible UI affordances.
5. **Governance scaffolding**: PR template + issue forms explicitly encode the safety checklist.

### Biggest risks/weaknesses (top 10)
1. **Docs overstate implementation** in multiple areas (Clerk integration, role enforcement, security headers, rate limiting coverage, i18n file-based JSON). This creates a high risk of “false confidence.”
2. **Retrieval is not wired**: both `/api/chat` and `/api/search` use mocks. This means the “retrieval-first” principle is honored by *absence of retrieval*, not by a verified DB-backed implementation.
3. **Rate limiting is in-memory only**: it now covers chat/search/feedback, but will not hold under multi-instance/serverless deployments without a shared store (e.g., Redis).
4. **LLM guardrails are underspecified in code**: there is an LLM summarization hook, but no runtime verifier that the summary contains only retrieved facts.
5. **Role-based access control is not implemented** (middleware is auth-only; no role checks in API handlers shown).
6. **Import pipeline is largely aspirational**: no staging tables, no diff detection, no provenance fields, and only partial file validation.
7. **Privacy controls are not enforced**: docs claim approximate location and rounding in API responses, but there is no implemented rounding layer.
8. **Search confidence filtering needs deprecation cleanup**: `/api/search` now supports `minConfidenceScore` (0–100) and accepts legacy `minConfidence` (0–1) for compatibility.
9. **Accessibility tooling gap**: no automated a11y linting or checks (no `eslint-plugin-jsx-a11y`, no axe/Playwright).
10. **Production hardening gaps**: memory-based quota/rate-limit will not work in serverless/multi-instance deployments; and there’s no Redis/caching layer.

### “Stop the line” issues (anything that violates non-negotiables)
- **None observed that actively violate “no hallucinated services”** today, because retrieval is mocked and UI only displays what the API returns.
- **However, there are “stop the line” alignment risks**:
  1) Security & privacy documentation claims protections that are not implemented (role enforcement, headers, rate limiting for multiple endpoints). In a safety-critical product, “docs say it exists” can be as dangerous as “it doesn’t exist.”
  2) The LLM summarization hook exists without a fact-containment verifier; if enabled later, it could violate “no invented facts” unless guardrails are added.

---

## 2) Repo Inventory (truth map)

Maturity legend:
- **Scaffold**: placeholder or not wired
- **Partial**: implemented core logic but missing integration/production hardening
- **Strong**: implemented with tests and aligned docs
- **Production-ready**: secure, scalable, observable, and end-to-end integrated

| Path | Purpose | Maturity | Owner/role | Notes (important constraints) |
|---|---|---:|---|---|
| `/docs` | SSOT specs, governance and safety contracts | Partial | `CODEOWNERS`: `@AutomatedEmpires` | Several docs are aspirational vs current code; see SSOT section. |
| `/db` | Local DB compose, migrations, seed, importer scaffolding | Partial | `@AutomatedEmpires` | Migration exists and creates core tables; importer does validation only; no staging tables. |
| `/db/migrations/0000_initial_schema.sql` | Current DB schema truth | Strong | `@AutomatedEmpires` | Canonical schema for code types in `src/domain/types.ts`. |
| `/db/import/hsds-csv-importer.ts` | HSDS CSV validation/import scaffolding | Scaffold | `@AutomatedEmpires` | Validates `organizations.csv` and `services.csv`; does not write to DB or diff/publish. |
| `/src/app` | Next.js routes/pages and API endpoints | Partial | `@AutomatedEmpires` | Many pages are placeholders; APIs are mocked for retrieval. |
| `/src/app/api/chat/route.ts` | Chat API entrypoint | Partial | `@AutomatedEmpires` | Zod validation + rate limit + orchestrator; retrieval currently mocked (`retrieveServices()` returns `[]`). |
| `/src/app/api/search/route.ts` | Search API entrypoint | Scaffold | `@AutomatedEmpires` | Builds structured query but uses mock engine; supports `minConfidenceScore` (0–100) + legacy `minConfidence` (0–1); basic rate limit (in-memory). |
| `/src/app/api/feedback/route.ts` | Feedback API entrypoint | Partial | `@AutomatedEmpires` | Zod validation + logs; does not persist to DB. Basic rate limit (in-memory). |
| `/src/services` | Deterministic business logic: chat/search/scoring/flags/i18n/telemetry | Partial→Strong | `@AutomatedEmpires` | Scoring + search query builder are strong; i18n and flags are in-memory; no DB integration layer. |
| `/src/services/chat/orchestrator.ts` | Chat pipeline implementation | Strong (logic) | `@AutomatedEmpires` | Crisis/quota/intent/LLM gate are deterministic; retrieval injected via deps. |
| `/src/services/search/engine.ts` | SQL query builder + search engine abstraction | Strong (logic) | `@AutomatedEmpires` | Generates parameterized SQL; execution depends on injected DB executor. |
| `/src/services/scoring/scorer.ts` | Confidence scoring contract | Strong | `@AutomatedEmpires` | Aligns with docs; unit tests verify weights/invariants. |
| `/src/services/flags/flags.ts` | Feature flags | Partial | `@AutomatedEmpires` | In-memory store only; DB wiring is planned (table exists). |
| `/src/services/i18n/i18n.ts` | i18n utility | Partial | `@AutomatedEmpires` | Inline English dict only; docs claim JSON locales + missing-key behavior differs. |
| `/src/components` | UI components (chat/service cards/map placeholder/ui primitives) | Partial | `@AutomatedEmpires` | ChatWindow is functional and a11y-aware; map/directory are placeholders. |
| `/src/middleware.ts` | Route-level auth / authorization | Partial | `@AutomatedEmpires` | Auth-only when Clerk env present; fails closed (503) in production if auth is unavailable/misconfigured; no role enforcement. |
| `/.github` | CI workflows + PR template + issue forms | Strong | `@AutomatedEmpires` | CI covers lint/typecheck/test/build on `main` PRs/pushes. Coverage upload is best-effort. |
| `/app` | (Required by audit spec) | N/A | `@AutomatedEmpires` | No root-level `/app` directory; Next.js uses `src/app`. |

---

## 3) Single Source of Truth (SSOT) Documents

This repo contains multiple “truth sources.” For safety-critical work, SSOT must be explicit: *which document wins* when contradictions exist.

### Current SSOT hierarchy (recommended to adopt explicitly)

Until the repo formalizes this (e.g., in `docs/GOVERNANCE.md`), this audit uses the following precedence rules:
1. **Executable contracts (code + tests)** win over prose when they conflict.
2. **Database schema**: `db/migrations/0000_initial_schema.sql` is canonical for persisted data shape.
3. **Runtime constants**: `src/domain/constants.ts` is canonical for safety-critical constants (crisis keywords/resources, scoring weights, disclaimers).
4. **Design/spec docs** in `/docs` are SSOT *only when aligned with (1)–(3)*; otherwise they must be treated as “planned.”

### SSOT candidates and evaluation

Below is a comprehensive list of documents that currently function as SSOT *or attempt to*, plus the alignment check to current code.

#### docs/VISION.md
- **Owns**: non-negotiables and product intent (retrieval-first, crisis gate, no hallucinations, accessibility, privacy).
- **Must never contradict**: chat/search/scoring implementation and UI messaging.
- **Code modules that must align**: `src/services/chat/orchestrator.ts`, `src/domain/constants.ts`, `src/services/search/engine.ts`, UI surfaces under `src/app/(seeker)`.
- **Status**: Mostly aligned as intent; does not claim details that contradict code.
- **One fix**: Add an “Implementation status” block: “retrieval currently mocked; directory UI placeholder; Clerk not wired.”

Doc anchors of interest:
- `docs/VISION.md#non-negotiables`
- `docs/VISION.md#product-surfaces`

#### docs/CHAT_ARCHITECTURE.md
- **Owns**: chat pipeline stage ordering and “LLM only after retrieval” rule.
- **Must never contradict**: `orchestrateChat()` pipeline and API handler behavior.
- **Code modules that must align**: `src/services/chat/orchestrator.ts`, `src/app/api/chat/route.ts`, `src/domain/constants.ts`.
- **Status**: Largely aligned on stage ordering. Notably:
  - Rate limiting is enforced in `src/app/api/chat/route.ts` (not inside orchestrator), which is consistent with “Stage 3 handled before intent.”
  - “Retrieval via SQL/PostGIS” is aspirational; chat retrieval is currently mocked.
- **One fix**: Change “Stage 6: Retrieval = Pure SQL/PostGIS query” to “Retrieval is injected; current API uses a mock retrieval stub; DB integration pending.”

Doc anchors of interest:
- `docs/CHAT_ARCHITECTURE.md#pipeline-overview`
- `docs/CHAT_ARCHITECTURE.md#stage-1-crisis-detection`
- `docs/CHAT_ARCHITECTURE.md#stage-6-retrieval`

#### docs/SCORING_MODEL.md
- **Owns**: public scoring contract, sub-scores, weights, and messaging expectations.
- **Must never contradict**: `src/services/scoring/scorer.ts` and how UI surfaces show confidence.
- **Code modules that must align**: `src/services/scoring/scorer.ts`, `src/domain/constants.ts`, UI `Badge` usage and card components.
- **Status**: Aligned on formula/weights; **not aligned** on “All surfaces must display the band and the three sub-scores” (UI does not show sub-scores).
- **One fix**: Add an “Implementation note” that sub-score display is not yet implemented; only band + score are shown where score exists.

Doc anchors of interest:
- `docs/SCORING_MODEL.md#public-score-contract-required`
- `docs/SCORING_MODEL.md#confidence-bands-and-messaging`

#### docs/DATA_MODEL.md
- **Owns**: intended schema (HSDS core + ORAN extensions) and integrity rules.
- **Must never contradict**: `db/migrations/0000_initial_schema.sql` and `src/domain/types.ts`.
- **Code modules that must align**: `db/migrations/0000_initial_schema.sql`, `src/domain/types.ts`, `src/services/search/engine.ts`.
- **Status**: Mostly aligned with the migration for tables listed. Some integrity rules are aspirational (e.g., API coordinate rounding; soft deletes via status is present).
- **One fix**: Add an explicit “Schema source-of-truth” line: “`db/migrations/0000_initial_schema.sql` is canonical; DATA_MODEL.md must match it.”

Doc anchors of interest:
- `docs/DATA_MODEL.md#core-hsds-entities`
- `docs/DATA_MODEL.md#oran-extensions`
- `docs/DATA_MODEL.md#data-integrity-rules`

#### docs/IMPORT_PIPELINE.md
- **Owns**: import-first staging/diff/review/publish workflow.
- **Must never contradict**: importer implementation and DB schema (staging tables).
- **Code modules that must align**: `db/import/hsds-csv-importer.ts`, future staging schema/migrations.
- **Status**: **Not aligned** with current implementation (no staging tables; importer does not stage/diff/publish; validation only for two files).
- **One fix**: Add a top banner: “Pipeline stages 2–6 are planned; current importer only validates organizations/services and outputs a report.”

Doc anchors of interest:
- `docs/IMPORT_PIPELINE.md#pipeline-stages`
- `docs/IMPORT_PIPELINE.md#staging-tables`

#### docs/SECURITY_PRIVACY.md
- **Owns**: security/privacy model and constraints.
- **Must never contradict**: middleware behavior, API routes, Next.js security headers, data persistence.
- **Code modules that must align**: `src/middleware.ts`, `next.config.ts`, `src/app/api/*`, `src/services/telemetry/sentry.ts`.
- **Status**: **Substantially aspirational vs code**:
  - Role enforcement and “defense in depth” is not implemented (middleware is auth-only).
  - Security headers are not configured in `next.config.ts` (it currently exports an empty config object).
  - Rate limits for search/feedback/etc aren’t implemented.
  - Data retention/audit logging tables aren’t present.
- **One fix**: Split into two sections: “Implemented Today” vs “Planned / ADR Required,” and explicitly link the enforcement points.

Doc anchors of interest:
- `docs/SECURITY_PRIVACY.md#authentication-model`
- `docs/SECURITY_PRIVACY.md#rate-limiting`
- `docs/SECURITY_PRIVACY.md#security-headers`

#### docs/INTEGRATIONS.md
- **Owns**: third-party integration assumptions (Clerk, Neon, Sentry, flags).
- **Must never contradict**: app layout/middleware and actual integration files.
- **Code modules that must align**: `src/middleware.ts`, `src/app/layout.tsx`, `src/services/telemetry/sentry.ts`, flags and DB wiring.
- **Status**: **Not aligned**:
  - `src/app/layout.tsx` does not wrap with `ClerkProvider`.
  - It references non-existent paths (`db/schema/`, `src/services/external/211.ts`).
- **One fix**: Update to only list integrations that exist *today*, and move “Future integrations” into a separate clearly-labeled section with correct “future” paths.

Doc anchors of interest:
- `docs/INTEGRATIONS.md#authentication-clerk`
- `docs/INTEGRATIONS.md#feature-flags`

#### docs/UI_SURFACE_MAP.md
- **Owns**: route inventory and component hierarchy.
- **Must never contradict**: `src/app/**/page.tsx` and `src/components/**`.
- **Code modules that must align**: `src/app/(seeker)/**`, `src/app/(host)/**`, `src/app/(community-admin)/**`, `src/app/(oran-admin)/**`.
- **Status**: **Aspirational**: most described components/routes don’t exist or are placeholders (e.g., queue tables, dialogs, forms).
- **One fix**: Add maturity tags per route: Implemented / Placeholder / Planned.

Doc anchors of interest:
- `docs/UI_SURFACE_MAP.md#seeker-routes-public-facing`
- `docs/UI_SURFACE_MAP.md#host-routes-organization-management`

#### docs/GOVERNANCE.md
- **Owns**: process truth (labels, ADR/spec requirements, testing norms).
- **Must never contradict**: PR template, CI.
- **Status**: Aligned.
- **One fix**: None required.

Doc anchors of interest:
- `docs/GOVERNANCE.md#safety-critical-norms`

#### docs/ROLES_PERMISSIONS.md
- **Owns**: role definitions and permission matrix.
- **Must never contradict**: middleware/API checks.
- **Status**: **Not enforced in code**; currently a design contract.
- **One fix**: Add “Enforcement status: planned; middleware currently checks auth only.”

Doc anchors of interest:
- `docs/ROLES_PERMISSIONS.md#enforcement-points`

#### docs/I18N_WORKFLOW.md
- **Owns**: localization workflow and missing-key behavior.
- **Must never contradict**: `src/services/i18n/i18n.ts`.
- **Status**: Not aligned (docs describe JSON locale files, missing-key throw in dev, and `test:i18n`; code uses inline dict and returns key fallback).
- **One fix**: Update doc to match current approach or implement the documented file-based system (future PR).

Doc anchors of interest:
- `docs/I18N_WORKFLOW.md#overview`
- `docs/I18N_WORKFLOW.md#missing-key-behavior`

#### Top-level workflow truth docs
- README.md
  - **Owns**: quickstart and developer entrypoint.
  - **Status**: Aligned for dev server + docker DB start.
- CODEOWNERS
  - **Owns**: ownership.
  - **Status**: Minimal; single owner.
- .github/PULL_REQUEST_TEMPLATE.md
  - **Owns**: required review checklist (safety/scoring/a11y).
  - **Status**: Strong safety contract.
- .github/ISSUE_TEMPLATE/*.yml
  - **Owns**: intake workflow truth (spec proposals, security reports, import requests).
  - **Status**: Strong.

---

## 4) Safety-Critical Contract Compliance

Checklist matrix (PASS / PARTIAL / FAIL). “Where enforced” references the *actual* enforcement points.

| Non-negotiable | Where enforced in code (exact paths + symbols) | Where documented | How tested | Status | Minimal corrective actions (if PARTIAL/FAIL) |
|---|---|---|---|---:|---|
| No LLM in retrieval or ranking | Search: `src/services/search/engine.ts` builds pure SQL; API uses mock executor in `src/app/api/search/route.ts` (no LLM). Chat: `src/services/chat/orchestrator.ts` enforces retrieval via injected `retrieveServices()`; no LLM used for retrieval/ranking. | `docs/VISION.md#non-negotiables`; `docs/CHAT_ARCHITECTURE.md#pipeline-overview` | Indirect (unit tests assert gate ordering and deterministic builders; no explicit “no LLM” test) | PASS | Add a regression test that fails if any retrieval path imports an LLM SDK or calls summarization before retrieval. |
| No hallucinated services | `src/services/chat/orchestrator.ts` `assembleResponse()` only transforms retrieved services; `src/components/chat/ChatWindow.tsx` renders API-returned cards only; `src/components/directory/ServiceCard.tsx` renders passed-in `EnrichedService` | `docs/VISION.md`; `docs/CHAT_ARCHITECTURE.md` | `src/services/chat/__tests__/intent-schema.test.ts` (eligibility disclaimer + crisis; indirectly ensures only provided services are returned) | PASS (today) | Before wiring DB retrieval, add tests that validate “no invented fields” for real DB rows and serialization boundaries. |
| Crisis hard gate (911/988/211) | `src/services/chat/orchestrator.ts` `detectCrisis()` and early return in `orchestrateChat()`; crisis constants in `src/domain/constants.ts` `CRISIS_KEYWORDS`/`CRISIS_RESOURCES`; UI `CrisisBanner()` in `src/components/chat/ChatWindow.tsx` | `docs/VISION.md`; `docs/CHAT_ARCHITECTURE.md` | `src/services/chat/__tests__/intent-schema.test.ts` (crisis detection + crisis response) | PASS | Consider keyword false positives/negatives as future tuning; keep stage ordering invariant tested. |
| Eligibility caution (“may qualify / confirm”) | `src/domain/constants.ts` `ELIGIBILITY_DISCLAIMER`; `src/services/chat/types.ts` `enrichedServiceToCard()` sets `eligibilityHint`; UI note in `src/components/chat/ChatWindow.tsx`; directory card hint in `src/components/directory/ServiceCard.tsx` | `docs/VISION.md`; `docs/SCORING_MODEL.md`; `docs/CHAT_ARCHITECTURE.md` | `src/services/chat/__tests__/intent-schema.test.ts` asserts qualifying language | PASS | Ensure all future surfaces reuse the same disclaimer constant (no ad-hoc copies). |
| Accessibility-first (keyboard/screen reader/mobile/low bandwidth) | Chat UI has basic ARIA roles/labels in `src/components/chat/ChatWindow.tsx`; other surfaces are placeholders. No automated tooling. | `docs/VISION.md#non-negotiables`; PR template checklist | None | PARTIAL | Add `eslint-plugin-jsx-a11y` + a minimal axe test for `ChatWindow`; remove/replace emoji glyphs with accessible icons where needed. |
| Consent-to-save profile updates | Not implemented (no profile persistence API/routes; `/profile` is placeholder `src/app/(seeker)/profile/page.tsx`) | `docs/VISION.md`; `docs/SECURITY_PRIVACY.md`; `docs/UI_SURFACE_MAP.md` | None | PARTIAL (safe-by-absence) | Before adding profile persistence: implement explicit consent state + server-side enforcement; add tests around “no writes without consent.” |
| Approximate location by default | Not implemented end-to-end. Types mention it (`src/services/chat/types.ts` `ChatContext.approximateLocation` and `src/domain/types.ts` comments), but there is no implemented rounding in API responses and no location persistence. | `docs/VISION.md`; `docs/SECURITY_PRIVACY.md` | None | PARTIAL | Add a single “location precision policy” module (serialize/round at API boundary) and unit-test it; document exact rounding rule. |
| Rate limiting / quota gates | Chat/Search/Feedback: basic in-memory rate limiting at API boundary (`src/services/security/rateLimit.ts`); quota via `src/services/chat/orchestrator.ts` `checkQuota()/incrementQuota()`. | `docs/CHAT_ARCHITECTURE.md`; `docs/SECURITY_PRIVACY.md` | Quota tested in `src/services/chat/__tests__/intent-schema.test.ts`; rate limit is unit tested | PARTIAL | Move to shared backing store (Redis) for multi-instance deployments; keep per-endpoint limits documented and tested. |
| Input validation with Zod | `src/app/api/chat/route.ts` uses `ChatRequestSchema`; `src/app/api/search/route.ts` uses `SearchParamsSchema`; `src/app/api/feedback/route.ts` uses `FeedbackRequestSchema`; importer uses Zod schemas in `db/import/hsds-csv-importer.ts` | `docs/IMPORT_PIPELINE.md`; `docs/SECURITY_PRIVACY.md` | Implicitly tested via unit tests on chat/search/scoring modules; importer not tested | PASS | Add tests for API param schemas and importer row schemas if importer moves toward production usage. |
| “LLM summarization must not add facts” guardrails | Only gating exists: `src/services/chat/orchestrator.ts` `OrchestratorDeps.summarizeWithLLM?` + feature flag `FEATURE_FLAGS.LLM_SUMMARIZE`; no output verifier exists | `docs/VISION.md`; `docs/CHAT_ARCHITECTURE.md`; `docs/INTEGRATIONS.md` | `src/services/chat/__tests__/intent-schema.test.ts` tests gate behavior, not factual containment | PARTIAL | Add a post-summary verifier (e.g., allowlist-only tokens/fields or structured summary format) + tests that reject out-of-record facts before enabling any LLM integration. |

Notes:
- PASS here does *not* mean “production-ready”; it means “current code does not violate the contract in its current (mostly mocked) state.”

---

## 5) Architecture & Boundaries (are we actually deterministic?)

### Chat pipeline stages + handoffs (implemented)
Primary implementation: `src/services/chat/orchestrator.ts` `orchestrateChat()`.

Stages (as code):
1. **Crisis detection**: `detectCrisis(message)` → early return `assembleCrisisResponse()`.
2. **Quota check**: `checkQuota(sessionId)` → early return with quota message.
3. **Rate limit**: enforced in `src/app/api/chat/route.ts` using `checkRateLimit(key)`.
4. **Intent detection**: `detectIntent(message)` via keyword map.
5. **Profile hydration/context**: `assembleContext(sessionId, userId)` (currently minimal; no DB).
6. **Retrieval**: injected `deps.retrieveServices(intent, context)`.
7. **Response assembly**: `assembleResponse(services, intent, context)` transforms records into `ServiceCard` (no generation).
8. **Optional LLM summarization gate**: only if feature flag enabled and services exist.

Determinism assessment:
- Crisis detection, intent detection, quota, and rate limiting are deterministic today.
- Retrieval is deterministic by contract, but currently not implemented.
- LLM summarization (if enabled later) is non-deterministic unless constrained/verified.

### Search engine contract + query plan object
- Contract types live in `src/services/search/types.ts` (`SearchQuery`, filter types).
- The *query plan object* is effectively the return of `buildSearchQuery(query)` in `src/services/search/engine.ts` → `{ sql, params, countSql, countParams }`.
- SQL is parameterized throughout, which is consistent with injection prevention.

### Retrieval (SQL/PostGIS) and exact entry points
- Search API entry point: `src/app/api/search/route.ts` (currently uses `mockEngine`).
- Engine that performs SQL building + execution: `src/services/search/engine.ts` `ServiceSearchEngine`.
- Chat retrieval entry point: `src/app/api/chat/route.ts` defines `retrieveServices()` (currently returns `[]`) and passes it to `orchestrateChat()`.

### Scoring module inputs/outputs and 0–100 x3 model + final weights
- Implementation: `src/services/scoring/scorer.ts` `computeScore()`.
- Weights: `src/domain/constants.ts` `ORAN_CONFIDENCE_WEIGHTS` `{ verification: 0.45, eligibility: 0.40, constraint: 0.15 }`.
- Tests: `src/services/scoring/__tests__/scoring.test.ts` asserts exact formula.
- Inputs: structured evidence (`ServiceEvidence`) and upstream scores; does not infer sensitive attributes.

### Response templates and fact containment rules
- Chat response uses templated strings in `assembleResponse()` and includes `ELIGIBILITY_DISCLAIMER`.
- Service detail fields are taken directly from `EnrichedService` (which is meant to reflect DB rows).
- Fact containment risk area: `summarizeWithLLM()` output, because it replaces `response.message` without verification.

### “Leaky abstractions” risk: can UI/chat bypass retrieval?
- Current UI does not bypass retrieval; it only renders what API returns.
- The main leak risk is **future integration**:
  - If someone adds “helpful” completion text directly in UI (client-side) or in API without DB records, it could violate “no hallucinated facts.”
  - If search API begins mixing external sources without staging/verification, it could violate import-first governance.

---

## 6) Data Model (HSDS + ORAN Extensions) Reality Check

Canonical schema source: `db/migrations/0000_initial_schema.sql`.

### HSDS tables that exist (in migration)
Present:
- `organizations`
- `locations`
- `services`
- `service_at_location`
- `phones`
- `addresses`
- `schedules`
- `taxonomy_terms` (HSDS “taxonomy” concept)
- `service_taxonomy`

### HSDS tables missing (relative to full HSDS)
Not present (examples; not exhaustive HSDS coverage):
- `programs` (mentioned as `program_id` but no table)
- `contacts`, `languages`, `accessibility_for_disabilities`
- `eligibility`, `required_documents`
- `funding`, `payments_accepted`, `regular_schedules` (depending on HSDS interpretation)

Implication: ORAN is **HSDS-inspired**, not full HSDS.

### ORAN extension tables that exist
Present:
- `confidence_scores`
- `verification_queue`
- `seeker_feedback`
- `chat_sessions`
- `feature_flags`

### ORAN extension tables missing (claimed/expected by docs)
Docs imply (or require) additional entities that do not exist yet:
- `audit_logs` (SECURITY_PRIVACY “append-only audit logs”)
- `user_profiles` (profile persistence + consent)
- `coverage_zones` (for community admin zone scoping)
- `host_claims` (claim workflow)
- staging/import batch tables described in IMPORT_PIPELINE

### Indexes, constraints, foreign keys, auditability
Strengths:
- FKs exist for most relationships.
- PostGIS gist index exists on `locations.geom`.
- Text search GIN indexes exist for `organizations.name`, `services.name`, `services.description`.
- Check constraints exist for service status and score ranges.

Gaps:
- No `updated_at` triggers to auto-update timestamps on update.
- No audit log table for write history.
- No staging/provenance columns for import-first workflows.

### Schema choices that may hurt import-first workflows
- Without staging tables and provenance fields, you cannot safely:
  - ingest new sources
  - diff against existing records
  - attribute fields to sources/licenses
  - support rollback per import batch

### Taxonomy mapping flexibility
- `taxonomy_terms.taxonomy` exists (default ‘custom’), which supports multiple taxonomies.
- However, there is no mapping layer yet in code/importer; taxonomy may become accidentally hardcoded once importer/UI are implemented unless a flexible mapping contract is added.

---

## 7) Import-First Workflow Audit

### Current importer(s) and staging design
- Importer file: `db/import/hsds-csv-importer.ts`.
- Reality: validates CSV parsing and row-level Zod validation for:
  - `organizations.csv`
  - `services.csv`
- It **does not** currently:
  - validate `locations.csv`, `addresses.csv`, `phones.csv`, `service_at_location.csv`, `schedules.csv` (raw types exist but not wired)
  - connect to DB
  - stage rows
  - compute diffs
  - publish to live tables

### What validation is performed
- Zod schemas for organization/location/service/address; only org/service are actually used right now.
- Warning generation (missing URL, missing description).

### Provenance fields
- None in DB schema today (no `import_batch_id`, `import_status`, `import_diff`, `imported_by`, `imported_at`).
- Docs describe these fields, but they are not implemented.

### “unverified → moderation queue → verified/published” lifecycle representation
- DB has `verification_queue` table.
- UI/community-admin routes exist as placeholders (pages present but no functionality).
- There is no code that:
  - writes to `verification_queue`
  - updates service “published/verified” status
  - uses verification status in retrieval filters

### What’s missing for real-world safety
- License/terms tracking per data source (issue template collects it; schema does not store it).
- Source freshness, change detection, and staleness detection.
- Deduplication strategy beyond “id or fuzzy match” described in docs (not implemented).
- Safe “delete” semantics per source update.

---

## 8) Testing & CI Audit

### What tests exist and what they cover
- Chat unit tests: `src/services/chat/__tests__/intent-schema.test.ts`
  - crisis detection
  - intent detection
  - eligibility disclaimer presence
  - LLM gate behavior (call/no-call)
  - quota basics
- Scoring unit tests: `src/services/scoring/__tests__/scoring.test.ts`
  - exact weight formula
  - verification penalty/signal math
  - band boundaries
- Search unit tests: `src/services/search/__tests__/query-builder.test.ts`
  - SQL fragment builders
  - pagination and count query
  - engine calling deps

### Gaps in safety-critical coverage
- No tests for:
  - rate limiting behavior (`checkRateLimit()` reset window / exceeded threshold)
  - “no hallucinations” at API serialization boundaries when DB retrieval is added
  - privacy rounding guarantees (approximate location)
  - any role/authorization enforcement
  - any UI accessibility tests

### CI workflows and triggers
- Workflow: `/.github/workflows/ci.yml`
- Triggers:
  - `push` to `main`
  - `pull_request` targeting `main`
- Jobs:
  - lint (`npm run lint`)
  - typecheck (`npx tsc --noEmit`)
  - test (`npm run test:coverage`)
  - build (`npm run build`) depends on prior jobs

### CI blockers / environment assumptions
- Tests are node-only and self-contained; no DB needed.
- Build is likely to pass without Clerk/Sentry env due to lazy imports.
- Note: if future code introduces mandatory env var access at module import time, CI may break.

### Codecov integration evaluation
- Coverage upload uses `codecov/codecov-action@v4` with `fail_ci_if_error: false` and `continue-on-error: true`.
- Result: coverage reporting is best-effort; it does not enforce thresholds beyond Vitest’s `vitest.config.ts` thresholds.

---

## 9) Accessibility Audit (baseline)

Constraint: no new UI features added; this is an evaluation only.

### Core surfaces status
- Chat (`src/components/chat/ChatWindow.tsx`):
  - Good: `role="log"`, `aria-live="polite"`, `CrisisBanner` uses `role="alert"` and `aria-live="assertive"`, input has `aria-label`, send button has `aria-label`.
  - Concern: emojis like `📍` and `📞` are present in text; screen readers may announce them. Consider using icons with `aria-hidden` instead.
- Map (`src/components/map/MapContainer.tsx`):
  - Placeholder but includes `role="region"` and an `aria-label`.
- Directory (`src/app/(seeker)/directory/page.tsx`):
  - Placeholder.

### Where accessibility standards are documented and enforced
- Documented as a non-negotiable in `docs/VISION.md` and in PR template checklist.
- Not enforced via tooling:
  - ESLint config is Next core-web-vitals + typescript only (no jsx-a11y).
  - No Playwright or axe tests.

### Minimal next step (proposed)
- Add automated a11y baseline:
  - lint: `eslint-plugin-jsx-a11y` for JSX components
  - test: add one `vitest` + `@testing-library/react` + `axe-core` check for `ChatWindow` rendering

---

## 10) Action Plan (P0/P1)

Labels format: `area:*` + `risk:*` + `priority:*` + `type:*`.

### P0: must fix before any “real data” import or public demo
1. **Make docs match reality (safety-critical truthfulness)**
   - Labels: `area:docs` `risk:safety` `priority:P0` `type:spec`
   - Acceptance criteria:
     - Each SSOT doc has an “Implementation status” section.
     - `SECURITY_PRIVACY.md` and `INTEGRATIONS.md` no longer claim non-existent enforcement.
   - Likely files: `docs/SECURITY_PRIVACY.md`, `docs/INTEGRATIONS.md`, `docs/UI_SURFACE_MAP.md`, `docs/IMPORT_PIPELINE.md`, `docs/I18N_WORKFLOW.md`

2. **Wire retrieval to DB for search (end-to-end retrieval-first) or explicitly gate UI until wired**
   - Labels: `area:search` `risk:safety` `priority:P0` `type:scaffold`
   - Acceptance criteria:
     - `/api/search` executes parameterized SQL via `pg` or Drizzle; no mocks.
     - Add integration test that validates returned results come from DB rows.
   - Likely files: `src/app/api/search/route.ts`, `src/services/search/engine.ts`, new DB adapter module

3. **Fix `minConfidence` scale mismatch (0–1 vs 0–100)**
   - Labels: `area:api` `risk:correctness` `priority:P0` `type:bug`
   - Acceptance criteria:
     - API accepts and documents a single scale (0–100) to match DB + docs.
     - Backward compatibility: legacy `minConfidence` (0–1) remains supported temporarily with clear deprecation.
   - Likely files: `src/app/api/search/route.ts`, `src/services/search/types.ts`, docs

4. **Implement rate limiting consistently across APIs claimed in docs**
   - Labels: `area:security` `risk:abuse` `priority:P0` `type:scaffold`
   - Acceptance criteria:
     - `/api/search` and `/api/feedback` enforce rate limits.
     - Shared utility with unit tests for window reset and exceeded logic.
   - Likely files: `src/app/api/search/route.ts`, `src/app/api/feedback/route.ts`, `src/services/chat/orchestrator.ts` (extract rate limit)


5. **Add LLM fact-containment guardrails BEFORE any LLM integration**
   - Labels: `area:chat` `risk:safety` `priority:P0` `type:spec`
   - Acceptance criteria:
     - Summarization output is validated against retrieved records (structured output or verifier).
     - Tests cover rejection of added phone/address/hours/URLs.
   - Likely files: `src/services/chat/orchestrator.ts`, new verifier module, tests in `src/services/chat/__tests__`

### P1: needed soon after
1. **RBAC enforcement (roles) aligned to docs**
   - Labels: `area:auth` `risk:security` `priority:P1` `type:scaffold`
   - Acceptance criteria:
     - Middleware enforces route-level roles.
     - API routes enforce resource-level permissions.
     - Tests for unauthorized access.
   - Likely files: `src/middleware.ts`, `src/app/api/**`, docs

2. **Implement import staging + provenance schema**
   - Labels: `area:import` `risk:data-integrity` `priority:P1` `type:scaffold`
   - Acceptance criteria:
     - Staging tables exist with `import_batch_id`, `import_status`, `import_diff`, `imported_by`, `imported_at`.
     - Importer writes to staging and produces a diff report.
   - Likely files: new migration under `db/migrations`, `db/import/hsds-csv-importer.ts`, docs

3. **Privacy boundary module for location precision**
   - Labels: `area:privacy` `risk:privacy` `priority:P1` `type:scaffold`
   - Acceptance criteria:
     - A single serializer controls rounding/redaction of sensitive fields.
     - Unit tests prove rounding rule.
   - Likely files: new module under `src/services/` or `src/domain/`, API routes

4. **Accessibility tooling baseline**
   - Labels: `area:ui` `risk:accessibility` `priority:P1` `type:scaffold`
   - Acceptance criteria:
     - a11y lint enabled and CI includes it.
     - One axe test for chat surface.
   - Likely files: `eslint.config.mjs`, new test files

---

### Appendix: Key enforcement points (quick links)
- Crisis keywords/resources: `src/domain/constants.ts` (`CRISIS_KEYWORDS`, `CRISIS_RESOURCES`)
- Chat orchestrator: `src/services/chat/orchestrator.ts` (`orchestrateChat`, `detectCrisis`, `checkQuota`, `checkRateLimit`)
- Chat API: `src/app/api/chat/route.ts`
- Search engine: `src/services/search/engine.ts` (`buildSearchQuery`, `ServiceSearchEngine`)
- Search API: `src/app/api/search/route.ts`
- Scoring: `src/services/scoring/scorer.ts` (`computeScore`)
- DB schema: `db/migrations/0000_initial_schema.sql`
- CI: `/.github/workflows/ci.yml`
