# ORAN Database Setup

## Prerequisites

- Docker and Docker Compose (for local development)
- A dedicated Supabase project for production or staging
- A direct PostgreSQL connection for migrations and a Supavisor transaction-pooler
  connection for the Vercel runtime

---

## Local Development with Docker

### Start the database

```bash
cd db
docker compose up -d
```

This starts:

- **PostgreSQL 16 with PostGIS 3.4** on port `5432`
- **pgAdmin 4** on port `5050` (optional, for visual DB management)

### Connection string (local)

```
DATABASE_URL=postgresql://oran:pw@localhost:5432/oran_db?sslmode=disable
```

Add to your `.env.local` file:

```bash
echo 'DATABASE_URL=postgresql://oran:pw@localhost:5432/oran_db?sslmode=disable' >> ../.env.local
```

### pgAdmin (optional)

Visit <http://localhost:5050> and log in:

- Email: `admin@oran.local`
- Password: `pgadmin_local_password`

Then add a server with:

- Host: `db` (Docker network) or `localhost` (from host machine)
- Port: `5432`
- Database: `oran_db`
- Username: `oran`
- Password: `oran_local_password`

---

## Supabase PostgreSQL (Production / Staging)

ORAN uses a dedicated **Supabase PostgreSQL** project. Keep the project, credentials,
backups, and billing isolated from every other business in the portfolio. The active
stack and cutover contract are documented in
[`docs/platform/STACK_MIGRATION.md`](../docs/platform/STACK_MIGRATION.md); database
incidents use
[`docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`](../docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md).

1. Create a dedicated Supabase project and enable the extensions required by the
   checked-in migrations, including PostGIS and pgvector.
2. Store the direct database URL as the migration-only `SUPABASE_DB_URL` secret.
3. Store the Supavisor transaction-pooler URL as the server-only Vercel
   `DATABASE_URL` secret. Never expose database credentials through `NEXT_PUBLIC_*`.
4. Keep Supabase's Data API deny-by-default. The application accesses PostgreSQL
   through the reviewed `oran_backend_runtime` capability role; do not add browser policies
   or service-role keys without a separate RLS review.

The repository's Supabase migration workflow requires an existing, reviewed
`public.schema_migrations` baseline before it can apply schema changes. An
imported ORAN database without that ledger must fail closed rather than replaying
historical SQL over populated data. Establish the baseline only after the target
has been compared semantically with a rehearsal database through
`0068_shared_rate_limit_windows.sql`. Supabase-managed migrations are tracked in
Supabase's separate provider history; never copy those entries into ORAN's
filename-keyed ledger or remove them during reconciliation.

---

## Migrations

ORAN uses plain SQL migrations under `db/migrations/`. They are the canonical schema history.

The current release contains exactly 74 migration files, from
`0000_initial_schema.sql` through `0075_data_api_acl_lockdown.sql`.

Production workflow behavior:

- `.github/workflows/db-migrate.yml` installs `psql`, requires a pre-existing
  reviewed `schema_migrations` ledger, and applies each SQL file in lexical order
  exactly once. It never creates or guesses an imported production baseline.
- The generic workflow refuses to run while either account-erasure migration is
  absent from the ledger. Operators must complete the controlled `0071` → online
  index build → `0072` sequence first; the generic runner cannot pause safely for
  that phase.
- The workflow is intentionally SQL-first. Drizzle remains available for schema typing and future tooling, but it is not the production migration orchestrator in the current repository state.

Account-erasure index release order:

1. Apply `0071_account_erasure_workflow.sql`. This installs the private durable
   request/step ledgers and revocation controls, but its release gate keeps new
   erasure requests dark. Insert its `schema_migrations` row only after the SQL
   completes successfully.
2. From a controlled operator session, prevalidate that `SUPABASE_DB_URL` is the
   dedicated ORAN Supabase direct or session connection. Do not use the
   transaction pooler and do not print the URL.
3. Run the online, restart-safe build with
   `psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/db/build-account-erasure-indexes.sql`.
   The script fails fast on the wrong schema/read-only target, drops only invalid
   same-name artifacts from an interrupted prior build, and verifies every fixed
   manifest index before returning success. Each build has a five-second lock
   budget and a 30-minute statement budget; monitor database disk, WAL, replica
   lag, and Supabase health throughout this maintenance operation. This is an
   untracked operator phase: do not invent a migration filename or ledger row for
   the 128 indexes.
4. Apply `0072_account_erasure_index_gate.sql`. It contains no psql meta-commands
   and is safe for the migration API; it refuses to advance migration history
   unless every online index exists on its exact expected schema/table and is
   live, ready, and valid. Insert its ledger row only after that gate succeeds.
   A `55000` failure is a safe stop and must leave `0072` unrecorded.

Do not deploy the account-erasure worker between steps 1 and 4. If an online
build times out, rerun step 3 before retrying the tracked gate. See
[`RUNBOOK_ACCOUNT_ERASURE.md`](../docs/ops/services/RUNBOOK_ACCOUNT_ERASURE.md)
for rollout, retry, blocked-request, and monitoring procedures.

Post-gate release order:

1. Apply and then record `0073_canonical_entity_identifiers.sql`, which admits
   the canonical source identifiers used by the regional ingestion path.
2. Apply and then record `0074_isolate_data_api_schema.sql`, which creates the
   empty, deny-by-default `oran_api` schema.
3. Apply and then record `0075_data_api_acl_lockdown.sql`, which removes inherited
   browser-role access to `public` and enables RLS as defense in depth on ORAN
   application tables.
4. Configure Supabase PostgREST to expose only `oran_api`, then prove that a
   publishable/anon request cannot resolve either `public.services` or
   `public.spatial_ref_sys`. SQL migration `0074` does not change this provider
   setting by itself.

### Rehearse on a Supabase branch

Use an isolated branch created from the production project. The rehearsal helper
retrieves branch credentials without printing them, validates the branch project
identity, refuses a populated target without a repository ledger, handles the
concurrent `0070` and `0071`/128-index/`0072` phases, and records each SQL file
only after it succeeds.

To stop at the known imported-schema comparison boundary, run:

```bash
MIGRATION_FINAL=0068_shared_rate_limit_windows.sql \
REAPPLY_DATA_API_LOCKDOWN=true \
scripts/db/rehearse-supabase-branch.sh \
  <branch-name> <production-project-ref> <branch-project-ref>
```

Compare the branch and production catalogs at that boundary before baselining a
populated target. Differences in relations, columns, constraints, indexes,
triggers, functions, role attributes, or grants must be understood rather than
papered over with ledger rows.

Then run the complete release rehearsal:

```bash
scripts/db/rehearse-supabase-branch.sh \
  <branch-name> <production-project-ref> <branch-project-ref>

VERIFY_DATA_API_ISOLATION=true \
scripts/db/configure-supabase-data-api.sh <branch-project-ref> oran_api
```

The rehearsal must finish with `74|0075_data_api_acl_lockdown.sql`, all 128
account-erasure indexes live/ready/valid, the release gate open, and Data API
isolation verified. A partial ledger is not acceptance evidence.

### Verify a greenfield database

The disposable verifier replays the full migration chain on a local
Supabase-shaped PostgreSQL 17 database and proves the backend capability model.
It never connects to a remote host and handles the account-erasure online phase
without creating a production ledger.

```bash
bash scripts/db/disposable-postgres.sh
```

### Migration ledger

The `public.schema_migrations` table is the deployment ledger expected by the
current GitHub Actions migration workflow. For this release its exact repository
state is 74 rows with `0075_data_api_acl_lockdown.sql` as the maximum filename.
Supabase-managed migrations use Supabase's own separate history.

### Drizzle status

Drizzle is used in the repository for schema typing and related data access patterns, but the migration source of truth remains the SQL files under `db/migrations/**`.

---

## Seeding Demo Data

⚠️ **Demo data is CLEARLY LABELED as fictional and must never be used in production.**

```bash
psql $DATABASE_URL -f db/seed/demo.sql
```

This inserts fictional organizations, services, coverage zones, organization members, user profiles, programs, eligibility criteria, required documents, service areas, languages, accessibility features, contacts, saved services, service attributes (delivery modes, cost types, access requirements, cultural competency, population focus, situational context), service adaptations (disability, health condition, age group, learning), and dietary options (halal, kosher, vegan, etc.) in "Demoville, DM 00000" for development/testing purposes only.

---

## Stopping the Database

```bash
cd db
docker compose down
```

To also remove data volumes:

```bash
docker compose down -v
```
