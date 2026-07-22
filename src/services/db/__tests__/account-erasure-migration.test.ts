import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0071_account_erasure_workflow.sql'),
  'utf8',
);
const indexGate = readFileSync(
  resolve(process.cwd(), 'db/migrations/0072_account_erasure_index_gate.sql'),
  'utf8',
);
const onlineIndexBuild = readFileSync(
  resolve(process.cwd(), 'scripts/db/build-account-erasure-indexes.sql'),
  'utf8',
);
const branchRehearsal = readFileSync(
  resolve(process.cwd(), 'scripts/db/rehearse-supabase-branch.sh'),
  'utf8',
);
const migrationWorkflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/db-migrate.yml'),
  'utf8',
);

const dispatcher = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION oran_internal.process_account_erasure_page'),
  migration.indexOf('CREATE OR REPLACE FUNCTION oran_internal.complete_account_erasure'),
);
const exporter = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION oran_internal.export_user_governance_data'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.set_updated_at'),
);

describe('0071 bounded durable account erasure migration', () => {
  it('fixes Clerk profiles and keeps revocation indexed in every request state', () => {
    expect(migration).toContain("'azure-ad', 'google', 'credentials', 'clerk'");
    expect(migration).toContain('UNIQUE (clerk_user_digest)');
    expect(migration).toContain('request.clerk_user_digest =');
    expect(migration).not.toMatch(/is_account_erased[\s\S]{0,600}request\.status\s+IN/i);
  });

  it('uses private request and checked step ledgers without direct table grants', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS oran_internal.account_erasure_requests');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS oran_internal.account_erasure_steps');
    expect(migration).toContain('ALTER TABLE oran_internal.account_erasure_requests ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE oran_internal.account_erasure_steps ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('account_erasure_identity_blocks');
    expect(migration).toContain('account_erasure_release_gate');
    expect(migration).toContain("status IN ('pending', 'processing', 'blocked', 'completed')");
    expect(migration).toContain("status IN ('pending', 'running', 'done', 'blocked')");
    expect(migration).not.toMatch(
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*account_erasure_(?:requests|steps)[\s\S]*oran_backend_runtime/i,
    );
  });

  it('has an immutable 72-step manifest and fixed CASE dispatcher', () => {
    expect(migration).toContain('ordinal BETWEEN 1 AND 72');
    expect(migration).toContain("(72, 'content_templates')");
    expect(dispatcher.match(/WHEN '[a-z_]+' THEN/g)).toHaveLength(72);
    expect(dispatcher).toContain('CASE v_step.step_name');
    expect(dispatcher).not.toContain('FOREACH');
    expect(dispatcher).not.toContain('v_attribution_table');
    expect(dispatcher).not.toMatch(/EXECUTE[\s\S]{0,300}(?:UPDATE|DELETE)/i);
  });

  it('limits every operation to one 500-2000 PK page with captured high-water state', () => {
    expect(dispatcher).toContain('p_page_size < 500 OR p_page_size > 2000');
    expect(dispatcher).toContain('LIMIT p_page_size');
    expect(dispatcher).toContain('highwater_captured');
    expect(dispatcher).toContain('rows_scanned = step.rows_scanned + v_scanned');
    const publicMutations = [
      ...dispatcher.matchAll(/(?:UPDATE|DELETE FROM)\s+public\.[\s\S]*?;/gi),
    ].map((match) => match[0]);
    expect(publicMutations.length).toBeGreaterThan(60);
    for (const statement of publicMutations) {
      expect(statement).toMatch(/ANY\(v_page\)|record\.id\s*=\s*sanitized\.id/i);
    }
  });

  it('includes an all-zero UUID row at the NULL cursor boundary', () => {
    expect(dispatcher).toContain('v_step.cursor_uuid IS NULL OR id > v_step.cursor_uuid');
    expect(dispatcher).toContain('v_step.cursor_uuid IS NULL');
    expect(dispatcher).not.toContain('00000000-0000-0000-0000-000000000000');
    expect(dispatcher).not.toMatch(/COALESCE\(v_step\.cursor/i);
  });

  it('requires a fresh pass after pass one and blocks a third changed pass', () => {
    expect(dispatcher).toContain('v_pass_changed = 0 AND v_step.pass >= 2');
    expect(dispatcher).toContain('v_step.pass < 3');
    expect(dispatcher).toContain("last_error_code = 'writer_reintroduction_detected'");
    expect(dispatcher).toContain("SET status = 'blocked'");
  });

  it('blocks identity reintroduction from queue commit without a GUC bypass', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS oran_internal.account_erasure_identity_blocks');
    expect(migration).toContain('CREATE TRIGGER trg_reject_erased_identity');
    expect(migration).toContain("TG_OP = 'UPDATE'");
    expect(migration).toContain('v_value IS NOT DISTINCT FROM v_old_value');
    expect(migration).toContain("ERRCODE = '23514'");
    expect(migration).not.toContain("current_setting('oran.erasure_control'");
    expect(migration).not.toContain("set_config('oran.erasure_control'");
  });

  it('uses online self-healing indexes and a tracked validity gate', () => {
    expect(migration).not.toMatch(/CREATE INDEX[^;]+ON public\./i);
    expect(onlineIndexBuild).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(onlineIndexBuild).toContain('DROP INDEX CONCURRENTLY IF EXISTS');
    expect(onlineIndexBuild).toMatch(/NOT \(\s*index_state\.indisvalid/);
    expect(onlineIndexBuild).toContain("SET lock_timeout = '5s'");
    expect(onlineIndexBuild).toContain("SET statement_timeout = '30min'");
    expect(indexGate).not.toContain('\\set');
    expect(indexGate).not.toContain('CONCURRENTLY');
    expect(indexGate).toContain('index_state.indisvalid');
    expect(indexGate).toContain('index_state.indisready');
    expect(indexGate).toContain('index_state.indislive');
    expect(indexGate).toContain('index_namespace.nspname = target.table_schema');
    expect(indexGate).toContain('table_namespace.nspname = target.table_schema');
    expect(indexGate).toContain('table_relation.relname = target.table_name');
    expect(indexGate).toContain('SET indexes_ready = true');
  });

  it('keeps the online builder and tracked gate on the same exact targets', () => {
    const builtTargets = [...onlineIndexBuild.matchAll(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS\s+(\w+)\s+ON\s+(\w+)\.(\w+)/g,
    )].map((match) => `${match[1]}:${match[2]}.${match[3]}`).sort();
    const gatedTargets = [...indexGate.matchAll(
      /\('([^']+)'::name, '([^']+)'::name, '([^']+)'::name\)/g,
    )].map((match) => `${match[1]}:${match[2]}.${match[3]}`).sort();

    expect(builtTargets).toHaveLength(128);
    expect(gatedTargets).toHaveLength(128);
    expect(gatedTargets).toEqual(builtTargets);
  });

  it('records tracked migrations only around the required online operator phase', () => {
    const applyTrackedMigration = branchRehearsal.slice(
      branchRehearsal.indexOf('apply_tracked_migration()'),
      branchRehearsal.indexOf('mapfile -t migrations'),
    );
    const sqlExecution = applyTrackedMigration.indexOf('-f "$file"');
    const ledgerInsert = applyTrackedMigration.indexOf(
      'INSERT INTO public.schema_migrations',
    );
    expect(sqlExecution).toBeGreaterThanOrEqual(0);
    expect(ledgerInsert).toBeGreaterThanOrEqual(0);
    expect(sqlExecution).toBeLessThan(ledgerInsert);

    const releaseSequence = branchRehearsal.slice(
      branchRehearsal.indexOf('# 0071 installs the dark erasure workflow'),
      branchRehearsal.indexOf('# Later migrations are ordinary tracked SQL'),
    );
    const workflowMigration = releaseSequence.indexOf(
      'apply_tracked_migration "${migrations[69]}"',
    );
    const onlineBuild = releaseSequence.indexOf('build-account-erasure-indexes.sql');
    const validityGate = releaseSequence.indexOf(
      'apply_tracked_migration "${migrations[70]}"',
    );
    expect(workflowMigration).toBeGreaterThanOrEqual(0);
    expect(onlineBuild).toBeGreaterThanOrEqual(0);
    expect(validityGate).toBeGreaterThanOrEqual(0);
    expect(workflowMigration).toBeLessThan(onlineBuild);
    expect(onlineBuild).toBeLessThan(validityGate);

    expect(migrationWorkflow).toContain('"0071_account_erasure_workflow.sql"');
    expect(migrationWorkflow).toContain('"0072_account_erasure_index_gate.sql"');
    expect(migrationWorkflow).toContain('ACCOUNT_ERASURE_MANUAL_RUNBOOK_ONLY');
    expect(migrationWorkflow).toContain('Do not pre-record either migration');
  });

  it('keeps the worker dark until the gate passes and leases only one first worker', () => {
    expect(migration).toContain("MESSAGE = 'account erasure capability is not ready'");
    expect(migration).toContain('RETURNS TABLE (request_id uuid, request_status text, lease_acquired boolean)');
    expect(migration).toContain("status = 'processing'");
    expect(migration).toContain("lease_expires_at = pg_catalog.now() + interval '10 minutes'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION oran_internal.release_account_erasure_lease');
    expect(migration).toContain('SET lease_expires_at = NULL');
  });

  it('keeps semi-structured identity selectors indexable', () => {
    expect(dispatcher).toContain('v_identity_patterns text[]');
    expect(dispatcher).toContain('~ ANY(v_identity_patterns)');
    expect(dispatcher).not.toContain('~ v_identity_pattern');
  });

  it('indexes only the non-synthetic actor subset on nationwide resources', () => {
    expect(migration).toContain("p_user_id ~ '^import:'");
    expect(dispatcher).toContain('ARRAY[created_by_user_id, updated_by_user_id]');
    expect(dispatcher).toContain("created_by_user_id !~ '^import:'");
    expect(onlineIndexBuild).toContain('idx_ae_services_human_actors');
    expect(onlineIndexBuild).toContain('USING gin ((ARRAY[created_by_user_id');
    expect(onlineIndexBuild).toContain("updated_by_user_id !~ '^import:'");
  });

  it('records Clerk deletion durably and refuses premature completion', () => {
    expect(migration).toContain('clerk_deleted_at timestamptz');
    expect(migration).toContain('mark_clerk_account_deleted');
    expect(migration).toContain('IF v_request.clerk_deleted_at IS NULL THEN');
    expect(migration).toContain("step.status <> 'done'");
    expect(migration).toContain("RAISE EXCEPTION 'account erasure steps are incomplete'");
  });

  it('batches every high-volume attribution and JSON surface', () => {
    for (const surface of [
      'ownership_transfers', 'extracted_candidates', 'ingestion_audit_events',
      'lifecycle_events', 'audit_logs', 'scope_audit_log',
      'submission_transitions', 'submissions', 'source_records',
      'resource_freshness_findings', 'resource_quarantine_members',
      'resource_quarantine_batches', 'hotline_authority_members',
      'hotline_quarantined_contacts', 'hotline_authority_added_contacts',
      'hotline_authority_batches', 'services', 'locations', 'organizations',
      'addresses', 'service_taxonomy', 'service_at_location', 'phones',
    ]) {
      expect(dispatcher).toContain(`WHEN '${surface}' THEN`);
    }
    expect(dispatcher).toContain('(batch_id, service_id)');
    expect(dispatcher).toContain('(batch_id, phone_id)');
    expect(dispatcher).toContain('(batch_id, contact_key)');
  });

  it('preserves global workflow lock order in each short page transaction', () => {
    for (const key of [
      'oran:live-publication-merge',
      'oran:resource-freshness-scan',
      'oran:authority:verified-national-hotlines-2026-07-13',
      'oran:quarantine:usda-fns-snap-retailer-2026-07',
    ]) {
      expect(dispatcher).toContain(key);
    }
  });

  it('exports only typed projections with deterministic per-bucket truncation', () => {
    expect(exporter).toContain('LIMIT 1001');
    expect(exporter).toContain("'hasMore'");
    expect(exporter).toContain("'truncated'");
    expect(exporter).toContain('ORDER BY rows.created_at DESC, rows.id');
    expect(exporter).not.toMatch(/submission\.(?:payload|evidence)/);
    expect(exporter).not.toContain('instance.form_data');
    expect(exporter).not.toContain('file_url');
    expect(exporter).not.toMatch(/raw_payload\s+AS|parsed_payload\s+AS/i);
  });

  it('avoids wildcard identity scans and invalid catalog qualification', () => {
    expect(migration).not.toMatch(/\bLIKE\b/i);
    expect(migration).not.toMatch(/pg_catalog\.(?:coalesce|least)\b/i);
  });

  it('preserves timestamps only for the bounded dispatcher owner', () => {
    expect(migration).toContain("set_config('oran.erasure_mode', 'on', true)");
    expect(migration).toContain('process_account_erasure_page(uuid,integer)');
    expect(migration).toContain('current_user = v_erasure_owner');
    expect(migration).toContain('NEW.updated_at := OLD.updated_at');
  });
});
