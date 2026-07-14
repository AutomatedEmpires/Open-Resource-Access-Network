import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0067_retire_legacy_runtime_acl.sql'),
  'utf8',
);

describe('0067 legacy runtime ACL retirement migration', () => {
  it('removes every direct schema, relation, and function ACL from the retired role', () => {
    expect(migration).toContain('pg_catalog.pg_namespace');
    expect(migration).toContain('pg_catalog.pg_class');
    expect(migration).toContain('pg_catalog.pg_proc');
    expect(migration.match(/pg_catalog\.aclexplode/g)).toHaveLength(6);
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM oran_runtime');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM oran_runtime');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE %s FROM oran_runtime');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM oran_runtime');
    expect(migration).toContain('legacy oran_runtime retains direct object privileges');
  });

  it('does not rewrite extension, PUBLIC, or active-backend privileges', () => {
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toContain('FROM PUBLIC');
    expect(migration).not.toContain('FROM oran_backend_runtime');
    expect(migration).not.toMatch(/ALTER\s+(?:EXTENSION|ROLE)/i);
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
  });
});
