# ORAN owner and integration inventory (no secrets)

This is the repository-safe inventory for Open Resource Access Network. ORAN
must remain operationally isolated from every other portfolio business.

## Isolation rules

- Use only the dedicated ORAN projects in Clerk, Supabase, Vercel, Sentry, and
  Doppler.
- Never copy a key, database URL, user, role, domain, alert destination, or test
  identity from a sibling application.
- Never commit secret values or personal operator details.
- Store runtime secrets in the ORAN Doppler project and the matching ORAN Vercel
  environment scope.
- Keep human ownership, recovery, and rotation notes in the gitignored
  `docs/OWNER_INFO.local.md`.

## Dedicated production assets

| Provider | ORAN asset | Purpose |
| --- | --- | --- |
| Vercel | `oran` project | Next.js hosting and releases |
| Supabase | ORAN project `tpatxospkuqvajusuryw` | PostgreSQL/PostGIS/pgvector |
| Clerk | ORAN application and production instance | Identity and sessions |
| Sentry | `oran` project in `automated-empires` | Privacy-filtered errors and releases |
| Doppler | ORAN project, `prd` config | Secret/configuration source |
| Domain | `openresourceaccessnetwork.com` | Public application and Clerk subdomains |

Provider account organizations may contain multiple businesses, but project
credentials, environments, data, alerts, and access grants must remain scoped to
the ORAN assets above.

## Active configuration names

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`
- `CRON_SECRET`
- `INTERNAL_API_KEY` (optional provider-neutral internal tooling credential)

Values must never be copied into this file.

## Access and recovery

- Elevated ORAN application roles are provisioned from explicit Clerk user IDs
  through reviewed ORAN database changes.
- `scripts/provision-owner-access.mjs` never links identities by email and never
  handles passwords.
- Maintain at least two reviewed ORAN operators for recovery and two-person
  approval, each with an ORAN-only test/production mapping as appropriate.
- Audit provider membership and remove unused access on a regular cadence.

## Retired provider boundary

Earlier Microsoft/Azure resources are historical only. They are not a source of
configuration or recovery for ORAN and must not receive deployments, identities,
secrets, or reactivation work. Azure and Foundry have no rollback path.

See `docs/platform/STACK_MIGRATION.md` and `docs/platform/INTEGRATIONS.md`.
