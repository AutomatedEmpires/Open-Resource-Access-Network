# Runbook: 211 And Governed Source-Feed Ingestion

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Data Platform Lead, ORAN Operations Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-14
- Next review due (UTC): 2026-10-14
- Severity scope: SEV-2 to SEV-4
- Review validation: current code and focused automated tests; no production canary accepted

## Purpose And Product Boundary

This runbook operates the Vercel/Supabase source-feed path that imports actual
human-service providers, programs, services, eligibility, access methods, and
locations. Nationwide coverage is valid; indiscriminate merchant directories
are not.

Do not admit a feed whose primary value is “stores that accept SNAP,” retailers
that accept a benefit, generic business listings, or other places to spend aid.
ORAN finds the resource and the route to help: food banks, benefits enrollment,
housing or utility assistance, health care, veteran services, immigration help,
and comparable service programs. A service catalog may mention accepted payment
or benefits as supporting access information, but that fact alone is not a
publishable ORAN resource.

## Current Architecture

1. Vercel Cron calls `GET /api/internal/ingestion/feed-poll` at 06:00 UTC daily.
2. The route authenticates the cron request, checks fail-closed feature flags
   and runtime configuration, then loads active source systems and feeds.
3. `src/agents/ingestion/service.ts` polls supported `ndp_211` or `hsds_api`
   feeds, records source assertions, normalizes canonical entities, and applies
   the configured publication mode.
4. Feed state, replay cursor, attempt status, audit events, provenance, and
   publication decision reasons are stored in Supabase/PostgreSQL.

`POST /api/internal/ingestion/feed-poll` is for authenticated, provider-neutral
operational tooling. Vercel Cron is the only scheduled production caller.

## Fail-Closed Enablement Gates

All relevant gates must be intentional:

- `SOURCE_FEED_POLLING_ENABLED=true` enables the route; otherwise it returns a
  successful `skipped` response without polling.
- `NDP_211_POLLING_ENABLED=true` is additionally required when any active feed
  uses `ndp_211`; otherwise the route returns 503.
- `NDP_211_SUBSCRIPTION_KEY` and `NDP_211_DATA_OWNERS` are required by the
  runtime contract when NDP 211 polling is enabled.
- the source system and feed must both be active, due, and not in
  `emergencyPause`.
- `SOURCE_FEED_AUTO_PUBLISH_ENABLED=true`, stored approval actor/timestamp, and
  the auto-publication policy are all required for automatic publication.

As of this review, `.env.example` lists the NDP variables but does not list
`SOURCE_FEED_POLLING_ENABLED` or `SOURCE_FEED_AUTO_PUBLISH_ENABLED`. Treat that
configuration-inventory gap as part of the production enablement checklist; do
not infer either flag from other settings.

## Publication Modes

| Mode | Implemented behavior |
| --- | --- |
| `canonical_only` | Normalize canonical records; do not publish or queue them for review. |
| `review_required` | Mark normalized canonical entities `pending_review`; publish none automatically. This is the default. |
| `auto_publish` | Attempt policy-gated publication; fall back to `review_required` if the environment gate, approval, required 211 locations, trust, or confidence policy is not satisfied. |

Moving a feed to auto-publish or approving it is a high-risk control change and
is queued for second ORAN-admin approval by the source-feed API. Never bypass
that workflow with direct SQL or the bootstrap script.

## Source Admission Checklist

Before creating or activating a feed, record and have a second operator review:

1. publisher identity, homepage, terms, licensing, and contact path
2. service-catalog purpose and explicit exclusion of merchant-only records
3. jurisdiction, included/excluded data owners, and maximum organizations per poll
4. required HSDS/211 fields, usable access channels, and locations where needed
5. provenance and update/delete semantics, including stable source identifiers
6. sample comparison against the authoritative publisher response
7. initial `publicationMode=review_required` and `emergencyPause=false`

`scripts/bootstrap-source-feed.mjs` is an initial provisioning tool, not the
ongoing production change-control surface. It defaults to `service_catalog`,
`review_required`, and a national US jurisdiction; operators must narrow data
owners and scope to the approved agreement rather than accepting defaults blindly.

## Canary Procedure

Do this in an isolated staging/preview environment before production:

1. Provision one approved feed in `review_required` mode with a small
   `maxOrganizationsPerPoll` and explicit data-owner allowlist.
2. Configure the required secrets and gates in the approved secret manager and
   Vercel environment. Keep auto-publish disabled.
3. Trigger one authenticated poll:

   ```bash
   curl -X POST "https://<staging-host>/api/internal/ingestion/feed-poll" \
     -H "x-oran-internal-key: <staging-internal-key>"
   ```

4. Generate and retain both reports:

   ```bash
   npm run report:211-feed-status -- --feed-id <feed-uuid> --hours 72 --format markdown --out <feed-status-report.md>
   npm run report:211-canary -- --feed-id <feed-uuid> --hours 24 --sample-size 10 --format markdown --out <canary-report.md>
   ```

5. Reconcile the sample to the publisher response. Verify organizations,
   services, locations, eligibility, contacts, taxonomy, provenance, deletions,
   duplicates, and that no merchant-only entries entered the catalog.
6. Confirm attempt state, cursor behavior, errors, normalization counts,
   `reviewQueued`, `published=0`, and decision reasons.
7. Record named data-owner approval and operator sign-off. Repeat on a second
   cycle to prove checkpoint/idempotency behavior.

## Production Rollout Gate

Production polling may be enabled only after the canary passes and the rights,
data-owner scope, Vercel configuration, observability, pause procedure, and
reviewer capacity are accepted. Auto-publish additionally requires the
two-person control change and a separately approved canary that proves every
publication policy outcome.

**Current status:** no accepted production canary or human reconciliation is
recorded in this repository. This blocks enabling 211 production polling or
auto-publish; it does not block seeker launch while source-feed polling remains
off and only reviewed resources are visible.

## Detection And Diagnosis

Use Sentry/Vercel request evidence and the persisted feed-state reports. Relevant
signals include 401/503/500 responses, `lastAttemptStatus=failed`, overdue polls,
pending replay cursor, normalization errors, unexpected decision reasons,
unexpected `published` counts, or data-owner volume outside the approved scope.

```bash
npm run report:211-feed-status -- --hours 72 --format markdown --out <feed-status-report.md>
```

For a content-integrity or provenance incident, follow
`RUNBOOK_DATA_QUALITY_INCIDENT.md` immediately.

## Containment And Recovery

1. For one feed, use the authenticated ORAN-admin source-feed control to set
   `state.emergencyPause=true`. For a platform-wide stop, set
   `SOURCE_FEED_POLLING_ENABLED=false` in the active Vercel environment and
   redeploy/promote the configuration safely.
2. Do not delete source records, canonical records, audit events, or checkpoints
   while investigating.
3. Keep affected entities out of publication; use `canonical_only` when
   normalization evidence is still needed without review/publication movement.
4. Correct credentials, data-owner scope, normalizer, or connector code. Test in
   staging and use `replayFromCursor` only with a documented recovery point.
5. Run one bounded poll, regenerate both reports, and reconcile affected records.
6. Remove emergency pause only after the Ingestion Operations Lead and Data
   Platform Lead accept the evidence.

## Validation Commands

```bash
npx vitest run src/agents/ingestion/__tests__/ndp211Connector.test.ts src/agents/ingestion/__tests__/ndp211Normalizer.test.ts src/agents/ingestion/__tests__/service.test.ts src/agents/ingestion/__tests__/autoPublish.test.ts src/app/api/internal/ingestion/feed-poll/__tests__/route.test.ts src/__tests__/scripts/run-211-canary-report.test.ts src/__tests__/scripts/run-211-feed-status-report.test.ts
npm run typecheck
```

Automated tests validate code contracts, not production rights, provider access,
data-owner consent, live credentials, or human content reconciliation.

## References

- `vercel.json`
- `src/app/api/internal/ingestion/feed-poll/route.ts`
- `src/app/api/admin/ingestion/source-feeds/[id]/route.ts`
- `src/agents/ingestion/service.ts`
- `src/agents/ingestion/ndp211Connector.ts`
- `src/agents/ingestion/ndp211Normalizer.ts`
- `src/services/ingestion/controlChanges.ts`
- `scripts/bootstrap-source-feed.mjs`
- `scripts/run-211-canary-report.mjs`
- `scripts/run-211-feed-status-report.mjs`
- `docs/ops/services/RUNBOOK_DATA_QUALITY_INCIDENT.md`
- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
