/**
 * Tests for entity resolution module.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveEntity,
  normalizeName,
  type EntityResolutionInput,
  type EntityResolutionStores,
} from '../entityResolution';

// ── Helpers ────────────────────────────────────────────────

function makeMockStores(): EntityResolutionStores {
  return {
    entityIdentifiers: {
      listByEntity: vi.fn(),
      findByScheme: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      updateStatusForEntity: vi.fn(),
      deleteByEntity: vi.fn().mockResolvedValue(0),
    },
    canonicalOrganizations: {
      getById: vi.fn(),
      listByLifecycle: vi.fn().mockResolvedValue([]),
      listByPublication: vi.fn().mockResolvedValue([]),
      listByWinningSource: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateLifecycleStatus: vi.fn(),
      updatePublicationStatus: vi.fn(),
    },
    canonicalServices: {
      getById: vi.fn(),
      listByOrganization: vi.fn(),
      listByLifecycle: vi.fn().mockResolvedValue([]),
      listByPublication: vi.fn(),
      listByWinningSource: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateLifecycleStatus: vi.fn(),
      updatePublicationStatus: vi.fn(),
      findActiveByUrl: vi.fn().mockResolvedValue(null),
      findActiveByName: vi.fn().mockResolvedValue(null),
    },
  };
}

// ── normalizeName tests ───────────────────────────────────

describe('normalizeName', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeName("St. Mary's Food Bank")).toBe('st marys food bank');
  });

  it('collapses whitespace', () => {
    expect(normalizeName('  Homeless   Shelter  ')).toBe('homeless shelter');
  });

  it('returns empty for empty input', () => {
    expect(normalizeName('')).toBe('');
  });
});

// ── resolveEntity tests ───────────────────────────────────

describe('resolveEntity', () => {
  it('resolves by identifier match (strategy 1)', async () => {
    const stores = makeMockStores();
    (stores.entityIdentifiers.findByScheme as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'eid-1',
      entityType: 'canonical_service',
      entityId: 'cs-1',
      identifierScheme: 'source_system:ss-1',
      identifierValue: 'src-rec-1',
    });
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cs-1',
      canonicalOrganizationId: 'co-1',
    });

    const input: EntityResolutionInput = {
      sourceSystemId: 'ss-1',
      sourceRecordId: 'src-rec-1',
    };

    const result = await resolveEntity(input, stores);
    expect(result.strategy).toBe('identifier');
    expect(result.canonicalServiceId).toBe('cs-1');
    expect(result.canonicalOrganizationId).toBe('co-1');
    expect(result.confidence).toBe(100);
  });

  it('resolves organization identifier match', async () => {
    const stores = makeMockStores();
    (stores.entityIdentifiers.findByScheme as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'eid-1',
      entityType: 'canonical_organization',
      entityId: 'co-1',
    });
    (stores.canonicalOrganizations.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'co-1',
      name: 'Test Org',
    });

    const result = await resolveEntity(
      { sourceSystemId: 'ss-1', sourceRecordId: 'org-rec-1' },
      stores
    );

    expect(result.strategy).toBe('identifier');
    expect(result.canonicalOrganizationId).toBe('co-1');
    expect(result.canonicalServiceId).toBeNull();
    expect(result.confidence).toBe(95);
  });

  it('falls through to URL match (strategy 2)', async () => {
    const stores = makeMockStores();
    (stores.canonicalServices.findActiveByUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: 'cs-1', canonicalOrganizationId: 'co-1', name: 'Food Bank', url: 'https://foodbank.org' },
    );

    const input: EntityResolutionInput = {
      sourceSystemId: 'ss-1',
      service: { url: 'https://foodbank.org/', phone: '555-1234' },
    };

    const result = await resolveEntity(input, stores);
    expect(result.strategy).toBe('url_phone');
    expect(result.canonicalServiceId).toBe('cs-1');
    // URL-only match gives 80
    expect(result.confidence).toBe(80);
  });

  it('falls through to name match (strategy 3)', async () => {
    const stores = makeMockStores();
    (stores.canonicalServices.findActiveByName as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: 'cs-2', canonicalOrganizationId: 'co-2', name: 'St Marys Food Bank', url: null },
    );

    const input: EntityResolutionInput = {
      sourceSystemId: 'ss-1',
      service: { name: 'St Marys Food Bank' },
    };

    const result = await resolveEntity(input, stores);
    expect(result.strategy).toBe('name_address');
    expect(result.canonicalServiceId).toBe('cs-2');
    expect(result.confidence).toBe(70);
  });

  it('returns none when no strategy matches', async () => {
    const stores = makeMockStores();

    const result = await resolveEntity(
      { sourceSystemId: 'ss-1', service: { name: 'Totally Unique Service' } },
      stores
    );

    expect(result.strategy).toBe('none');
    expect(result.canonicalServiceId).toBeNull();
    expect(result.canonicalOrganizationId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('skips identifier strategy when no sourceRecordId', async () => {
    const stores = makeMockStores();

    const result = await resolveEntity(
      { sourceSystemId: 'ss-1' },
      stores
    );

    expect(stores.entityIdentifiers.findByScheme).not.toHaveBeenCalled();
    expect(result.strategy).toBe('none');
  });

  it('url_phone strategy works with URL-only (no phone)', async () => {
    const stores = makeMockStores();
    (stores.canonicalServices.findActiveByUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: 'cs-url', canonicalOrganizationId: 'co-url', name: 'Test', url: 'https://example.com' },
    );

    const result = await resolveEntity(
      { sourceSystemId: 'ss-1', service: { url: 'https://example.com' } },
      stores
    );

    // URL-only match succeeds with confidence 80
    expect(result.strategy).toBe('url_phone');
    expect(result.confidence).toBe(80);
  });

  it('priority: identifier wins over url match', async () => {
    const stores = makeMockStores();
    // Both strategies would match, but identifier should win
    (stores.entityIdentifiers.findByScheme as ReturnType<typeof vi.fn>).mockResolvedValue({
      entityType: 'canonical_service',
      entityId: 'cs-id',
    });
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cs-id',
      canonicalOrganizationId: 'co-id',
    });
    (stores.canonicalServices.findActiveByUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: 'cs-url', canonicalOrganizationId: 'co-url', url: 'https://match.com' },
    );

    const result = await resolveEntity(
      {
        sourceSystemId: 'ss-1',
        sourceRecordId: 'rec-1',
        service: { url: 'https://match.com', phone: '555-0000' },
      },
      stores
    );

    expect(result.strategy).toBe('identifier');
    expect(result.canonicalServiceId).toBe('cs-id');
    // findActiveByUrl should NOT have been called since identifier matched first
    expect(stores.canonicalServices.findActiveByUrl).not.toHaveBeenCalled();
  });

  it('cleans up orphaned service identifier and falls through (R17)', async () => {
    const stores = makeMockStores();
    // Identifier exists but referenced service is deleted
    (stores.entityIdentifiers.findByScheme as ReturnType<typeof vi.fn>).mockResolvedValue({
      entityType: 'canonical_service',
      entityId: 'cs-deleted',
    });
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await resolveEntity(
      { sourceSystemId: 'ss-1', sourceRecordId: 'rec-orphan' },
      stores
    );

    // Should have cleaned up the orphan
    expect(stores.entityIdentifiers.deleteByEntity).toHaveBeenCalledWith(
      'canonical_service', 'cs-deleted'
    );
    // Falls through to 'none' since no other strategies match
    expect(result.strategy).toBe('none');
    expect(result.confidence).toBe(0);
  });

  it('cleans up orphaned org identifier and falls through (R17)', async () => {
    const stores = makeMockStores();
    (stores.entityIdentifiers.findByScheme as ReturnType<typeof vi.fn>).mockResolvedValue({
      entityType: 'canonical_organization',
      entityId: 'co-deleted',
    });
    (stores.canonicalOrganizations.getById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await resolveEntity(
      { sourceSystemId: 'ss-1', sourceRecordId: 'rec-orphan-org' },
      stores
    );

    expect(stores.entityIdentifiers.deleteByEntity).toHaveBeenCalledWith(
      'canonical_organization', 'co-deleted'
    );
    expect(result.strategy).toBe('none');
  });
});
