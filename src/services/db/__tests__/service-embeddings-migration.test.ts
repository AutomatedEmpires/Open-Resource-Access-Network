import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0072_service_embeddings.sql'),
  'utf8',
);

describe('0072 derived service embeddings migration', () => {
  it('isolates derived vectors from authoritative service clocks', () => {
    expect(migration).toContain('CREATE TABLE public.service_embeddings');
    expect(migration).toContain('REFERENCES public.services(id) ON DELETE CASCADE');
    expect(migration).toContain('content_sha256 text NOT NULL');
    expect(migration).toContain('source_updated_at timestamptz NOT NULL');
    expect(migration).toContain('USING hnsw (embedding vector_cosine_ops)');
    expect(migration).not.toMatch(/UPDATE\s+public\.services/i);
    expect(migration).not.toMatch(/SET\s+updated_at/i);
  });

  it('rejects unversioned legacy vectors and grants only required runtime operations', () => {
    expect(migration).toContain('do not backfill services.embedding');
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.service_embeddings/i);
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.service_embeddings FROM PUBLIC');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.service_embeddings');
    expect(migration).not.toMatch(/GRANT[^;]*DELETE/i);
  });

  it('does not schema-qualify PostgreSQL special expressions', () => {
    expect(migration).not.toMatch(
      /pg_catalog\.(?:coalesce|least|greatest|nullif)\s*\(/i,
    );
  });
});
