import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0068_shared_rate_limit_windows.sql'),
  'utf8',
);

const runtimeValidator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-backend-runtime.sql'),
  'utf8',
);

describe('0068 shared rate-limit migration', () => {
  it('atomically consumes fixed-window capacity without a check-then-write race', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS oran_internal.shared_rate_limit_windows');
    expect(migration).toContain('rate_key          text        PRIMARY KEY');
    expect(migration).toContain('ON CONFLICT (rate_key) DO UPDATE');
    expect(migration).toContain('windows.request_count + 1, p_max_requests + 1');
    expect(migration).toContain('RETURNING windows.request_count');
  });

  it('bounds inputs, retained counts, and expired-row cleanup work', () => {
    expect(migration).toContain("p_rate_key !~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('p_window_seconds > 86400');
    expect(migration).toContain('p_max_requests > 10000');
    expect(migration).toContain('idx_shared_rate_limit_windows_reset');
    expect(migration).toContain('LIMIT 250');
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('pg_catalog.random() < 0.01');
  });

  it('keeps the relation private and exposes only the bounded function to the backend role', () => {
    expect(migration).toContain(
      'ALTER TABLE oran_internal.shared_rate_limit_windows ENABLE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /ON TABLE oran_internal\.shared_rate_limit_windows\s+FROM PUBLIC, anon, authenticated, service_role, oran_runtime, oran_backend_runtime;/,
    );
    expect(migration).toMatch(
      /ON FUNCTION oran_internal\.consume_shared_rate_limit\(text, integer, integer\)\s+FROM PUBLIC, anon, authenticated, service_role, oran_runtime, oran_backend_runtime;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE\s+ON FUNCTION oran_internal\.consume_shared_rate_limit\(text, integer, integer\)\s+TO oran_backend_runtime;/,
    );
    expect(migration).not.toMatch(
      /GRANT[\s\S]*ON TABLE oran_internal\.shared_rate_limit_windows/i,
    );
  });

  it('updates the release validator for the one new runtime capability', () => {
    expect(runtimeValidator).toContain(
      "'oran_internal.consume_shared_rate_limit(text,integer,integer)'::pg_catalog.regprocedure::oid",
    );
  });
});
