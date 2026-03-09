import { describe, expect, it, vi } from 'vitest';

import { normalizeSourceRecord } from '../normalizeSourceRecord';

function buildSourceRecord(payloadOverrides: Record<string, unknown> = {}) {
  return {
    id: 'sr-1',
    sourceFeedId: 'feed-1',
    sourceRecordType: 'service',
    sourceRecordId: 'ext-001',
    sourceVersion: null,
    fetchedAt: new Date(),
    canonicalSourceUrl: null,
    payloadSha256: 'abc123',
    rawPayload: {},
    parsedPayload: {
      organization: { name: 'Community Aid', description: 'Helps people.' },
      services: [
        { name: 'Food Bank', description: 'Free groceries.', fees: 'None' },
      ],
      locations: [
        {
          name: 'Downtown Office',
          latitude: 47.6,
          longitude: -122.3,
          address_1: '100 Pine St',
          city: 'Seattle',
          region: 'WA',
          postal_code: '98101',
          country: 'US',
        },
      ],
      ...payloadOverrides,
    },
    evidenceId: null,
    correlationId: null,
    sourceLicense: null,
    sourceConfidenceSignals: {},
    processingStatus: 'pending',
    processingError: null,
    processedAt: null,
    createdAt: new Date(),
  };
}

function createMockStores() {
  let orgIdCounter = 0;
  let svcIdCounter = 0;
  let locIdCounter = 0;
  let cslIdCounter = 0;

  return {
    canonicalOrganizations: {
      create: vi.fn().mockImplementation((row) => ({
        id: `org-${++orgIdCounter}`,
        ...row,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    canonicalServices: {
      create: vi.fn().mockImplementation((row) => ({
        id: `svc-${++svcIdCounter}`,
        ...row,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    canonicalLocations: {
      create: vi.fn().mockImplementation((row) => ({
        id: `loc-${++locIdCounter}`,
        ...row,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    canonicalServiceLocations: {
      bulkCreate: vi.fn().mockImplementation((rows) =>
        rows.map((row: Record<string, unknown>, i: number) => ({
          id: `csl-${++cslIdCounter}-${i}`,
          ...row,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      ),
    },
    canonicalProvenance: {
      bulkCreate: vi.fn(),
    },
    sourceRecords: {
      updateStatus: vi.fn(),
    },
  };
}

describe('normalizeSourceRecord', () => {
  it('creates canonical org, service, and location from HSDS-shaped payload', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord();

    const result = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
      trustTier: 'curated',
    });

    expect(result.canonicalOrganizationId).toBe('org-1');
    expect(result.canonicalServiceIds).toEqual(['svc-1']);
    expect(result.canonicalLocationIds).toEqual(['loc-1']);
    expect(result.provenanceRecordsCreated).toBeGreaterThan(0);

    // Organization created with correct fields
    expect(stores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Community Aid',
        description: 'Helps people.',
        lifecycleStatus: 'active',
        publicationStatus: 'unpublished',
      }),
    );

    // Service created
    expect(stores.canonicalServices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalOrganizationId: 'org-1',
        name: 'Food Bank',
        description: 'Free groceries.',
        fees: 'None',
      }),
    );

    // Location created
    expect(stores.canonicalLocations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalOrganizationId: 'org-1',
        name: 'Downtown Office',
        latitude: 47.6,
        longitude: -122.3,
        addressLine1: '100 Pine St',
        addressCity: 'Seattle',
      }),
    );

    // Service–location junction (batch)
    expect(stores.canonicalServiceLocations.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalServiceId: 'svc-1',
          canonicalLocationId: 'loc-1',
        }),
      ]),
    );

    // Provenance recorded
    expect(stores.canonicalProvenance.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalEntityType: 'organization',
          fieldName: 'name',
          decidedBy: 'normalization-bridge',
          decisionStatus: 'accepted',
        }),
      ]),
    );

    // Source record marked as normalized
    expect(stores.sourceRecords.updateStatus).toHaveBeenCalledWith('sr-1', 'normalized');
  });

  it('handles flat payload without nested organization/services/locations keys', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord({
      organization: undefined,
      services: undefined,
      locations: undefined,
    });
    // Put name at top level
    (record.parsedPayload as Record<string, unknown>)['name'] = 'Direct Org';

    const result = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    });

    // Should use the top-level name
    expect(stores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Direct Org' }),
    );
    // Service should fall back to org name
    expect(stores.canonicalServices.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Direct Org' }),
    );
    expect(result.canonicalLocationIds).toHaveLength(0);
  });

  it('rejects records without an organization name', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord({
      organization: { description: 'No name' },
      services: [],
      locations: [],
    });
    // Ensure no top-level name fallback
    delete (record.parsedPayload as Record<string, unknown>)['organization_name'];
    delete (record.parsedPayload as Record<string, unknown>)['name'];

    await expect(
      normalizeSourceRecord({
        stores: stores as never,
        sourceRecord: record as never,
      }),
    ).rejects.toThrow('has no organization name');
  });

  it('applies correct confidence for verified_publisher trust tier', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord();

    await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
      trustTier: 'verified_publisher',
    });

    expect(stores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfidenceSummary: { overall: 90 },
      }),
    );
  });

  it('applies default confidence for unknown trust tier', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord();

    await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
      trustTier: undefined,
    });

    expect(stores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfidenceSummary: { overall: 50 },
      }),
    );
  });

  it('handles multiple services and locations', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord({
      services: [
        { name: 'Svc A', description: 'A' },
        { name: 'Svc B', description: 'B' },
      ],
      locations: [
        { name: 'Loc 1', latitude: 47.0, longitude: -122.0 },
        { name: 'Loc 2', latitude: 48.0, longitude: -121.0 },
      ],
    });

    const result = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    });

    expect(result.canonicalServiceIds).toHaveLength(2);
    expect(result.canonicalLocationIds).toHaveLength(2);

    // Each service linked to each location via bulkCreate (2 services × 2 locations = 4 rows total across calls)
    const allBulkCalls = stores.canonicalServiceLocations.bulkCreate.mock.calls;
    const totalJunctions = allBulkCalls.reduce(
      (sum: number, call: unknown[]) => sum + (call[0] as unknown[]).length, 0
    );
    expect(totalJunctions).toBe(4);
  });

  it('falls back to rawPayload when parsedPayload is null', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord();
    record.parsedPayload = null as unknown as typeof record.parsedPayload;
    record.rawPayload = {
      organization: { name: 'Raw Org' },
      services: [{ name: 'Raw Svc' }],
    };

    const result = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    });

    expect(stores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Raw Org' }),
    );
    expect(result.canonicalServiceIds).toHaveLength(1);
  });

  it('skips locations without meaningful content', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord({
      locations: [{ description: 'just a description, no name or address' }],
    });

    const result = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    });

    expect(result.canonicalLocationIds).toHaveLength(0);
    expect(stores.canonicalLocations.create).not.toHaveBeenCalled();
  });
});
