# Runbook: durable account erasure

## Metadata

- Owner role: Identity and Access Lead
- Reviewers: Data Platform Lead, Platform On-Call Lead
- Operational status: release-gated
- Last reviewed (UTC): 2026-07-19
- Next review due (UTC): 2026-10-19
- Severity scope: SEV-1 to SEV-3

## Safety constraints

- Use only ORAN's dedicated Clerk and Supabase projects. Never use portfolio-wide
  or another venture's provider connector.
- Queue commit is the access-revocation point. Do not restore a frozen profile or
  remove an identity block to make a retry appear successful.
- Never edit the private request/step tables to declare completion. Completion is
  valid only after Clerk deletion and all fixed steps pass verification.
- Never expose request identities, tombstones, database URLs, or Clerk secrets in
  logs, tickets, command output, or public audit details.
- Migration `0071` must precede the online index build; migration `0072` must
  follow it. The worker must not deploy in the gap.

## Controlled release

1. Confirm the target is the dedicated ORAN Supabase direct or session endpoint,
   not the transaction pooler, and confirm current database health, disk/WAL
   headroom, replica lag, and backups.
2. Apply `db/migrations/0071_account_erasure_workflow.sql` through the reviewed
   production migration procedure. The release gate remains closed.
3. Run the restart-safe online build without printing the connection URL:

   ```bash
   psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 \
     -f scripts/db/build-account-erasure-indexes.sql
   ```

4. If a statement hits the five-second lock timeout or 30-minute statement
   timeout, inspect database pressure, resolve the conflict, and rerun the same
   script. It removes only invalid same-name artifacts on their exact expected
   table and reuses valid completed indexes.
5. Apply `db/migrations/0072_account_erasure_index_gate.sql`. A 55000 failure is
   a safe stop: do not bypass it or manually update the gate.
6. Deploy the application/cron code only after the gate migration succeeds.
7. Smoke an authorized test account: require 200 or 202 with
   `accessRevoked=true`; verify subsequent auth is denied and the worker drains
   the request. Do not use a founder or operator identity.

## Normal monitoring

- Vercel invokes `/api/internal/account-erasure` once per day under the current
  plan contract. It claims at most four requests, advances at most 160
  individually bounded pages per request, and respects a 20-second shared
  deadline. The page ceiling lets an empty/light 72-step two-pass request finish
  in one delivery; real volume stops at the deadline and resumes on the next
  claim.
- Alert on repeated 500s, a growing retry-due backlog, expired leases, requests
  near maximum attempts, any `blocked` request, or a 503 from the self-service
  route after release.
- Treat 202 as normal while `nextStep` is `identity_provider_deletion` or
  `secure_data_erasure`. `operator_review` is not normal completion.

## Diagnosis and recovery

1. Confirm the gate is open and all 128 expected indexes are on the exact target
   schema/table and are `indisvalid`, `indisready`, and `indislive`.
2. For provider retries, verify the configured Clerk instance belongs to ORAN.
   A provider 404 is idempotent success; authentication, quota, or outage errors
   must retain the request for backoff.
3. For expired leases, let the next cron claim them. Do not create a second
   manual worker while a live lease exists.
4. For database-page failures, inspect the stable error code, query/lock health,
   and the current fixed step. Repair the underlying dependency; do not advance
   its cursor manually.
5. For `writer_reintroduction_detected`, identify and stop the writer, confirm it
   cannot bypass the erased-identity trigger, and obtain a reviewed data-platform
   procedure before retrying the blocked request.
6. If auth lookup fails, keep access denied. Do not fall back to a synthetic
   active seeker profile while erased-identity status is unknown.

## Rollback

- Before any request has been accepted, application code may be rolled back while
  leaving migrations and indexes in place.
- After a request has been accepted, keep a compatible worker running until all
  accepted requests complete or are explicitly handed to incident response.
  Rolling back only the worker would strand revoked identities.
- Do not drop erasure tables, identity blocks, triggers, functions, or indexes as
  an application rollback. Schema rollback requires a separate reviewed data
  migration and proof that no durable requests or revocation obligations remain.

## Focused validation

```bash
npx vitest run \
  src/services/privacy/__tests__/accountErasure.test.ts \
  src/app/api/user/data-delete/__tests__/route.test.ts \
  src/app/api/internal/account-erasure/__tests__/route.test.ts \
  src/services/auth/__tests__/session.test.ts \
  src/services/db/__tests__/account-erasure-migration.test.ts
bash scripts/db/disposable-postgres.sh
```
