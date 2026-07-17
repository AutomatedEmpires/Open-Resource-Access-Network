# Database migration baseline gate

ORAN remote database migration is intentionally disabled. This is an execution
control, not a claim that the database is remediated.

## Why execution is blocked

The repository contains 67 ordered SQL files. The dedicated Supabase project has
a populated application schema, while its managed migration history records only
the later security-lockdown operation and no `public.schema_migrations` table
exists. Several legacy files contain non-idempotent indexes and triggers.
Creating an empty ledger and replaying those files against the populated database
could partially change the schema before failing.

The GitHub workflow therefore:

- has read-only repository permissions;
- requests no OIDC permission and no provider credential;
- never connects to Azure, Supabase, or another database;
- inventories filenames only during pull requests; and
- fails every manual dispatch before any SQL can run.

## Required baseline procedure

Remote migration execution may be restored only in a reviewed pull request after
all of these artifacts exist:

1. A provider backup and a demonstrated restore path for the target database.
2. A disposable Postgres 17 database with the required PostGIS, vector, and
   UUID-OSSP extensions.
3. A successful clean replay of all committed migrations into that disposable
   database.
4. Normalized schema dumps from disposable and target databases, with every
   difference explained and reviewed.
5. A committed immutable manifest containing every legacy migration filename and
   checksum.
6. One explicit baseline strategy: either a verified custom filename/checksum
   ledger or a canonical Supabase baseline. Do not maintain two competing ledgers.
7. A migration runner that uses one transaction, an advisory lock, checksum
   verification, least-privilege credentials, and a non-production rehearsal.

Baseline repair changes metadata on a populated database. It is not authorized by
this document and must not be bundled with application deployment or DNS cutover.

## Evidence status (2026-07-16)

Artifacts 2 and 3 now have a tool. `npm run verify:migrations` (CI job
"Migration Verification", `scripts/db/verify-migrations.mjs`) provisions a
disposable Postgres 17 with PostGIS/vector/UUID-OSSP and replays every committed
migration. It refuses non-local hosts and non-disposable database names.

Artifact 2 — **satisfied**. The Supabase image the verifier uses supplies the
same extension versions the live project reports (PostGIS 3.3.7, vector 0.8.2).

Artifact 3 — **satisfied**. Every committed migration (0000–0069) replays into an
empty database, proven on every pull request by the CI job. Reaching that took
one fix:

- `0065_verified_hotline_authority.sql` previously aborted on any greenfield
  database with `hotline import count drift: expected exactly 13 total
  import:hotline services, found 0`. Those 13 rows are loaded by
  `scripts/import/sources/hotlines.mjs` — no migration creates them — so the
  chain could not rebuild an empty database at all. It now returns
  `skipped_no_hotline_import` when **zero** hotline services exist, because there
  is nothing to grant authority to. A **partial** set (any count other than 13)
  is still drift and still aborts, and an absent batch alongside real hotline
  rows now raises rather than passing quietly. Verified both directions against a
  disposable database: 0 rows skips, 1 row aborts with the original error.

Bootstrap ordering for a rebuilt database is therefore:

1. Replay `db/migrations` (hotline authority self-skips).
2. Run the bulk open-data import, including `scripts/import/sources/hotlines.mjs`.
3. `SELECT oran_internal.apply_verified_hotline_authority();` to grant hotline
   publication authority over the imported rows.

Step 3 is safe to run at any later point and is idempotent; until it runs, the
hotline records simply hold no publication authority.

### Grant coverage

The verifier also asserts that every table is reachable by `oran_backend_runtime`
or carries a justified exception, and this is now an **enforced** gate. It found
one real defect: `public.contacts` appeared in no 0066 grant list, so the service
detail hydration (`src/services/search/hydrateRelations.ts`) failed closed with a
permission error on every provisioned database. Repaired by adding it to the 0066
canonical manifest (greenfield) and `0069_backend_contact_read_capability.sql`
(already-provisioned environments).

The remaining unreachable tables are deliberate and enumerated in
`scripts/db/verify-migrations.mjs`: private counters behind their SECURITY
DEFINER functions, runbook-operated quarantine and hotline authority tables, and
tables declared in the Drizzle schema that no code path queries. Granting those
would be dead privilege. When a feature first needs one, the gate fails and
forces the grant to land with the code.
