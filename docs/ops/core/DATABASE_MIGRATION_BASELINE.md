# Database migration baseline gate

ORAN remote database migration is intentionally disabled. This is an execution
control, not a claim that the database is remediated.

## Why execution is blocked

The repository contains 53 ordered SQL files. The dedicated Supabase project has
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
