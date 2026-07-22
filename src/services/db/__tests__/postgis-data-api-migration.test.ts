import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0074_isolate_data_api_schema.sql'),
  'utf8',
);
const aclLockdown = readFileSync(
  resolve(process.cwd(), 'db/migrations/0075_data_api_acl_lockdown.sql'),
  'utf8',
);

describe('PostGIS Data API hardening migration', () => {
  it('creates an empty deny-by-default schema for PostgREST', () => {
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS oran_api');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('ALTER DEFAULT PRIVILEGES');
    expect(migration).not.toMatch(/ALTER TABLE\s+public\.spatial_ref_sys\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('documents the required provider exposure boundary', () => {
    expect(migration).toContain('matching provider setting must expose only `oran_api`');
    expect(migration).toContain('exclusively exposed by ORAN Supabase Data API configuration');
  });

  it('removes browser-role access to public and enables RLS on app tables', () => {
    expect(aclLockdown).toContain(
      'REVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated',
    );
    expect(aclLockdown).toContain(
      'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public',
    );
    expect(aclLockdown).toContain('ENABLE ROW LEVEL SECURITY');
    expect(aclLockdown).toContain("c.relname <> 'spatial_ref_sys'");
    expect(aclLockdown).toContain("d.deptype = 'e'");
  });
});
