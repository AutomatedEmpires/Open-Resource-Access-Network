# Database Migrations

This folder contains SQL migrations for the Postgres/PostGIS database.

## Release ledger

The current release contains exactly **77** ordered SQL files, beginning with
`0000_initial_schema.sql` and ending with
`0078_candidate_revision_activation.sql`. `public.schema_migrations` is ORAN's
filename-keyed deployment ledger. Supabase's provider-managed migration history
is separate and must not be copied into, removed from, or used as a substitute
for this ledger.

## Conventions

- Migrations are applied in lexical filename order and recorded only after the
  corresponding SQL succeeds.
- `0070_services_fulltext_index.sql` must run outside a transaction because it
  uses `CREATE INDEX CONCURRENTLY`.
- `0071_account_erasure_workflow.sql` is applied and recorded before the
  untracked online phase builds exactly 128 fixed indexes. The online builder is
  an operator action and never receives its own ledger row.
- `0072_account_erasure_index_gate.sql` is applied only after that online phase
  and is recorded only if its exact validity gate succeeds. Never insert either
  account-erasure ledger row to bypass failed SQL or a failed gate.
- `0073_canonical_entity_identifiers.sql`,
  `0074_isolate_data_api_schema.sql`, and
  `0075_data_api_acl_lockdown.sql` follow the gate in that order. Migration
  `0074` must be paired with the provider setting that exposes only `oran_api`.
- `0076_account_erasure_highwater_planner_fix.sql` follows `0075` and must be
  recorded before the account-erasure worker is accepted in production.
- `0077_candidate_revision_lineage.sql` follows `0076` and is an additive,
  backward-compatible expand phase. It leaves evidence nullable and the
  dual-approval workflow dark while the lineage-aware application deploys.
- `0078_candidate_revision_activation.sql` is applied only after the exact
  lineage-aware application deployment and health are proved. Recording it is
  the activation switch for immutable lineage and dual approval. It refuses to
  activate without two distinct operationally eligible reviewer identities and
  without two-person reviewer coverage for every open candidate.
- Keep schema changes aligned with the data model in `docs/DATA_MODEL.md`.

## Related

- Local DB setup: `db/README.md`
- Production baseline gate: `docs/ops/core/DATABASE_MIGRATION_BASELINE.md`
- Account-erasure release: `docs/ops/services/RUNBOOK_ACCOUNT_ERASURE.md`
- Import pipeline: `docs/solutions/IMPORT_PIPELINE.md`
