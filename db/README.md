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
`schema_migrations` baseline before it can apply schema changes. The imported ORAN
production database does not currently have that repository ledger, so the workflow
fails closed rather than replaying historical SQL over live data. Supabase-managed
migrations are tracked separately in Supabase's own migration history. Do not
conflate the two ledgers or create a production baseline without a schema review.

---

## Migrations

ORAN uses plain SQL migrations under `db/migrations/`. They are the canonical schema history.

The current repository contains migrations from `0000_initial_schema.sql` through
`0072_account_erasure_index_gate.sql`.

Production workflow behavior:

- `.github/workflows/db-migrate.yml` installs `psql`, requires a pre-existing
  reviewed `schema_migrations` ledger, and applies each SQL file in lexical order
  exactly once. It never creates or guesses an imported production baseline.
- The workflow is intentionally SQL-first. Drizzle remains available for schema typing and future tooling, but it is not the production migration orchestrator in the current repository state.

Account-erasure index release order:

1. Apply `0071_account_erasure_workflow.sql`. This installs the private durable
   request/step ledgers and revocation controls, but its release gate keeps new
   erasure requests dark.
2. From a controlled operator session, prevalidate that `SUPABASE_DB_URL` is the
   dedicated ORAN Supabase direct or session connection. Do not use the
   transaction pooler and do not print the URL.
3. Run the online, restart-safe build with
   `psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/db/build-account-erasure-indexes.sql`.
   The script fails fast on the wrong schema/read-only target, drops only invalid
   same-name artifacts from an interrupted prior build, and verifies every fixed
   manifest index before returning success. Each build has a five-second lock
   budget and a 30-minute statement budget; monitor database disk, WAL, replica
   lag, and Supabase health throughout this maintenance operation.
4. Apply `0072_account_erasure_index_gate.sql`. It contains no psql meta-commands
   and is safe for the migration API; it refuses to advance migration history
   unless every online index exists on its exact expected schema/table and is
   live, ready, and valid. Success opens the release gate.

Do not deploy the account-erasure worker between steps 1 and 4. If an online
build times out, rerun step 3 before retrying the tracked gate. See
[`RUNBOOK_ACCOUNT_ERASURE.md`](../docs/ops/services/RUNBOOK_ACCOUNT_ERASURE.md)
for rollout, retry, blocked-request, and monitoring procedures.

### Run migrations via psql

The bootstrap example below is for a new, empty local or staging database only. Do
not run it against the imported production database.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
   filename text PRIMARY KEY,
   applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for file in $(find db/migrations -maxdepth 1 -type f -name '*.sql' | sort); do
   filename="$(basename "$file")"
   applied=$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT 1 FROM schema_migrations WHERE filename = '$filename' LIMIT 1;")

   if [ "$applied" = "1" ]; then
      echo "Skipping already applied migration: $filename"
      continue
   fi

   echo "Applying migration: $filename"
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (filename) VALUES ('$filename');"
done
```

### Migration ledger

The `schema_migrations` table is the deployment ledger expected by the current
GitHub Actions migration workflow. Supabase-managed migrations use Supabase's own
separate history.

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
