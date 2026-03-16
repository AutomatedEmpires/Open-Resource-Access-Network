import { beforeEach, describe, expect, it, vi } from 'vitest';

const withTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  withTransaction: withTransactionMock,
}));

async function loadModule() {
  return import('../promoteToLive');
}

function buildCanonicalOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canon-org-1',
    name: 'Acme Nonprofit',
    alternateName: null,
    description: 'Helps the community.',
    url: 'https://acme.org',
    email: 'info@acme.org',
    phone: '(206) 555-0100',
    taxStatus: '501c3',
    taxId: '12-3456789',
    yearIncorporated: 2010,
    legalStatus: 'nonprofit',
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-sys-1',
    sourceCount: 2,
    sourceConfidenceSummary: { overall: 85 },
    publishedOrganizationId: null,
    firstSeenAt: new Date(),
    lastRefreshedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildCanonicalService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canon-svc-1',
    canonicalOrganizationId: 'canon-org-1',
    name: 'Food Pantry',
    alternateName: null,
    description: 'Emergency food distribution.',
    url: 'https://acme.org/pantry',
    email: 'pantry@acme.org',
    status: 'active',
    interpretationServices: null,
    applicationProcess: 'Walk-in',
    waitTime: 'Under 30 min',
    fees: 'Free',
    accreditations: null,
    licenses: null,
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-sys-1',
    sourceCount: 2,
    sourceConfidenceSummary: { overall: 85 },
    publishedServiceId: null,
    firstSeenAt: new Date(),
    lastRefreshedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildCanonicalLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canon-loc-1',
    canonicalOrganizationId: 'canon-org-1',
    name: 'Main Office',
    alternateName: null,
    description: null,
    transportation: 'Bus',
    latitude: 47.62,
    longitude: -122.33,
    geom: null,
    addressLine1: '123 Main St',
    addressLine2: null,
    addressCity: 'Seattle',
    addressRegion: 'WA',
    addressPostalCode: '98101',
    addressCountry: 'US',
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-sys-1',
    sourceCount: 1,
    sourceConfidenceSummary: {},
    publishedLocationId: null,
    firstSeenAt: new Date(),
    lastRefreshedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockStores() {
  return {
    canonicalOrganizations: {
      getById: vi.fn(),
      update: vi.fn(),
      updatePublicationStatus: vi.fn(),
    },
    canonicalServices: {
      getById: vi.fn(),
      update: vi.fn(),
      updatePublicationStatus: vi.fn(),
    },
    canonicalLocations: {
      getById: vi.fn(),
      getByIds: vi.fn(),
      update: vi.fn(),
      updatePublicationStatus: vi.fn(),
    },
    canonicalServiceLocations: {
      listByService: vi.fn(),
    },
  };
}

describe('promoteToLive', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('inserts new live records from canonical entities (first promote)', async () => {
    const stores = createMockStores();
    const clientQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    withTransactionMock.mockImplementation(async (cb: (c: unknown) => unknown) =>
      cb({ query: clientQueryMock }),
    );

    stores.canonicalServices.getById.mockResolvedValue(buildCanonicalService());
    stores.canonicalOrganizations.getById.mockResolvedValue(buildCanonicalOrg());
    stores.canonicalServiceLocations.listByService.mockResolvedValue([
      { id: 'csl-1', canonicalServiceId: 'canon-svc-1', canonicalLocationId: 'canon-loc-1' },
    ]);
    stores.canonicalLocations.getByIds.mockResolvedValue([buildCanonicalLocation()]);

    const { promoteToLive } = await loadModule();
    const result = await promoteToLive({
      stores: stores as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    });

    // Should be an INSERT (not update)
    expect(result.isUpdate).toBe(false);
    expect(result.organizationId).toEqual(expect.any(String));
    expect(result.serviceId).toEqual(expect.any(String));
    expect(result.locationIds).toHaveLength(1);

    // Verify INSERT queries run
    const insertCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO'),
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(6); // org, service, location, sal, address, confidence, entity_id, hsds, lifecycle

    // Organization insert
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO organizations'),
      expect.arrayContaining(['Acme Nonprofit']),
    );

    // Service insert
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO services'),
      expect.arrayContaining(['Food Pantry']),
    );

    // Location insert
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO locations'),
      expect.arrayContaining(['Main Office', 47.62, -122.33]),
    );

    // Address insert
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO addresses'),
      expect.arrayContaining(['123 Main St', 'Seattle', 'WA']),
    );

    // HSDS export snapshot
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO hsds_export_snapshots'),
      expect.arrayContaining([1, expect.stringContaining('"canonicalServiceId":"canon-svc-1"')]),
    );

    // Lifecycle event
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lifecycle_events'),
      expect.arrayContaining(['promoted']),
    );

    // Canonical entities updated with published IDs
    expect(stores.canonicalOrganizations.update).toHaveBeenCalledWith('canon-org-1', {
      publishedOrganizationId: result.organizationId,
    });
    expect(stores.canonicalServices.update).toHaveBeenCalledWith('canon-svc-1', {
      publishedServiceId: result.serviceId,
    });
    expect(stores.canonicalLocations.update).toHaveBeenCalledWith('canon-loc-1', {
      publishedLocationId: result.locationIds[0],
    });

    // Publication status set
    expect(stores.canonicalOrganizations.updatePublicationStatus).toHaveBeenCalledWith(
      'canon-org-1', 'published',
    );
    expect(stores.canonicalServices.updatePublicationStatus).toHaveBeenCalledWith(
      'canon-svc-1', 'published',
    );
    expect(stores.canonicalLocations.updatePublicationStatus).toHaveBeenCalledWith(
      'canon-loc-1', 'published',
    );
  });

  it('updates existing live records on re-promote', async () => {
    const stores = createMockStores();
    const clientQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    withTransactionMock.mockImplementation(async (cb: (c: unknown) => unknown) =>
      cb({ query: clientQueryMock }),
    );

    const existingOrgId = 'live-org-1';
    const existingSvcId = 'live-svc-1';
    const existingLocId = 'live-loc-1';

    stores.canonicalServices.getById.mockResolvedValue(
      buildCanonicalService({ publishedServiceId: existingSvcId }),
    );
    stores.canonicalOrganizations.getById.mockResolvedValue(
      buildCanonicalOrg({ publishedOrganizationId: existingOrgId }),
    );
    stores.canonicalServiceLocations.listByService.mockResolvedValue([
      { id: 'csl-1', canonicalServiceId: 'canon-svc-1', canonicalLocationId: 'canon-loc-1' },
    ]);
    stores.canonicalLocations.getByIds.mockResolvedValue([
      buildCanonicalLocation({ publishedLocationId: existingLocId }),
    ]);

    const { promoteToLive } = await loadModule();
    const result = await promoteToLive({
      stores: stores as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'admin-42',
    });

    expect(result.isUpdate).toBe(true);
    expect(result.organizationId).toBe(existingOrgId);
    expect(result.serviceId).toBe(existingSvcId);
    expect(result.locationIds).toEqual([existingLocId]);

    // Verify UPDATE queries run
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE organizations'),
      expect.arrayContaining([existingOrgId, 'Acme Nonprofit']),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE services'),
      expect.arrayContaining([existingSvcId, 'Food Pantry']),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE locations'),
      expect.arrayContaining([existingLocId]),
    );

    // Previous HSDS snapshot superseded
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'superseded'"),
      expect.arrayContaining([existingSvcId]),
    );

    // Lifecycle event is 'republished' (not 'promoted')
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lifecycle_events'),
      expect.arrayContaining(['republished']),
    );

    // Should NOT call update for IDs that already exist
    expect(stores.canonicalOrganizations.update).not.toHaveBeenCalled();
    expect(stores.canonicalServices.update).not.toHaveBeenCalled();
    expect(stores.canonicalLocations.update).not.toHaveBeenCalled();
  });

  it('rejects promotion when canonical service is not active', async () => {
    const stores = createMockStores();
    stores.canonicalServices.getById.mockResolvedValue(
      buildCanonicalService({ lifecycleStatus: 'retired' }),
    );

    const { promoteToLive } = await loadModule();
    await expect(
      promoteToLive({
        stores: stores as never,
        canonicalServiceId: 'canon-svc-1',
        actorId: 'system',
      }),
    ).rejects.toThrow("lifecycle is 'retired', expected 'active'");
  });

  it('rejects promotion when canonical service does not exist', async () => {
    const stores = createMockStores();
    stores.canonicalServices.getById.mockResolvedValue(null);

    const { promoteToLive } = await loadModule();
    await expect(
      promoteToLive({
        stores: stores as never,
        canonicalServiceId: 'nonexistent',
        actorId: 'system',
      }),
    ).rejects.toThrow('Canonical service nonexistent not found');
  });

  it('rejects promotion when canonical organization does not exist', async () => {
    const stores = createMockStores();
    stores.canonicalServices.getById.mockResolvedValue(buildCanonicalService());
    stores.canonicalOrganizations.getById.mockResolvedValue(null);

    const { promoteToLive } = await loadModule();
    await expect(
      promoteToLive({
        stores: stores as never,
        canonicalServiceId: 'canon-svc-1',
        actorId: 'system',
      }),
    ).rejects.toThrow('Canonical organization canon-org-1 not found');
  });

  it('promotes a service with no locations', async () => {
    const stores = createMockStores();
    const clientQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    withTransactionMock.mockImplementation(async (cb: (c: unknown) => unknown) =>
      cb({ query: clientQueryMock }),
    );

    stores.canonicalServices.getById.mockResolvedValue(buildCanonicalService());
    stores.canonicalOrganizations.getById.mockResolvedValue(buildCanonicalOrg());
    stores.canonicalServiceLocations.listByService.mockResolvedValue([]);

    const { promoteToLive } = await loadModule();
    const result = await promoteToLive({
      stores: stores as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    });

    expect(result.locationIds).toHaveLength(0);
    // Should not have any location/address inserts
    const locationCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO locations'),
    );
    expect(locationCalls).toHaveLength(0);
  });

  it('phone is inserted when canonical org has a phone number', async () => {
    const stores = createMockStores();
    const clientQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    withTransactionMock.mockImplementation(async (cb: (c: unknown) => unknown) =>
      cb({ query: clientQueryMock }),
    );

    stores.canonicalServices.getById.mockResolvedValue(buildCanonicalService());
    stores.canonicalOrganizations.getById.mockResolvedValue(
      buildCanonicalOrg({ phone: '(206) 555-0100' }),
    );
    stores.canonicalServiceLocations.listByService.mockResolvedValue([]);

    const { promoteToLive } = await loadModule();
    await promoteToLive({
      stores: stores as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    });

    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO phones'),
      expect.arrayContaining(['(206) 555-0100']),
    );
  });

  it('adopts matching existing live organization and service rows when canonical ids are not linked yet', async () => {
    const stores = createMockStores();
    const clientQueryMock = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        expect(params).toEqual(['live-publication:acme.org|acme nonprofit|acme.org/pantry|food pantry']);
        return { rows: [{ pg_advisory_xact_lock: '' }], rowCount: 1 };
      }
      if (sql.includes('FROM organizations') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        return { rows: [{ id: 'live-org-existing' }], rowCount: 1 };
      }
      if (sql.includes('FROM services') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        return { rows: [{ id: 'live-svc-existing' }], rowCount: 1 };
      }
      if (sql.includes('FROM service_at_location sal')) {
        return { rows: [{ id: 'live-loc-existing' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    withTransactionMock.mockImplementation(async (cb: (c: unknown) => unknown) =>
      cb({ query: clientQueryMock }),
    );

    stores.canonicalServices.getById.mockResolvedValue(buildCanonicalService());
    stores.canonicalOrganizations.getById.mockResolvedValue(buildCanonicalOrg());
    stores.canonicalServiceLocations.listByService.mockResolvedValue([
      { id: 'csl-1', canonicalServiceId: 'canon-svc-1', canonicalLocationId: 'canon-loc-1' },
    ]);
    stores.canonicalLocations.getByIds.mockResolvedValue([buildCanonicalLocation()]);

    const { promoteToLive } = await loadModule();
    const result = await promoteToLive({
      stores: stores as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    });

    expect(result).toEqual({
      organizationId: 'live-org-existing',
      serviceId: 'live-svc-existing',
      locationIds: ['live-loc-existing'],
      isUpdate: true,
    });
    expect(clientQueryMock).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO organizations'),
      expect.anything(),
    );
    expect(clientQueryMock).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO services'),
      expect.anything(),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE organizations'),
      expect.arrayContaining(['live-org-existing', 'Acme Nonprofit']),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE services'),
      expect.arrayContaining(['live-svc-existing', 'live-org-existing', 'Food Pantry']),
    );
    expect(
      clientQueryMock.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes("description = COALESCE(NULLIF($4, ''), description)") && sql.includes('UPDATE services'),
      ),
    ).toBe(true);
    expect(stores.canonicalOrganizations.update).toHaveBeenCalledWith('canon-org-1', {
      publishedOrganizationId: 'live-org-existing',
    });
    expect(stores.canonicalServices.update).toHaveBeenCalledWith('canon-svc-1', {
      publishedServiceId: 'live-svc-existing',
    });
  });

  it('links canonical services to host-managed live rows without overwriting higher-authority snapshots', async () => {
    const stores = createMockStores();
    const clientQueryMock = vi.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: '' }], rowCount: 1 };
      if (sql.includes('FROM organizations') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        return { rows: [{ id: 'live-org-host' }], rowCount: 1 };
      }
      if (sql.includes('FROM services') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        return { rows: [{ id: 'live-svc-host' }], rowCount: 1 };
      }
      if (sql.includes('FROM service_at_location sal')) {
        return { rows: [{ id: 'live-loc-host' }], rowCount: 1 };
      }
      if (sql.includes('FROM hsds_export_snapshots')) {
        return {
          rows: [{
            hsds_payload: {
              meta: {
                generatedBy: 'oran-resource-submission-projection',
                channel: 'host',
                publicationSourceKind: 'host_submission',
              },
            },
            generated_at: '2026-03-16T00:00:00.000Z',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    withTransactionMock.mockImplementation(async (cb: (c: unknown) => unknown) =>
      cb({ query: clientQueryMock }),
    );

    stores.canonicalServices.getById.mockResolvedValue(buildCanonicalService());
    stores.canonicalOrganizations.getById.mockResolvedValue(buildCanonicalOrg());
    stores.canonicalServiceLocations.listByService.mockResolvedValue([
      { id: 'csl-1', canonicalServiceId: 'canon-svc-1', canonicalLocationId: 'canon-loc-1' },
    ]);
    stores.canonicalLocations.getByIds.mockResolvedValue([buildCanonicalLocation()]);

    const { promoteToLive } = await loadModule();
    const result = await promoteToLive({
      stores: stores as never,
      canonicalServiceId: 'canon-svc-1',
      actorId: 'system',
    });

    expect(result).toEqual({
      organizationId: 'live-org-host',
      serviceId: 'live-svc-host',
      locationIds: ['live-loc-host'],
      isUpdate: true,
    });
    expect(clientQueryMock).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE organizations'), expect.anything());
    expect(clientQueryMock).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE services'), expect.anything());
    expect(clientQueryMock).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO hsds_export_snapshots'), expect.anything());
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lifecycle_events'),
      expect.arrayContaining(['linked_existing']),
    );
    expect(stores.canonicalServices.update).toHaveBeenCalledWith('canon-svc-1', {
      publishedServiceId: 'live-svc-host',
    });
  });
});
