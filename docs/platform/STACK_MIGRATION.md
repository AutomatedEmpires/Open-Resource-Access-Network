# ORAN platform target and migration

## Decision

ORAN is moving off Microsoft/Azure services. The active target is:

- **Vercel** for the Next.js web application, previews, production releases, and short-running server functions
- **Supabase** for PostgreSQL/PostGIS/pgvector, backups, and later Storage/Realtime capabilities where they serve a verified product need
- **Clerk** for user identity, sessions, organizations, and account lifecycle
- **Sentry** for privacy-filtered errors, traces, and release diagnostics
- **Resend** for ORAN transactional email delivery
- **Direct OpenAI or provider-neutral AI adapters** for optional language tasks; deterministic crisis routing and verified retrieval remain available without an LLM

This platform serves the product vision: a nationwide, chat-first navigator that helps a person find and act on verified government and community services. It is not a directory of retailers that accept one benefit.

## Current migration state

| Concern | Active target | Repository state | Cutover gate |
| --- | --- | --- | --- |
| Web hosting | Vercel | Existing `oran` project linked; Node 24 contract; Azure deployment jobs are hard-disabled | Configure runtime env, pass readiness and smoke tests, then promote |
| Database | Supabase Postgres | Existing `oran` project in `us-east-1`; PostGIS/pgvector active; Vercel-sized pools; source-purpose migration applied | Configure a pooled runtime connection, verify query plans and readiness from Vercel |
| Identity | Clerk | Dedicated production instance, custom issuer, Supabase bridge, middleware, UI, and explicit identity mapping are active | Verify sign-in/sign-up/RBAC on the production candidate; retain no legacy provider secrets |
| Observability | Sentry | Next.js client/server/edge instrumentation is active when DSN is set | Configure project, DSN, source-map token, and alert ownership |
| Maps | Open/provider-neutral | Leaflet/OpenStreetMap is active; Azure token brokerage is retired and its server geocoder is runtime-blocked | Select a production geocoder with privacy and usage review |
| Jobs/queues | Vercel Cron/Supabase | ORAN jobs run through authenticated Vercel routes; Azure Functions packaging and deployment are hard-disabled | Configure `CRON_SECRET`, verify each production invocation and alert path |
| Transactional email | Resend | Provider adapter and ORAN-only environment contract active | Verify the sender domain and delivery on the production candidate |
| SMS | To be selected | No active runtime adapter | Complete consent, suppression, and incident review before adoption |

## Cutover sequence

1. **Stop Azure drift.** Azure deploy, infrastructure, Functions, and token-rotation jobs are hard-disabled. Do not attach `openresourceaccessnetwork.com` to Azure.
2. **Establish previews.** Import the GitHub repository into Vercel. Configure Preview variables and verify `/`, `/api/health`, chat intake, security headers, and error reporting on the generated Vercel URL.
3. **Move PostgreSQL.** Restore into a Supabase staging project using the direct connection. Apply `db/migrations` with the `Database Migration (Supabase)` workflow. Use the Supavisor transaction-pooler URL as Vercel `DATABASE_URL`.
4. **Close the Data API by default.** Existing tables were designed for server-side SQL. Do not expose them through Supabase's Data API until every exposed table has reviewed RLS policies. Never place a secret/service-role key in `NEXT_PUBLIC_*` variables.
5. **Verify the completed identity cutover.** Clerk middleware/provider/UI, explicit `user_profiles.clerk_user_id` mapping, database-owned roles, and Supabase native third-party auth move together. Do not use the deprecated Clerk JWT-template integration and never link accounts by email inference.
6. **Move remaining services.** Microsoft-backed optional features remain runtime-blocked until explicit non-Microsoft adapters pass provider-specific tests. Resend is the transactional email target.
7. **Promote production.** Validate data parity, auth/RBAC, crisis flows, published-resource provenance, Sentry, rollback, and backups. Only then attach `openresourceaccessnetwork.com` to Vercel and remove the stale Azure DNS target.
8. **Retire Azure.** After the rollback window and backup verification, revoke Azure deployment credentials and delete resources through an approved decommission change.

## Live baseline (2026-07-14)

- `openresourceaccessnetwork.com` is attached to Vercel. `/`, `/chat`, `/map`, `/onboarding`, and `/api/health` return 200 on the current production release; `/profile` redirects signed-out visitors to Clerk as expected. The production health check reaches PostgreSQL successfully.
- The live database is intentionally still at migration `0068_shared_rate_limit_windows.sql`. Candidate migrations `0069` through `0072` must pass the complete release gates and be applied in lexical order before the application candidate is deployed. In particular, the application must never deploy its account-erasure session guard before `0071` exists.
- No Azure or Foundry runtime variables are configured in Vercel. The repository also rejects Microsoft credentials/endpoints in production so a stale variable cannot silently reactivate a retired adapter.
- Supabase project `oran` (`tpatxospkuqvajusuryw`) is active in `us-east-1` on PostgreSQL 17. It contains approximately 1.6 million service, organization, and location records.
- PostGIS 3.3.7 and pgvector 0.8.2 are installed. The `source_resource_purpose` migration is applied and the `source_systems.resource_purpose` column is present with its fail-safe default and constraint.
- The imported database does not yet have the repository's `schema_migrations` baseline. The GitHub migration workflow is therefore gated by `SUPABASE_MIGRATIONS_ENABLED=true` and fails closed when that baseline is absent; never replay all historical files over the imported schema.
- The Supabase security advisor reports one error: RLS is disabled on PostGIS table `public.spatial_ref_sys`. It also reports 21 warnings, including mutable function search paths, PostGIS/pgvector in `public`, and executable PostGIS `SECURITY DEFINER` functions. These require a reviewed PostGIS/RLS migration; they were not auto-remediated. See the [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Ninety-six application tables have RLS enabled with no Data API policies. That is a deliberate browser/Data API deny posture. The direct ORAN server pool authenticates as a separately reviewed backend login with an explicit ACL manifest; add user-scoped policies table-by-table only when a Clerk-authenticated browser or Supabase client is introduced.
- Replacement Clerk and Sentry credentials still require rotation and final production verification; do not treat the current secret set as the release-complete state.

## Environment contract

Vercel runtime:

- `DATABASE_URL`: Supabase transaction-pooler URL for the dedicated
  `oran_backend_runtime.<project-ref>` login, TLS required
- `ORAN_DATABASE_ROLE=oran_backend_runtime`: fixed database identity assertion;
  missing, unknown, or mismatched URL usernames fail closed
- `ORAN_SUPABASE_PROJECT_REF=tpatxospkuqvajusuryw`: non-secret isolation guard;
  a pooled URL for any other Supabase project fails closed
- `DATABASE_POOL_MAX=2`: conservative per-instance connection cap
- `CRON_SECRET`: dedicated random value of at least 32 characters; Vercel sends
  it as the Bearer credential for registered cron GET requests
- `NEXT_PUBLIC_SENTRY_DSN`, plus `SENTRY_ORG`, `SENTRY_PROJECT`, and secret `SENTRY_AUTH_TOKEN`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
- `RESEND_API_KEY` and `RESEND_FROM` as a complete server-only pair when transactional email is enabled
- `NEXT_PUBLIC_SUPABASE_URL` and a publishable key only when an RLS-reviewed Data API client is introduced

GitHub Environment:

- `SUPABASE_DB_URL`: direct database connection used only by the migration workflow
- `SUPABASE_PROJECT_REF=tpatxospkuqvajusuryw`: non-secret migration identity guard;
  direct and pooled DSNs for any other portfolio project fail before `psql` runs

## Non-negotiable safety gates

- Crisis routing never depends on an external model.
- Seekers only receive stored, provenance-backed service records.
- Supporting references such as “stores that accept SNAP” cannot publish as service resources.
- Protected routes and privileged writes fail closed.
- Search text, chat content, precise location, form content, cookies, and auth headers do not enter telemetry.
- No production domain or database promotion occurs from an unreviewed preview.
