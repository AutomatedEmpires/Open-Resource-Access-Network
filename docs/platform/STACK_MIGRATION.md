# ORAN production platform and legacy boundary

## Decision

ORAN's production platform is:

- **Vercel** for the Next.js web application, previews, production releases, server route handlers, and authenticated cron requests
- **Supabase** for PostgreSQL/PostGIS/pgvector, backups, and project-bound runtime and migration connections
- **Clerk** for user identity, sessions, organizations, and account lifecycle
- **Sentry** for privacy-filtered client, server, and edge errors, traces, and release diagnostics

Resend, Redis, and provider-neutral mapping are optional adapter-backed capabilities. Their presence in the repository does not prove that a provider is activated or production-verified.

Azure and Foundry are retired and prohibited. Their runtime adapters, Functions application, infrastructure templates, deployment workflows, and operational scripts have been removed. ORAN has no Microsoft-provider rollback or reactivation path; stale Microsoft settings and endpoints fail the runtime contract closed.

ORAN's data model is capable of supporting multiple regions, but that is not a claim of nationwide coverage. The current regional MVP supply is the reviewed Washington HRSA cohort. Additional regions must pass the same provenance, verification, publication, and freshness controls before they become trusted seeker-visible supply.

## Current production state

| Concern | Production truth | Operational boundary |
| --- | --- | --- |
| Web hosting | Vercel project `oran`, Node 24, Next.js App Router | Merging reviewed `main` deploys production; prove the deployed source SHA, health, and live user paths for every release |
| Database | Supabase PostgreSQL 17 with PostGIS/pgvector in project `tpatxospkuqvajusuryw` | Server-only SQL uses the validated Supavisor connection and dedicated `oran_backend_runtime` role; a cross-project DSN fails closed |
| Browser data access | Supabase Data API is denied by default | Do not add browser policies or publishable data access until each exposed table has a reviewed RLS contract |
| Identity | Dedicated Clerk production instance with explicit Clerk-to-ORAN identity mapping | Clerk establishes identity; database-owned roles and memberships establish authorization; never infer account linkage by email |
| Observability | Sentry instrumentation is present for client, server, and edge runtimes | Configuration requires a privacy review plus live event, source-map, release, and alert-ownership proof |
| Maps | Leaflet/OpenStreetMap-compatible surface with Nominatim geocoding | Select tiles/geocoding only after privacy, availability, usage, and endpoint-policy review |
| Scheduled work | Six authenticated Vercel Cron routes are declared in `vercel.json` | `CRON_SECRET` is mandatory; each route needs production invocation and alert evidence |
| Transactional email | Resend adapter and environment contract are present | Treat delivery as dormant until the ORAN sender domain, suppression handling, and production delivery are proved |
| AI-assisted language tasks | Deterministic launch behavior; Anthropic is the only bundled optional provider | Optional AI is limited to review-gated ingestion assistance; crisis routing, seeker chat, retrieval, ranking, eligibility, and publication never depend on an external model |
| Retired Microsoft providers | Runtime and developer execution assets removed | Azure/Foundry settings and Microsoft-shaped runtime endpoints are prohibited and fail readiness closed |

## Regional data boundary

The current production release cohort contains 445 published Washington HRSA service records backed by 4,981 accepted provenance facts. Thirty excluded or inactive records remain quarantined for administrator review and are not seeker-visible. These counts describe the governed regional cohort, not nationwide service availability.

All additional source material follows one path:

1. ingest into source assertions with provenance;
2. normalize and deduplicate into a candidate revision;
3. complete the required review and approval workflow;
4. publish the approved revision to canonical records; and
5. monitor freshness, regressions, corrections, and withdrawal signals.

Unreviewed, quarantined, stale, or inferred data must not appear as verified seeker-facing fact.

## Release sequence

1. **Review the exact change.** Confirm the canonical branch and lease, required checks, approval, and migration impact before merging.
2. **Validate the runtime contract.** Run the off-Azure guard plus typecheck, lint, tests, migration verification, and build appropriate to the change.
3. **Apply controlled schema work.** Use the project-bound Supabase migration path. Preserve the repository migration ledger and never replay historical files over an imported schema.
4. **Deploy from reviewed `main`.** Capture the exact merged SHA and the exact Vercel deployment that contains it.
5. **Run live acceptance.** Verify `/api/health`, public discovery, crisis routing, authorization boundaries, and the changed end-to-end workflow without exposing secrets or sensitive seeker data.
6. **Close with provider evidence.** Verify Sentry, cron, email, or other provider behavior only when the release actually depends on it; code or environment-variable presence alone is not activation evidence.

## Retired Microsoft-provider boundary

- Azure/Foundry runtime adapters, deployment workflows, Functions, infrastructure templates, and operational scripts are absent from the active repository.
- Startup, environment validation, health readiness, and static CI checks reject retired provider settings, endpoints, imports, and registrations.
- Provider-independent, synchronous crisis signals run before usage controls. Distress text is not sent to an external content-safety provider.
- The production chat route has no LLM summarizer, translator, or LLM intent enricher. Optional Anthropic use is isolated to review-gated ingestion assistance.
- Historical migrations, engineering logs, and audit records may retain provider names as immutable evidence; they are not executable configuration or a reactivation path.

## Environment contract

Vercel runtime:

- `DATABASE_URL`: Supabase transaction-pooler URL for the dedicated `oran_backend_runtime.<project-ref>` login, with TLS required
- `ORAN_DATABASE_ROLE=oran_backend_runtime`: fixed database identity assertion; missing, unknown, or mismatched URL usernames fail closed
- `ORAN_SUPABASE_PROJECT_REF=tpatxospkuqvajusuryw`: non-secret isolation guard; a pooled URL for any other Supabase project fails closed
- `DATABASE_POOL_MAX=2`: conservative per-instance connection cap
- `CRON_SECRET`: dedicated random value of at least 32 characters used for registered cron requests
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and server-only `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`, plus `SENTRY_ORG`, `SENTRY_PROJECT`, and server-only `SENTRY_AUTH_TOKEN` when release/source-map upload is enabled
- `RESEND_API_KEY` and `RESEND_FROM` only as a complete server-only pair when transactional email is explicitly activated
- `NEXT_PUBLIC_SUPABASE_URL` and a publishable key only when an RLS-reviewed Data API client is introduced

GitHub Environment:

- `SUPABASE_DB_URL`: direct database connection used only by the migration workflow
- `SUPABASE_PROJECT_REF`: selected-environment project identity checked before the migration secret is exported or used

## Non-negotiable safety gates

- Crisis routing never depends on an external model or provider.
- Seekers only receive stored, provenance-backed service records.
- Architectural scale does not justify a claim of coverage in a region whose supply has not been reviewed and published.
- Supporting references such as "stores that accept SNAP" cannot publish as service resources.
- Protected routes and privileged writes fail closed, with authorization enforced server-side.
- Search text, chat content, precise location, form content, cookies, and authorization headers do not enter telemetry.
- No production domain, database mutation, or provider activation occurs from an unreviewed preview.
