/**
 * Unit tests for hsdsExportPipeline.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildServicePayload,
  buildOrganizationPayload,
  runHsdsExport,
} from '../hsdsExportPipeline';
import type { IngestionStores } from '../stores';

// ── Fixtures ──────────────────────────────────────────────────

function makeOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-1',
    name: 'Test Org',
    description: 'Helping people',
    url: 'https://testorg.org',
    email: 'info@testorg.org',
    phone: '555-0001',
    status: 'active',
    publicationStatus: 'published',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSvc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    canonicalOrganizationId: 'org-1',
    winningSourceSystemId: 'src-1',
    name: 'Food Assistance',
    description: 'Provides food',
    url: 'https://testorg.org/food',
    email: 'food@testorg.org',
    status: 'active',
    lifecycleStatus: 'active',
    publicationStatus: 'published',
    publishedServiceId: null,
    confidenceScore: 85,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loc-1',
    name: 'Main Office',
    latitude: 47.6,
    longitude: -117.4,
    addressLine1: '123 Main St',
    addressCity: 'Spokane',
    addressRegion: 'WA',
    addressPostalCode: '99201',
    addressCountry: 'US',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStores(overrides: Partial<IngestionStores> = {}): IngestionStores {
  return {
    canonicalServices: {
      getById: vi.fn(),
      listByPublication: vi.fn().mockResolvedValue([]),
      listByOrganization: vi.fn(),
      listByLifecycle: vi.fn(),
      listByWinningSource: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateLifecycleStatus: vi.fn(),
      updatePublicationStatus: vi.fn(),
    },
    canonicalOrganizations: {
      getById: vi.fn(),
      findByName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    canonicalLocations: {
      getById: vi.fn(),
      getByIds: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    canonicalServiceLocations: {
      listByService: vi.fn().mockResolvedValue([]),
      listByLocation: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
    },
    hsdsExportSnapshots: {
      getCurrent: vi.fn(),
      create: vi.fn().mockImplementation((row) =>
        Promise.resolve({ id: `snap-${row.entityId}`, ...row })
      ),
      withdrawForEntity: vi.fn().mockResolvedValue(0),
      listCurrent: vi.fn(),
    },
    ...overrides,
  } as unknown as IngestionStores;
}

// ── Tests ─────────────────────────────────────────────────────

describe('buildServicePayload', () => {
  it('builds HSDS service payload with org and locations', () => {
    const payload = buildServicePayload({
      svc: makeSvc() as never,
      org: makeOrg() as never,
      locations: [makeLoc() as never],
    });

    expect(payload.id).toBe('svc-1');
    expect(payload.name).toBe('Food Assistance');
    expect(payload.organization).toEqual(
      expect.objectContaining({ id: 'org-1', name: 'Test Org' })
    );
    expect(payload.service_at_locations).toHaveLength(1);
    const loc = (payload.service_at_locations as Array<{ location: Record<string, unknown> }>)[0].location;
    expect(loc.city).toBe('Spokane');
  });

  it('omits organization when null', () => {
    const payload = buildServicePayload({
      svc: makeSvc() as never,
      org: null,
      locations: [],
    });
    expect(payload.organization).toBeUndefined();
    expect(payload.service_at_locations).toBeUndefined();
  });
});

describe('buildOrganizationPayload', () => {
  it('builds HSDS organization payload', () => {
    const payload = buildOrganizationPayload(makeOrg() as never);
    expect(payload.id).toBe('org-1');
    expect(payload.name).toBe('Test Org');
    expect(payload.phone).toBe('555-0001');
  });
});

describe('runHsdsExport', () => {
  let stores: IngestionStores;

  beforeEach(() => {
    vi.clearAllMocks();
    stores = makeStores();
  });

  it('exports specific services by ID', async () => {
    const svc = makeSvc();
    const org = makeOrg();
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(svc);
    (stores.canonicalOrganizations.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(org);
    (stores.canonicalServiceLocations.listByService as ReturnType<typeof vi.fn>)
      .mockResolvedValue([]);

    const result = await runHsdsExport({
      stores,
      serviceIds: ['svc-1'],
      profileUri: 'https://specs.openreferral.org/hsds/3.0',
    });

    expect(result.exported).toHaveLength(2); // service + org
    expect(result.exported[0].entityType).toBe('service');
    expect(result.exported[1].entityType).toBe('organization');
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    // Verified snapshot creation was called
    expect(stores.hsdsExportSnapshots.create).toHaveBeenCalledTimes(2);
    expect(stores.hsdsExportSnapshots.withdrawForEntity).toHaveBeenCalledWith('service', 'svc-1');
    expect(stores.hsdsExportSnapshots.withdrawForEntity).toHaveBeenCalledWith('organization', 'org-1');
  });

  it('exports all published services when no IDs given', async () => {
    const svc = makeSvc();
    (stores.canonicalServices.listByPublication as ReturnType<typeof vi.fn>)
      .mockResolvedValue([svc]);
    (stores.canonicalOrganizations.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(makeOrg());
    (stores.canonicalServiceLocations.listByService as ReturnType<typeof vi.fn>)
      .mockResolvedValue([]);

    const result = await runHsdsExport({ stores });

    expect(result.exported).toHaveLength(2);
    expect(stores.canonicalServices.listByPublication).toHaveBeenCalledWith('published', undefined);
  });

  it('skips non-found service IDs', async () => {
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(null);

    const result = await runHsdsExport({
      stores,
      serviceIds: ['missing-1'],
    });

    expect(result.skipped).toEqual([
      { entityId: 'missing-1', reason: 'canonical service not found' },
    ]);
    expect(result.exported).toHaveLength(0);
  });

  it('skips non-published services', async () => {
    const svc = makeSvc({ publicationStatus: 'draft' });
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(svc);

    const result = await runHsdsExport({
      stores,
      serviceIds: ['svc-1'],
    });

    expect(result.skipped).toEqual([
      { entityId: 'svc-1', reason: "publication status is 'draft', not 'published'" },
    ]);
  });

  it('includes locations in service payload', async () => {
    const svc = makeSvc();
    const org = makeOrg();
    const loc = makeLoc();
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(svc);
    (stores.canonicalOrganizations.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(org);
    (stores.canonicalServiceLocations.listByService as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{ canonicalLocationId: 'loc-1' }]);
    (stores.canonicalLocations.getByIds as ReturnType<typeof vi.fn>)
      .mockResolvedValue([loc]);

    const result = await runHsdsExport({
      stores,
      serviceIds: ['svc-1'],
    });

    expect(result.exported).toHaveLength(2);

    // Verify the payload includes service_at_locations
    const createCalls = (stores.hsdsExportSnapshots.create as ReturnType<typeof vi.fn>).mock.calls;
    const svcSnapshot = createCalls.find(
      (c: Array<{ entityType: string }>) => c[0].entityType === 'service'
    );
    const payload = svcSnapshot![0].hsdsPayload as Record<string, unknown>;
    expect(payload.service_at_locations).toHaveLength(1);
  });

  it('records errors when store throws', async () => {
    const svc = makeSvc();
    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(svc);
    (stores.canonicalServiceLocations.listByService as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('db timeout'));

    const result = await runHsdsExport({
      stores,
      serviceIds: ['svc-1'],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('db timeout');
  });

  it('deduplicates org snapshots across multiple services', async () => {
    const svc1 = makeSvc({ id: 'svc-1' });
    const svc2 = makeSvc({ id: 'svc-2' });
    const org = makeOrg();

    (stores.canonicalServices.getById as ReturnType<typeof vi.fn>)
      .mockImplementation((id: string) => {
        if (id === 'svc-1') return Promise.resolve(svc1);
        if (id === 'svc-2') return Promise.resolve(svc2);
        return Promise.resolve(null);
      });
    (stores.canonicalOrganizations.getById as ReturnType<typeof vi.fn>)
      .mockResolvedValue(org);
    (stores.canonicalServiceLocations.listByService as ReturnType<typeof vi.fn>)
      .mockResolvedValue([]);

    const result = await runHsdsExport({
      stores,
      serviceIds: ['svc-1', 'svc-2'],
    });

    // 2 service snapshots + 1 org snapshot (deduplicated)
    expect(result.exported).toHaveLength(3);
    const orgExports = result.exported.filter((e) => e.entityType === 'organization');
    expect(orgExports).toHaveLength(1);
  });
});
