import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The CI "Migration Verification" job proves these behaviours by replaying the
// chain into a real disposable database. These tests guard the intent in the SQL
// itself, so the guards cannot be removed without a deliberate change here.

const hotlineAuthority = readFileSync(
  resolve(process.cwd(), 'db/migrations/0065_verified_hotline_authority.sql'),
  'utf8',
);

const backendCapability = readFileSync(
  resolve(process.cwd(), 'db/migrations/0066_backend_runtime_capability.sql'),
  'utf8',
);

const contactReadCapability = readFileSync(
  resolve(process.cwd(), 'db/migrations/0069_backend_contact_read_capability.sql'),
  'utf8',
);

const migrationNames = readdirSync(resolve(process.cwd(), 'db/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right, 'en'));

describe('regional release migration ledger', () => {
  it('pins the exact 77-file sequence through candidate-lineage activation', () => {
    expect(migrationNames).toHaveLength(77);
    expect(migrationNames[0]).toBe('0000_initial_schema.sql');
    expect(migrationNames.slice(66)).toEqual([
      '0068_shared_rate_limit_windows.sql',
      '0069_backend_contact_read_capability.sql',
      '0070_services_fulltext_index.sql',
      '0071_account_erasure_workflow.sql',
      '0072_account_erasure_index_gate.sql',
      '0073_canonical_entity_identifiers.sql',
      '0074_isolate_data_api_schema.sql',
      '0075_data_api_acl_lockdown.sql',
      '0076_account_erasure_highwater_planner_fix.sql',
      '0077_candidate_revision_lineage.sql',
      '0078_candidate_revision_activation.sql',
    ]);
  });
});

describe('0065 greenfield bootstrap', () => {
  it('no-ops instead of aborting when the hotline import has never run', () => {
    expect(hotlineAuthority).toContain("'status', 'skipped_no_hotline_import'");
    // The guard must sit before the manifest is built, so an empty database
    // never reaches the exact-count assertion.
    expect(hotlineAuthority.indexOf('skipped_no_hotline_import'))
      .toBeLessThan(hotlineAuthority.indexOf('CREATE TEMP TABLE hotline_expected'));
  });

  it('still aborts on a partial hotline set — only "nothing to do" is a no-op', () => {
    expect(hotlineAuthority).toContain(
      'hotline import count drift: expected exactly 13 total import:hotline services, found %',
    );
  });

  it('asserts the applied state only where a batch actually exists', () => {
    // A bare assert_verified_hotline_authority('applied') at the end would abort
    // a greenfield run, because that function raises when the batch is absent.
    expect(hotlineAuthority).not.toMatch(
      /\nSELECT oran_internal\.assert_verified_hotline_authority\('applied'\);/,
    );
    expect(hotlineAuthority).toContain(
      "PERFORM oran_internal.assert_verified_hotline_authority('applied')",
    );
    // An absent batch alongside real hotline rows is drift, not a greenfield.
    expect(hotlineAuthority).toContain(
      'hotline authority batch % is absent while % import:hotline services exist',
    );
  });
});

describe('0070 seeker full-text index', () => {
  const fulltextIndex = readFileSync(
    resolve(process.cwd(), 'db/migrations/0070_services_fulltext_index.sql'),
    'utf8',
  );

  it('indexes the exact expression the seeker query uses', () => {
    // An expression index is only usable when it matches the query expression
    // exactly; 0000's separate name/description indexes never could.
    const engine = readFileSync(
      resolve(process.cwd(), 'src/services/search/engine.ts'),
      'utf8',
    );
    expect(engine).toContain("to_tsvector('english', s.name || ' ' || coalesce(s.description, ''))");
    expect(fulltextIndex).toContain(
      "to_tsvector('english', name || ' ' || coalesce(description, ''))",
    );
  });

  it('builds concurrently and stays a single statement', () => {
    // ~290k rows in production: a plain CREATE INDEX would hold ACCESS EXCLUSIVE
    // and stop every seeker read. CONCURRENTLY cannot run inside a transaction,
    // which only holds while this file has one statement and no BEGIN/COMMIT.
    expect(fulltextIndex).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(fulltextIndex).not.toMatch(/\b(BEGIN|COMMIT)\s*;/i);
    const statements = fulltextIndex
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .filter((part) => part.trim().length > 0);
    expect(statements).toHaveLength(1);
  });
});

describe('backend contact read capability', () => {
  it('grants the canonical manifest in 0066 for greenfield installs', () => {
    const selectManifest = backendCapability.match(
      /GRANT SELECT ON TABLE\s+([\s\S]*?)\s+TO oran_backend_runtime;/,
    )?.[1];
    expect(selectManifest).toBeDefined();
    expect(selectManifest).toContain('public.contacts');
  });

  it('pairs 0066 with 0069 so already-provisioned databases converge', () => {
    // 0066 never re-runs where it has already been applied (the ledger keys on
    // filename), so the edit alone would only ever reach a fresh database.
    expect(contactReadCapability).toMatch(
      /GRANT SELECT ON TABLE\s+public\.contacts\s+TO oran_backend_runtime;/,
    );
  });

  it('covers the service-detail read path that would otherwise fail closed', () => {
    const hydration = readFileSync(
      resolve(process.cwd(), 'src/services/search/hydrateRelations.ts'),
      'utf8',
    );
    expect(hydration).toContain('FROM contacts');
  });
});
