# ORAN integrations

This is the active integration contract for Open Resource Access Network. ORAN
uses dedicated projects, credentials, data, domains, alerts, and operator access.
No environment or account data may be shared with another portfolio business.

## Production stack

| Concern | Provider | ORAN boundary | Status |
| --- | --- | --- | --- |
| Web application | Vercel | Dedicated `oran` project | Provisioned; production candidate required before DNS cutover |
| Database | Supabase PostgreSQL | Dedicated ORAN project and runtime login | Provisioned and connected |
| Identity | Clerk | Dedicated ORAN application and production instance | Active in code; custom domain and Supabase bridge configured |
| Errors and releases | Sentry | Dedicated ORAN project and source-map token | Provisioned |
| Configuration | Doppler | Dedicated ORAN project/config | Provisioned |
| Interactive map | Leaflet + OpenStreetMap | Public tiles with attribution; no shared cloud key | Active target |
| Transactional email | Resend | Dedicated ORAN key and verified sender | Active runtime adapter |
| Optional language tasks | Direct OpenAI/provider-neutral adapter | ORAN-only API project and key | Optional; deterministic safety/retrieval remain authoritative |

## Identity and authorization

Clerk owns sign-in, session lifecycle, account recovery, connected identity
methods, and multi-factor authentication. ORAN owns authorization.

- `src/proxy.ts` uses Clerk middleware for identity and applies the same-origin
  write guard.
- `src/services/auth/session.ts` maps the Clerk user ID to `user_profiles` and
  resolves account status, platform role, and organization membership.
- New users default to `seeker`. No identity-provider claim can grant an ORAN
  administrative role.
- Existing accounts are linked only with an explicit Clerk ID. Email matching
  is never sufficient to migrate or elevate an identity.
- `scripts/provision-owner-access.mjs` requires explicit Clerk IDs and never
  creates or mutates passwords.
- Supabase third-party auth trusts the dedicated issuer at
  `https://clerk.openresourceaccessnetwork.com`.

Required production variables:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_SIGN_IN_URL=/auth/signin`
- `CLERK_SIGN_UP_URL=/auth/signup`

## Database

Application server code connects through the Supabase transaction pooler by
authenticating directly as the dedicated `oran_backend_runtime` login. The
application validates that database identity before creating a production pool;
it never relies on a startup `SET ROLE`, because Supavisor does not preserve
arbitrary startup options. The role can bypass Data API RLS only because this is
a server-only connection with no browser identity; it remains non-superuser,
has no DDL privileges, and receives an explicit operation-by-table allow-list.
Migration and backup jobs use a separate direct connection and must never expose
either credential to the browser.

- `DATABASE_URL`: pooled TLS runtime connection whose database username is
  `oran_backend_runtime.<project-ref>`
- `ORAN_DATABASE_ROLE=oran_backend_runtime`: fixed server identity assertion;
  the application rejects every other production value or database username
- `ORAN_SUPABASE_PROJECT_REF`: non-secret project identity guard; the pooled
  username must resolve to this exact isolated ORAN project
- `SUPABASE_DB_URL`: direct connection for protected migration jobs only
- `NEXT_PUBLIC_SUPABASE_URL` and a publishable key may be used only for tables
  whose RLS policies have received an explicit security review
- Service publication remains fail-closed on provenance, source purpose,
  quarantine state, organization state, and resource integrity holds

## Hosting and releases

Vercel is the sole target for new ORAN releases. A candidate must pass build,
health, Clerk sign-in/sign-up, chat, map, scroll, profile, and authorization
checks before the public domain is moved. Azure deployment assets are rollback
history only and must not receive new ORAN secrets or releases.

## Observability

Sentry receives privacy-filtered application errors, traces, and release source
maps. Never send chat text, search text, form content, auth headers, email,
precise location, or sensitive seeker context.

Required variables:

- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN` (build-time source maps only)

## Maps and location

The seeker map uses Leaflet and OpenStreetMap tiles with visible attribution.
The application does not request precise browser location automatically. City,
ZIP, map movement, or explicit one-time device-location actions may drive a
search; precise coordinates are not saved to the seeker profile.

## Transactional email

Resend is the active provider for best-effort transactional notifications and
workflow updates. The runtime requires both values before it will construct a
client; a partial configuration fails the environment contract.

- `RESEND_API_KEY`: server-only credential from the dedicated ORAN account
- `RESEND_FROM`: verified ORAN sender, optionally including a display name

Email dispatch respects notification preferences and existing application rate
limits. Provider failures are recorded without recipient addresses or message
content in telemetry. No marketing email or SMS is enabled by this adapter.

## AI boundary

AI is optional and may assist with language or operator review, but it cannot
publish a resource, decide eligibility, or replace crisis routing. Seekers only
receive stored, provenance-backed resources. Retailer acceptance data (for
example, stores that accept SNAP) is supporting reference data and cannot be
published as a standalone service resource.

## Shared infrastructure and scheduled work

- `CRON_SECRET` is required in Vercel Production and authenticates Vercel Cron
  through `Authorization: Bearer <CRON_SECRET>`. Use a dedicated random value
  of at least 32 characters and never expose it through a `NEXT_PUBLIC_*`
  variable.
- `INTERNAL_API_KEY` is an optional, separate rollback credential. Approved
  rollback workers send it in `x-oran-internal-key`; legacy Bearer use remains
  temporarily supported during the Azure rollback window.
- `REDIS_URL` is an optional ORAN-dedicated cache accelerator. Production route
  limits use the private atomic Supabase/PostgreSQL limiter as their single
  authority, so an outage cannot reset callers onto an independent counter.
  Database-less local/test runtimes may use Redis or bounded process memory.
- Vercel Cron invokes the following authenticated GET routes once daily in UTC:
  feed polling at 06:00, SLA review at 07:15, coverage-gap review at 08:30,
  confidence-regression review at 09:45, and resource-freshness review at 11:00.
  These schedules are deliberately staggered and stay within the once-daily
  Hobby-plan interval; Hobby execution may occur anywhere within the scheduled
  hour. Production can increase frequency only after plan, runtime, database,
  idempotency, and alerting review.
- Transactional email uses Resend. SMS remains unselected and must not be
  enabled before consent, suppression, and incident controls are approved.

## Retirement inventory

Some source files and archived operational documents still describe earlier
Microsoft/Azure experiments (AI, email, speech, translation, Functions, and
deployment). They are not the active platform contract and must not be enabled
in the Vercel production project. Remove each adapter only after its caller has
an approved replacement or has been safely retired. Historical migrations,
engineering logs, and audits remain immutable evidence and should be labelled
as historical rather than rewritten.

See [STACK_MIGRATION.md](STACK_MIGRATION.md) for cutover gates and retirement
order.
