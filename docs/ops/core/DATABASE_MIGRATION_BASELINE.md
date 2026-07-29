# Database migration baseline gate

ORAN's remote migration runner is intentionally fail-closed on any populated
database that does not already have a reviewed `public.schema_migrations`
ledger. The runner must never create or guess an imported production baseline.

## Current release manifest

The release contains exactly 76 lexical migration files:

- first: `0000_initial_schema.sql`
- comparison/baseline boundary: `0068_shared_rate_limit_windows.sql` (67 files)
- runtime contact repair: `0069_backend_contact_read_capability.sql`
- concurrent seeker index: `0070_services_fulltext_index.sql`
- durable erasure schema: `0071_account_erasure_workflow.sql`
- untracked operator phase: 128 indexes from
  `scripts/db/build-account-erasure-indexes.sql`
- tracked erasure gate: `0072_account_erasure_index_gate.sql`
- canonical external identities: `0073_canonical_entity_identifiers.sql`
- empty Data API schema: `0074_isolate_data_api_schema.sql`
- browser-role ACL/RLS lockdown: `0075_data_api_acl_lockdown.sql`
- erasure high-water planner fix:
  `0076_account_erasure_highwater_planner_fix.sql`
- candidate revision lineage + dual-approval evidence:
  `0077_candidate_revision_lineage.sql`

The expected final repository ledger is therefore exactly 76 rows with
`0077_candidate_revision_lineage.sql` as the maximum filename. Supabase's own
`supabase_migrations.schema_migrations` history is provider metadata and remains
separate. Do not copy, delete, or rename provider entries while establishing the
ORAN ledger.

## Why the gate exists

The production schema was imported before the repository ledger existed. Many
historical migrations are not safe to replay over populated tables: they create
indexes, triggers, constraints, roles, and data controls that may already exist.
Creating an empty ledger and running the directory can partially mutate the
database before failing. A ledger row proves reviewed schema equivalence or a
successful SQL execution; it is never a way to silence a migration error.

`.github/workflows/db-migrate.yml` consequently requires the ledger to exist and
requires both `0071` and `0072` to be present before its generic loop can run.
That workflow cannot perform or bypass the online 128-index maintenance phase.

## Acceptance-branch rehearsal

Use a paid, isolated Supabase branch created from the intended production
project. The helper obtains branch credentials without printing them, validates
the project identity, refuses a populated branch without a repository ledger,
and records SQL only after success.

First stop at the imported-schema comparison boundary:

```bash
MIGRATION_FINAL=0068_shared_rate_limit_windows.sql \
REAPPLY_DATA_API_LOCKDOWN=true \
scripts/db/rehearse-supabase-branch.sh \
  <branch-name> <production-project-ref> <branch-project-ref>
```

Compare normalized branch and production catalogs for relations, columns,
constraints, indexes, triggers, functions, role attributes, and grants. Every
difference must be explained. Do not create production baseline rows unless the
target is semantically equivalent through `0068`.

Then complete the branch rehearsal:

```bash
scripts/db/rehearse-supabase-branch.sh \
  <branch-name> <production-project-ref> <branch-project-ref>

VERIFY_DATA_API_ISOLATION=true \
scripts/db/configure-supabase-data-api.sh <branch-project-ref> oran_api
```

Acceptance requires all of the following:

- output `76|0077_candidate_revision_lineage.sql`;
- `0070` exists as a live, ready, valid concurrent index;
- all 128 fixed account-erasure indexes are live, ready, and valid;
- the account-erasure release gate is open;
- backend role attributes and least-privilege grants match production intent;
- PostgREST exposes only `oran_api` and publishable/anon requests cannot resolve
  either `public.services` or `public.spatial_ref_sys`;
- focused and full migration verification pass.

If provider branch history is out of sync, repair provider metadata only after
the schema comparison proves the SQL is already present. Supabase migration
repair changes history; it does not execute SQL and is not acceptance evidence.

## Production baseline and cutover

1. Confirm the dedicated ORAN project, a completed provider backup, database
   health, disk/WAL headroom, and the exact reviewed Git commit. Use a direct or
   session connection, never the Vercel transaction pooler, and never print the
   connection URL.
2. Hold application promotion and other schema writers for the cutover. Capture
   the existing provider history without altering it.
3. Re-run the normalized production-versus-rehearsal comparison through `0068`.
   In one controlled metadata transaction, create the locked-down
   `public.schema_migrations` table if needed and baseline the exact 67 filenames
   through `0068` only. Abort on any filename/count mismatch.
4. Execute `0069`; verify the contact read grant; then record `0069`.
5. Execute `0070` outside a transaction. Verify the index is live, ready, and
   valid; only then record `0070`. An interrupted invalid index must be dropped
   concurrently and rebuilt before recording.
6. Execute `0071`; verify its dark release gate; only then record `0071`.
7. Run `scripts/db/build-account-erasure-indexes.sql`. It must build and verify
   exactly 128 indexes. This operator phase receives no migration filename and no
   ledger row.
8. Execute `0072`. Record it only after the exact gate succeeds and opens
   `indexes_ready`. A SQLSTATE `55000` is a safe stop; leave `0072` absent, repair
   or resume the online build, and retry the migration.
9. Execute and record `0073`, `0074`, `0075`, and `0076` in lexical order,
   recording each only after its SQL succeeds.
10. Configure Supabase PostgREST to expose only `oran_api`, then run the Data API
    isolation proof. Migration `0074` creates the schema but cannot change the
    provider setting by itself.
11. Verify the exact 75-row repository ledger, the release gates, runtime
    connectivity, and application smoke tests before enabling automatic remote
    migration dispatch.

Never deploy the account-erasure worker between steps 6 and 8. Never insert the
`0072` row manually to bypass the gate. A failed SQL file remains absent from the
ledger even when some of its non-transactional work must be recovered forward.

## Automation after baseline

The GitHub environment may set `SUPABASE_MIGRATIONS_ENABLED=true` only after the
controlled cutover is complete. `SUPABASE_DB_URL` must be the dedicated ORAN
direct/session migration connection and `SUPABASE_PROJECT_REF` must match it.
The workflow preserves the manual account-erasure boundary and applies later
ordinary SQL files in lexical order, inserting each filename only after `psql`
returns success.

## Validation

```bash
bash scripts/db/disposable-postgres.sh
npx vitest run \
  src/services/db/__tests__/greenfield-bootstrap-migrations.test.ts \
  src/services/db/__tests__/account-erasure-migration.test.ts \
  src/services/db/__tests__/postgis-data-api-migration.test.ts
```

On the target database, the release is not complete until this returns
`76|0077_candidate_revision_lineage.sql` and the erasure gate is true:

```sql
SELECT count(*) || '|' || max(filename)
FROM public.schema_migrations;

SELECT indexes_ready
FROM oran_internal.account_erasure_release_gate
WHERE singleton;
```
