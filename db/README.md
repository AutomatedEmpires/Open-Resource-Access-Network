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

Visit http://localhost:5050 and log in:
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

ORAN uses **Azure Database for PostgreSQL Flexible Server** in production. See `docs/PLATFORM_AZURE.md` for provisioning details.

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

ORAN uses plain SQL migrations under `db/migrations/`. Apply them sequentially.

| File | Description |
| ---- | ----------- |
| `0000_initial_schema.sql` | Core HSDS tables (organizations, locations, services, service_at_location, phones, addresses, schedules, taxonomy_terms, service_taxonomy, confidence_scores, verification_queue, seeker_feedback, chat_sessions, feature_flags) + PostGIS + UUID extensions |
| `0001_updated_at_triggers.sql` | `set_updated_at()` function + triggers for organizations, locations, services, verification_queue, feature_flags |
| `0002_audit_fields.sql` | Normalizes `created_at`/`updated_at` on all tables, adds `created_by_user_id`/`updated_by_user_id` (Entra Object IDs), renames `submitted_by` → `submitted_by_user_id` |
| `0003_import_staging.sql` | Import pipeline: `import_batches`, `staging_organizations`, `staging_locations`, `staging_services` |
| `0004_audit_logs.sql` | Append-only `audit_logs` table (actor, action, resource, before/after JSONB, ip_digest) |
| `0005_coverage_zones.sql` | `coverage_zones` table with PostGIS polygon geometry, GiST index, assigned_user_id |
| `0006_org_members_and_profiles.sql` | `organization_members` (user↔org mapping with role/status) + `user_profiles` (pseudonymous preferences) |
| `0007_schema_optimizations.sql` | Soft-delete columns on organizations/locations, composite indexes, text search GIN indexes, feature_flags.description |
| `0008_rename_assigned_to.sql` | Renames `verification_queue.assigned_to` → `assigned_to_user_id` for Entra naming consistency |
| `0009_programs_eligibility_documents.sql` | `programs` table (services.program_id FK), `eligibility` (structured criteria with GIN index), `required_documents` |
| `0010_service_areas_languages_accessibility.sql` | `service_areas` (PostGIS polygon), `languages` (ISO 639-1), `accessibility_for_disabilities` |
| `0011_contacts_saved_services_evidence.sql` | `contacts` (HSDS named contacts), `saved_services` (server-side bookmarks), `verification_evidence` (proof docs) |
| `0012_service_attributes.sql` | `service_attributes` — universal tag system across 6 dimensions (delivery, cost, access, culture, population, situation) |
| `0013_comprehensive_coverage.sql` | Household size on eligibility, wait times + capacity on services, transit + parking on locations, `service_adaptations` + `dietary_options` tables |

### Run migrations via psql

```bash
psql $DATABASE_URL -f db/migrations/0000_initial_schema.sql
psql $DATABASE_URL -f db/migrations/0001_updated_at_triggers.sql
psql $DATABASE_URL -f db/migrations/0002_audit_fields.sql
psql $DATABASE_URL -f db/migrations/0003_import_staging.sql
psql $DATABASE_URL -f db/migrations/0004_audit_logs.sql
psql $DATABASE_URL -f db/migrations/0005_coverage_zones.sql
psql $DATABASE_URL -f db/migrations/0006_org_members_and_profiles.sql
psql $DATABASE_URL -f db/migrations/0007_schema_optimizations.sql
psql $DATABASE_URL -f db/migrations/0008_rename_assigned_to.sql
psql $DATABASE_URL -f db/migrations/0009_programs_eligibility_documents.sql
psql $DATABASE_URL -f db/migrations/0010_service_areas_languages_accessibility.sql
psql $DATABASE_URL -f db/migrations/0011_contacts_saved_services_evidence.sql
psql $DATABASE_URL -f db/migrations/0012_service_attributes.sql
psql $DATABASE_URL -f db/migrations/0013_comprehensive_coverage.sql
```

### Drizzle Kit (planned)

If/when Drizzle config is added, migration orchestration can move to Drizzle Kit.

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
