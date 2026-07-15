import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0069_freshness_and_merge_runtime_capability.sql'),
  'utf8',
);

function grantedTables(operation: 'SELECT' | 'UPDATE' | 'DELETE'): string[] {
  const body = migration.match(
    new RegExp(`GRANT ${operation} ON TABLE\\s+([\\s\\S]*?)\\s+TO oran_backend_runtime;`),
  )?.[1];
  if (!body) throw new Error(`Missing ${operation} grant`);
  return [...(body.match(/(?:public|oran_internal)\.[a-z_]+/g) ?? [])].sort();
}

describe('0069 freshness and merge runtime capability migration', () => {
  it('patches only the reviewed read capability set', () => {
    expect(grantedTables('SELECT')).toEqual([
      'oran_internal.hotline_authority_batches',
      'oran_internal.hotline_authority_members',
      'oran_internal.resource_quarantine_batches',
      'oran_internal.resource_quarantine_members',
      'public.contacts',
      'public.dietary_options',
      'public.ingestion_sources',
      'public.org_service_scope',
      'public.programs',
      'public.service_adaptations',
      'public.staging_locations',
      'public.staging_organizations',
      'public.staging_services',
    ]);
  });

  it('supports freshness, privacy-safe lifecycle erasure, and every live merge child update', () => {
    expect(grantedTables('UPDATE')).toEqual([
      'public.contacts',
      'public.dietary_options',
      'public.eligibility',
      'public.ingestion_sources',
      'public.languages',
      'public.lifecycle_events',
      'public.org_service_scope',
      'public.phones',
      'public.programs',
      'public.required_documents',
      'public.resource_tags',
      'public.saved_collection_services',
      'public.saved_services',
      'public.schedules',
      'public.service_adaptations',
      'public.service_areas',
      'public.service_at_location',
      'public.service_attributes',
      'public.service_taxonomy',
    ]);
  });

  it('does not add destructive delete capability for merge reconciliation', () => {
    expect(migration).not.toMatch(/GRANT DELETE ON TABLE/);
  });

  it('does not broaden the runtime role beyond table CRUD', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).not.toMatch(/\bGRANT\s+ALL(?:\s+PRIVILEGES)?\b/i);
    expect(migration).not.toMatch(/\b(?:CREATE|TRUNCATE|TRIGGER|REFERENCES)\b/);
    expect(migration).not.toContain('oran_runtime');
  });
});
