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

Artifact 3 — **not satisfied, and not currently satisfiable**. A clean replay of
*all* committed migrations is impossible today:

- `0065_verified_hotline_authority.sql` aborts on any greenfield database with
  `hotline import count drift: expected exactly 13 total import:hotline services,
  found 0`. The 13 rows it asserts on are loaded by
  `scripts/import/sources/hotlines.mjs` — no migration creates them. A fresh
  ORAN database therefore cannot be built from the migration chain alone; the
  bulk import is an undocumented step in the middle of the sequence.
- Every other committed migration (0000–0064, 0066–0068) replays cleanly, which
  the CI job now proves on every pull request.

The verifier also reports 15 application tables that the backend runtime role
cannot read on a greenfield database (for example `public.contacts`,
`public.programs`, `public.source_record_taxonomy`). These would fail closed at
runtime with permission errors. The repair is the 0066/0069 grant reconciliation
preserved on the WIP checkpoint; grant coverage becomes an enforced gate in the
pull request that lands it.

Resolving artifact 3 requires a founder decision on one of:

1. Make `0065` tolerate an empty hotline set (it is idempotent and
   advisory-locked; a no-op on zero rows is the honest greenfield behaviour), or
2. Accept that bootstrap is "migrations + seed import + migrations" and commit
   that ordering to this document and to any disaster-recovery drill.

Until one is chosen, ORAN has no demonstrated path to rebuild its database from
source — which is the actual risk this gate exists to surface.
