import { readFileSync } from 'node:fs';
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
