# ORAN Platform Architecture

ORAN is a public resource intelligence network: a verified resource data platform that aggregates service information, normalizes it into canonical records, governs trust and publication, and distributes that data across seeker experiences, operator workflows, and machine-consumable APIs. The production runtime is Vercel + Supabase/PostgreSQL + Clerk + Sentry. The schema and retrieval boundaries can support multiple regions, while the current governed regional MVP supply is the reviewed Washington HRSA cohort; architectural capacity must never be presented as nationwide service coverage.

## Platform Pillars

| Pillar | Purpose | Primary Repo Areas |
| --- | --- | --- |
| Resource Data Graph | Canonical organizations, services, locations, programs, taxonomy, confidence, coverage, and federation layers | `db/migrations/**`, `src/db/**`, `src/domain/**` |
| Ingestion and Federation | Source ingestion, evidence capture, normalization, crosswalks, dedupe, and publish preparation | `src/agents/ingestion/**`, `src/services/ingestion/**`, `src/app/api/admin/ingestion/**`, `src/app/api/internal/**`, `vercel.json` |
| Trust and Governance | Audit, approvals, scopes, zones, appeals, workflow gates, queueing, confidence regressions, moderation | `src/services/workflow/**`, `src/services/community/**`, `src/services/triage/**`, `src/services/regression/**`, `src/app/api/admin/**`, `src/app/api/community/**` |
| Discovery and Navigation | Deterministic retrieval, scoring, seeker search, map, chat, HSDS distribution, saved/profile shaping | `src/services/search/**`, `src/services/scoring/**`, `src/services/chat/**`, `src/app/(seeker)/**`, `src/app/api/search/**`, `src/app/api/chat/**`, `src/app/api/hsds/**` |
| Participation and Operations | Host portals, organization self-management, forms, submissions, notifications, resource studio | `src/app/(host)/**`, `src/services/organizations/**`, `src/services/forms/**`, `src/services/resourceSubmissions/**`, `src/services/notifications/**`, `src/app/api/host/**`, `src/app/api/forms/**` |
| Platform Delivery and Integrations | Clerk auth, feature flags, Sentry telemetry, caching, Vercel delivery/cron, Supabase runtime contracts, and archived provider boundaries | `src/services/auth/**`, `src/services/flags/**`, `src/services/cache/**`, `src/services/telemetry/**`, `src/services/runtime/**`, `vercel.json`, `.github/workflows/**`, `scripts/**` |

## Current System Map

### Core services

- `src/services/search/**` provides deterministic resource retrieval, cache behavior, discovery query compilation, and optional non-default hybrid search utilities.
- `src/services/chat/**` orchestrates crisis-first conversational navigation over stored records only.
- `src/services/workflow/**`, `src/services/community/**`, and `src/services/triage/**` implement the governance backbone around submissions, reviews, and queue movement.
- `src/services/forms/**`, `src/services/organizations/**`, `src/services/resourceSubmissions/**`, and `src/services/notifications/**` support operator participation and platform workflows.
- `src/services/auth/**`, `src/services/security/**`, `src/services/cache/**`, `src/services/flags/**`, and `src/services/telemetry/**` provide shared platform controls.
- `src/services/db/**` reaches Supabase PostgreSQL through validated, server-only direct SQL. Browser/Data API access remains denied unless a table receives an explicit RLS-reviewed client contract.
- `src/services/privacy/accountErasure.ts`, the private `oran_internal` erasure
  functions, and `/api/internal/account-erasure` form one durable privacy
  subsystem: synchronous access revocation, bounded background scrubbing, and
  fail-closed release/authorization gates.

### Database schema domains

- HSDS core: organizations, services, locations, addresses, phones, schedules, taxonomy.
- Trust and publication: confidence scores, audit logs, submissions, transitions, queueing, regressions.
- Participation: org memberships, host admins, seeker profiles, saved services, forms, notifications.
- Privacy operations: private erasure requests, fixed step ledgers, hashed
  identity blocks, worker leases, and the online-index release gate.
- Federation and ingestion: source assertion layer, canonical federation layer, taxonomy federation, resolution clustering, content templates.

### Ingestion pipelines

- `src/agents/ingestion/**` contains the canonical ingestion/federation domain with source records, normalization, taxonomy crosswalks, resolution, and 211 NDP connectors.
- `src/app/api/admin/ingestion/**` exposes operator controls for sources, jobs, candidates, feed polling, and publish readiness.
- Authenticated Next.js internal routes scheduled by `vercel.json` run production feed polling, SLA, coverage, confidence-regression, freshness, and account-erasure maintenance.
- Retired Azure/Foundry execution and deployment assets are absent and prohibited by runtime and CI policy.

Ingestion ownership rule:

- `src/agents/ingestion/**` is the canonical ingestion domain
- Next.js route handlers and authenticated Vercel Cron requests are the production execution boundary
- `src/services/ingestion/**` is a thin helper layer only
- authenticated Vercel job routes are the only scheduled ingestion execution path

### Discovery and search systems

- Seeker directory, map, and chat share a discovery grammar and deterministic ranking model.
- Public APIs expose search, service lookup, and HSDS-oriented distribution endpoints.
- Search is trust-first and retrieval-first. Any hybrid/vector capability must remain secondary to stored-record and trust-order guarantees.

Public distribution tiers:

- `/api/search` is the seeker discovery query surface
- `/api/services` is the published record lookup surface for already-known service IDs
- `/api/hsds/**` is the standards-oriented ecosystem distribution surface

### Conversational navigation

- Crisis detection, quota, rate limit, intent framing, profile hydration, retrieval, and response assembly are handled in `src/services/chat/**` and exposed via `src/app/api/chat/route.ts`. The orchestrator retains an optional post-retrieval summarizer interface, but the production route does not inject it.

### Dashboards and user portals

- `src/app/(seeker)/**`: seeker-facing chat, directory, map, saved services, profile, reports, and submissions.
- `src/app/(host)/**`: organization management, services, locations, admins, claims, resource studio, and forms.
- `src/app/(community-admin)/**`: coverage, review queue workbench, dashboard, and community forms.
- `src/app/(oran-admin)/**`: approvals, audit, scopes, zones, rules, templates, triage, ingestion, appeals, and discovery preview.

### Governance tools

- Universal submissions and transitions are the canonical workflow substrate.
- Audit logs, scopes/grants, coverage zones, approvals/appeals, forms, and confidence regressions are all part of one governance domain, not separate side systems.

### Infrastructure definitions and external integrations

- Vercel hosts the Next.js application and server route handlers; a merge to `main` is the production deployment boundary. `vercel.json` owns the authenticated maintenance schedules.
- Supabase provides PostgreSQL 17 with PostGIS/pgvector. Runtime queries use the project-bound pooled connection and a dedicated backend role; migrations use a separately validated direct connection.
- Clerk provides identity and sessions while ORAN database roles and explicit Clerk user mappings remain authoritative for application authorization.
- Sentry receives privacy-filtered client, server, and edge diagnostics when configured. Sensitive seeker text, precise location, form content, cookies, and authorization data must not enter telemetry.
- Redis, Resend, and provider-neutral maps are adapter-backed capabilities. Their absence must preserve documented degraded or fail-closed behavior; an adapter's presence is not evidence that a provider is operationally activated.
- Azure/Foundry runtime adapters, infrastructure, Functions, and deployment workflows are removed and must not be recreated. Optional Anthropic assistance is limited to review-gated ingestion.

## Architectural Drift Register

### P0

- Legacy `verification_queue` language is now mostly confined to compatibility/history material and a few internal prompt documents; live product and SSOT workflow surfaces largely describe the canonical submissions pipeline.

### P1

- Public data-access surfaces are now tiered contractually, but route implementations should continue converging on shared primitives and consistent runtime safeguards over time.
- Search documentation was written for the default SQL contract only, while the codebase also contains hybrid/vector utilities and admin embedding workflows. That capability is planned and constrained, but not consistently explained.
- Legacy compatibility shims remain in active paths: deprecated API routes, legacy status maps, legacy ingestion-source bridges, and deprecated migrations remain discoverable without a clear retirement plan.
- The retirement backlog is tracked in `docs/platform/LEGACY_RETIREMENT_MATRIX.md` and should be updated when compatibility paths are added, narrowed, or removed.

### P2

- The service catalog documentation is uneven across domains. Chat and search are documented well; host operations, forms, scopes, notifications, and ingestion/federation are less consistently represented in top-level architecture docs.
- Control-plane messaging still frames some accelerators as feature toggles instead of platform capability maturation, which makes long-term prioritization look tactical rather than architectural.

## Realignment Rules

1. Resource truth flows from source assertions to canonical entities to published discovery surfaces.
2. Search, chat, and APIs may only operate on stored records. No ingestion output becomes seeker-visible until it passes the publish workflow.
3. Governance operates on the same canonical entities and submissions that ingestion and publication use. No parallel review systems should be introduced.
4. Surface-specific features must map to a platform pillar. If a capability does not strengthen a pillar, it is platform drift.
5. Optional AI capabilities remain assistant layers. They may summarize, classify, or accelerate operator work, but they do not replace canonical retrieval, trust scoring, or publication controls.

## Foundation Priorities

### Deployment reliability

- Keep runtime/provider contract validation enforced in CI and before every Vercel production release.
- Preserve exact-SHA deployment proof, health checks, and live acceptance for each release.
- Keep abuse-sensitive, horizontally scaled controls on shared PostgreSQL or Redis primitives with documented fail-closed behavior.

### Schema integrity

- Treat the source assertion layer, canonical federation layer, and submissions/workflow tables as first-class platform schema domains.
- Retire legacy queue language as the migration completes.

### API correctness

- Explicitly tier the API surface into seeker retrieval, partner/HSDS distribution, and operator control APIs.
- Keep Zod validation and 429 `Retry-After` behavior consistent across all exposed routes.
- Keep the resource-distribution contract in `docs/contracts/RESOURCE_DISTRIBUTION_API.md` aligned with route behavior.

### Security and observability

- Preserve no-PII Sentry telemetry, fail-closed Clerk authorization, server-only provider credentials, project-bound database endpoints, and crisis-first gating.
- Keep Sentry release evidence and database audit logs aligned with high-risk workflow transitions.

### Migration safety and CI/CD

- Favor additive migrations and compatibility bridges with explicit retirement plans.
- Make platform-hardening checks visible in CI, not just in ad hoc audits.

## Strategic Expansion Sequence

1. Finish ingestion consolidation around the source assertion and canonical federation layers, including 211/NDP and partner-feed connectors.
2. Clarify the public distribution layer so seeker APIs and HSDS APIs read as one coherent resource network surface.
3. Deepen verification and governance automation around submissions, evidence, scopes, and community routing.
4. Expand region by region, and add multilingual, multimodal, or ecosystem integrations only after each supply cohort and the canonical trust controls remain coherent under load.

## Stewardship Standard

Future work in this repository must improve one or more of these outcomes:

- stronger canonical resource data
- more trustworthy verification and governance
- better discovery and navigation over stored records
- better operator participation and stewardship
- more reliable platform delivery

If a change only adds UI surface area or feature count without strengthening those outcomes, it is architectural drift.
