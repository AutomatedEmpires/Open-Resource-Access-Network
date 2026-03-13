# ORAN Database Setup

## Prerequisites

- Docker and Docker Compose (for local development)
- OR an Azure Database for PostgreSQL Flexible Server instance (production / staging)

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
DATABASE_URL=postgresql://oran:oran_local_password@localhost:5432/oran_db?sslmode=disable
```

Add to your `.env.local` file:

```bash
echo 'DATABASE_URL=postgresql://oran:oran_local_password@localhost:5432/oran_db?sslmode=disable' >> ../.env.local
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

## Azure Database for PostgreSQL (Production / Staging)

ORAN uses **Azure Database for PostgreSQL Flexible Server** in production. See `docs/platform/PLATFORM_AZURE.md` for provisioning details.

1. Provision a Flexible Server instance with PostGIS enabled:

   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```

2. Copy the connection string from the Azure Portal
3. Add to your environment:

   ```
   DATABASE_URL=postgresql://user:password@your-server.postgres.database.azure.com/oran_db?sslmode=require
   ```

---

## Migrations

ORAN uses plain SQL migrations under `db/migrations/`. They are the canonical schema history.

The current repository contains migrations from `0000_initial_schema.sql` through `0041_org_profile_extensions.sql`.

Production workflow behavior:

- `.github/workflows/db-migrate.yml` installs `psql`, creates a lightweight `schema_migrations` ledger table if needed, and applies each SQL file in lexical order exactly once.
- The workflow is intentionally SQL-first. Drizzle remains available for schema typing and future tooling, but it is not the production migration orchestrator in the current repository state.

### Run migrations via psql

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

The `schema_migrations` table is the deployment ledger used by the current GitHub Actions migration workflow.

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
