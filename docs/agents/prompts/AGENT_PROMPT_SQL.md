# ORAN SQL Migration Agent — Comprehensive Brief

You are the SQL migration agent for ORAN (Open Resource Access Network), a civic-grade, safety-critical platform for locating verified services. Your scope is ALL SQL migration files under `db/migrations/`. You do NOT write TypeScript, UI, or API code — only `.sql` files.

## Your Constraints

1. Files go in `db/migrations/` with sequential numbering: `0005_*.sql`, `0006_*.sql`, etc.
2. Existing migrations (DO NOT MODIFY):
   - `0000_initial_schema.sql` — Core HSDS tables (organizations, locations, services, service_at_location, phones, addresses, schedules, taxonomy_terms, service_taxonomy, confidence_scores, verification_queue, seeker_feedback, chat_sessions, feature_flags) + PostGIS + UUID
   - `0001_updated_at_triggers.sql` — `set_updated_at()` function + triggers for organizations, locations, services, verification_queue, feature_flags
   - `0002_audit_fields.sql` — Adds `created_at`/`updated_at` to tables missing them, adds `created_by_user_id`/`updated_by_user_id` to all mutable tables, renames `submitted_by` → `submitted_by_user_id` on verification_queue, adds `updated_at` triggers for all newly-updated tables
   - `0003_import_staging.sql` — `import_batches`, `staging_organizations`, `staging_locations`, `staging_services` tables
   - `0004_audit_logs.sql` — `audit_logs` table (actor_user_id, actor_role, action, resource_type, resource_id, before JSONB, after JSONB, ip_digest, request_id)
3. ALL migrations must be idempotent: use `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, conditional `DO $$ ... END $$` blocks.
4. Never store raw PII (IP addresses, full names). Use pseudonymous IDs (Entra Object IDs, hashed values).
5. Authoritative docs: `docs/DATA_MODEL.md`, `docs/governance/ROLES_PERMISSIONS.md`, `docs/SECURITY_PRIVACY.md`, `docs/SCORING_MODEL.md`.

## Database Context

- PostgreSQL 16 + PostGIS on Azure Database for PostgreSQL Flexible Server
- Extensions enabled: `postgis`, `uuid-ossp`
- All PKs are `UUID DEFAULT uuid_generate_v4()`
- All mutable tables have `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`
- `set_updated_at()` trigger function exists (from 0001)
- Geometry column `geom` on `locations` with `sync_location_geom()` trigger

## Task 1: Verify Existing Schema Against Application Code

The UI/API agent has built API routes that write to these tables. Verify the SQL schema supports every query. Specific areas to check:

### Claim Route (`/api/host/claim` — POST)
Writes to: `organizations`, `services`, `verification_queue`
- `verification_queue.submitted_by_user_id` — CONFIRMED renamed in 0002. ✅
- `verification_queue.notes` — column exists in 0000. ✅
- `services.status` — CHECK constraint includes 'inactive'. ✅

### Organization CRUD (`/api/host/organizations`)
- GET uses: `SELECT id, name, description, url, email, status, created_at, updated_at FROM organizations`
- ⚠️ NOTE: The app queries `organizations.status` but this column DOES NOT EXIST in the schema. The API route may reference it. Add `status TEXT DEFAULT 'active'` to organizations if not present.
- PUT dynamic SET on: `name`, `description`, `url`, `email`
- DELETE from: `organizations WHERE id = $1` — relies on `ON DELETE CASCADE` to locations/services. ✅

### Service CRUD (`/api/host/services`)
- GET filters by: `organization_id`, `status`, text search on `name`
- POST inserts: `organization_id, name, alternate_name, description, url, email, status`
- All columns exist in 0000. ✅

### Location CRUD (`/api/host/locations`)
- GET joins: `locations LEFT JOIN addresses ON a.location_id = l.id JOIN organizations ON o.id = l.organization_id`
- POST inserts to `locations` then `addresses` (in transaction). All columns exist. ✅
- PUT updates `locations` fields + upserts `addresses`. ✅

### Verification Queue (Community Admin `/queue`, `/verify` — Phase 4 being built now)
- Queries: `SELECT * FROM verification_queue WHERE status IN ('pending','in_review') ORDER BY created_at`
- Joins: `verification_queue JOIN services ON s.id = vq.service_id JOIN organizations ON o.id = s.organization_id`
- Updates: `UPDATE verification_queue SET status = $1, assigned_to = $2, notes = $3 WHERE id = $4`
- ⚠️ `assigned_to` column: exists in 0000 as `TEXT` — consider renaming to `assigned_to_user_id` for consistency with the audit field convention used everywhere else. This is optional but recommended.

### Audit Logs (ORAN Admin `/audit` — Phase 5)
- `audit_logs` table exists from 0004. ✅
- Has: `actor_user_id, actor_role, action, resource_type, resource_id, before, after, ip_digest, request_id, created_at`

## Task 2: Missing Tables — CREATE These

### 2a. `coverage_zones` table (needed by Phase 4 `/coverage` and Phase 5 `/zone-management`)
Referenced in `docs/governance/ROLES_PERMISSIONS.md` permission matrix but DOES NOT EXIST in any migration.

```sql
CREATE TABLE IF NOT EXISTS coverage_zones (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  description       TEXT,
  geometry          GEOMETRY(Polygon, 4326),    -- PostGIS polygon for zone boundary
  assigned_user_id  TEXT,                        -- Community admin Entra Object ID
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);
```
Indexes needed: `(assigned_user_id)`, GIST on `(geometry)`, `(status)`

### 2b. `organization_members` table (needed for `/admins` team management)
No team membership table exists. The `/admins` page needs:

```sql
CREATE TABLE IF NOT EXISTS organization_members (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,               -- Entra Object ID (pseudonymous)
  role              TEXT NOT NULL DEFAULT 'host_member' CHECK (role IN ('host_member', 'host_admin')),
  status            TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'deactivated')),
  invited_by_user_id TEXT,
  invited_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  UNIQUE(organization_id, user_id)
);
```
Indexes needed: `(organization_id)`, `(user_id)`, `(status)`

### 2c. `user_profiles` table (referenced in permissions matrix)
Stores pseudonymous user preferences. Privacy-first: no PII beyond what the IdP provides.

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           TEXT UNIQUE NOT NULL,         -- Entra Object ID
  display_name      TEXT,                         -- User-chosen, not from IdP PII
  preferred_locale  TEXT DEFAULT 'en',
  approximate_city  TEXT,                         -- Deliberately imprecise
  role              TEXT NOT NULL DEFAULT 'seeker' CHECK (role IN ('seeker', 'host_member', 'host_admin', 'community_admin', 'oran_admin')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT
);
```

## Task 3: Schema Optimizations

Evaluate and implement if beneficial:

1. **Composite indexes for common query patterns**:
   - `verification_queue(status, created_at DESC)` — queue page sorts by oldest pending first
   - `services(organization_id, status)` — host services page filters by both
   - `locations(organization_id, name)` — host locations page sorts by name within org

2. **Full-text search improvements**:
   - Currently `organizations.name` has GIN index. Consider adding `description` GIN for org search.
   - `locations` has NO text search index. Add GIN on `locations.name` if needed.

3. **`organizations.status` column**: If absent, add `status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'defunct'))`. The API references it.

4. **Soft-delete support**: `docs/DATA_MODEL.md` says "Records are marked status='defunct' rather than hard-deleted." Services already have a status column with 'defunct'. Organizations and locations need a similar column if they don't have one.

5. **Trigger for `set_updated_at` on new tables**: Every new table with `updated_at` needs a trigger using the existing `set_updated_at()` function.

## Task 4: Seed Data Review

Review `db/seed/demo.sql` and ensure it:
- Covers all new tables (coverage_zones, organization_members, user_profiles)
- Inserts realistic demo data that exercises all status values
- Does not contain real PII

## Output Requirements

- One migration file per logical unit (e.g., `0005_coverage_zones.sql`, `0006_org_members_and_profiles.sql`, `0007_schema_optimizations.sql`)
- Each file starts with a comment header: `-- 0005_coverage_zones.sql` + description
- All DDL is idempotent
- Include `set_updated_at()` triggers for all new tables with `updated_at`
- After writing, run `npx tsc --noEmit 2>&1 | grep -v "src/agents/"` to verify TypeScript doesn't break (your SQL shouldn't affect TS, but verify)
- Update `db/README.md` migration table if one exists

## DO NOT

- Modify files outside `db/` (no TypeScript, no API routes, no UI)
- Create tables that duplicate existing ones
- Store raw IP addresses, email addresses in audit columns (use pseudonymous IDs only)
- Drop or rename existing columns that are in use (the app is live)
- Write migration 0002, 0003, or 0004 — they already exist
