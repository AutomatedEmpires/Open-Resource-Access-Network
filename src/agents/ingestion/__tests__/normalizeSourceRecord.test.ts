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

function replaceMap(
  target: Map<string, Record<string, unknown>>,
  snapshot: Map<string, Record<string, unknown>>,
): void {
  target.clear();
  for (const [key, value] of snapshot) target.set(key, value);
}

function createMockStores() {
  let processingStatus = 'pending';
  let failNextProvenanceWrite = false;
  let transactionTail = Promise.resolve();
  const organizations = new Map<string, Record<string, unknown>>();
  const services = new Map<string, Record<string, unknown>>();
  const locations = new Map<string, Record<string, unknown>>();
  const serviceLocations = new Map<string, Record<string, unknown>>();
  const provenance = new Map<string, Record<string, unknown>>();
  const stores: Record<string, any> = {
    runAtomically: vi.fn(async (callback) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;

      const snapshot = {
        processingStatus,
        organizations: new Map(organizations),
        services: new Map(services),
        locations: new Map(locations),
        serviceLocations: new Map(serviceLocations),
        provenance: new Map(provenance),
      };
      try {
        return await callback(stores);
      } catch (error) {
        processingStatus = snapshot.processingStatus;
        replaceMap(organizations, snapshot.organizations);
        replaceMap(services, snapshot.services);
        replaceMap(locations, snapshot.locations);
        replaceMap(serviceLocations, snapshot.serviceLocations);
        replaceMap(provenance, snapshot.provenance);
        throw error;
      } finally {
        release();
      }
    }),
  };

  const createUnique = (
    target: Map<string, Record<string, unknown>>,
    row: Record<string, unknown>,
  ) => {
    const id = row.id as string;
    if (target.has(id)) throw new Error(`duplicate key ${id}`);
    const created = { ...row, createdAt: new Date(), updatedAt: new Date() };
    target.set(id, created);
    return created;
  };

  Object.assign(stores, {
    sourceFeeds: {
      getById: vi.fn().mockResolvedValue({ id: 'feed-1', sourceSystemId: 'src-sys-1' }),
    },
    canonicalOrganizations: {
      create: vi.fn().mockImplementation((row) => createUnique(organizations, row)),
    },
    canonicalServices: {
      create: vi.fn().mockImplementation((row) => createUnique(services, row)),
    },
    canonicalLocations: {
      create: vi.fn().mockImplementation((row) => createUnique(locations, row)),
    },
    canonicalServiceLocations: {
      bulkCreate: vi.fn().mockImplementation((rows) => rows.map(
        (row: Record<string, unknown>) => createUnique(serviceLocations, row),
      )),
    },
    canonicalProvenance: {
      bulkCreate: vi.fn().mockImplementation((rows) => {
        if (failNextProvenanceWrite) {
          failNextProvenanceWrite = false;
          throw new Error('provenance write failed');
        }
        for (const row of rows) createUnique(provenance, row);
      }),
    },
    sourceRecords: {
      claimPendingForNormalization: vi.fn().mockImplementation(async (expected) => {
        const sourceRecord = {
          ...expected,
          processingStatus,
          rawPayload: {},
          parsedPayload: {},
          sourceConfidenceSignals: {},
          fetchedAt: new Date(),
          createdAt: new Date(),
        };
        if (processingStatus !== 'pending') {
          return { claimed: false, sourceRecord };
        }
        processingStatus = 'processing';
        return {
          claimed: true,
          sourceRecord: { ...sourceRecord, processingStatus: 'processing' },
        };
      }),
      updateStatus: vi.fn().mockImplementation(async (_id, status) => {
        processingStatus = status;
      }),
    },
  });

  return Object.assign(stores, {
    testState: {
      organizations,
      services,
      locations,
      serviceLocations,
      provenance,
      get processingStatus() { return processingStatus; },
      failNextProvenanceWrite() { failNextProvenanceWrite = true; },
    },
  });
}

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('normalizeSourceRecord', () => {
  it('creates canonical org, service, location, links, and provenance atomically', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord();

    const result = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
      trustTier: 'curated',
    });

    expect(result.canonicalOrganizationId).toMatch(UUID_V5);
    expect(result.canonicalServiceIds).toHaveLength(1);
    expect(result.canonicalLocationIds).toHaveLength(1);
    expect(result.provenanceRecordsCreated).toBeGreaterThan(0);
    expect(stores.runAtomically).toHaveBeenCalledTimes(1);

    expect(stores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.canonicalOrganizationId,
        name: 'Community Aid',
        description: 'Helps people.',
        lifecycleStatus: 'active',
        publicationStatus: 'unpublished',
        winningSourceSystemId: 'src-sys-1',
      }),
    );
    expect(stores.canonicalServices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.canonicalServiceIds[0],
        canonicalOrganizationId: result.canonicalOrganizationId,
        name: 'Food Bank',
        description: 'Free groceries.',
        fees: 'None',
        winningSourceSystemId: 'src-sys-1',
      }),
    );
    expect(stores.canonicalLocations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.canonicalLocationIds[0],
        canonicalOrganizationId: result.canonicalOrganizationId,
        name: 'Downtown Office',
        latitude: 47.6,
        longitude: -122.3,
        addressLine1: '100 Pine St',
        addressCity: 'Seattle',
        sourceConfidenceSummary: { overall: 75 },
      }),
    );
    expect(stores.canonicalServiceLocations.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({
        id: expect.stringMatching(UUID_V5),
        canonicalServiceId: result.canonicalServiceIds[0],
        canonicalLocationId: result.canonicalLocationIds[0],
      }),
    ]);
    expect(stores.canonicalProvenance.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(UUID_V5),
          canonicalEntityType: 'organization',
          canonicalEntityId: result.canonicalOrganizationId,
          sourceRecordId: 'sr-1',
          fieldName: 'name',
          decidedBy: 'normalization-bridge',
          decisionStatus: 'accepted',
        }),
      ]),
    );
    expect(stores.sourceRecords.updateStatus).toHaveBeenCalledWith('sr-1', 'normalized');
  });

  it('handles flat payload without nested entity keys', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord({
      organization: undefined,
      services: undefined,
      locations: undefined,
      name: 'Direct Org',
    });

    const result = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    });

    expect(stores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Direct Org' }),
    );
    expect(stores.canonicalServices.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Direct Org' }),
    );
    expect(result.canonicalLocationIds).toHaveLength(0);
  });

  it('rejects records without an organization name before claiming them', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord({
      organization: { description: 'No name' },
      services: [],
      locations: [],
    });

    await expect(normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    })).rejects.toThrow('has no organization name');
    expect(stores.sourceRecords.claimPendingForNormalization).not.toHaveBeenCalled();
  });

  it('applies configured and default trust confidence', async () => {
    const verifiedStores = createMockStores();
    await normalizeSourceRecord({
      stores: verifiedStores as never,
      sourceRecord: buildSourceRecord() as never,
      trustTier: 'verified_publisher',
    });
    expect(verifiedStores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceConfidenceSummary: { overall: 90 } }),
    );

    const defaultStores = createMockStores();
    await normalizeSourceRecord({
      stores: defaultStores as never,
      sourceRecord: buildSourceRecord() as never,
    });
    expect(defaultStores.canonicalOrganizations.create).toHaveBeenCalledWith(
      expect.objectContaining({ sourceConfidenceSummary: { overall: 50 } }),
    );
  });

  it('rolls back the claim and all canonical writes, then retries with identical IDs', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord();
    stores.testState.failNextProvenanceWrite();

    await expect(normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    })).rejects.toThrow('provenance write failed');

    const firstAttemptOrgId = stores.canonicalOrganizations.create.mock.calls[0][0].id;
    expect(stores.testState.processingStatus).toBe('pending');
    expect(stores.testState.organizations.size).toBe(0);
    expect(stores.testState.services.size).toBe(0);
    expect(stores.testState.locations.size).toBe(0);
    expect(stores.testState.serviceLocations.size).toBe(0);
    expect(stores.testState.provenance.size).toBe(0);

    const retry = await normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: record as never,
    });

    expect(retry.canonicalOrganizationId).toBe(firstAttemptOrgId);
    expect(stores.canonicalOrganizations.create.mock.calls[1][0].id).toBe(firstAttemptOrgId);
    expect(stores.testState.processingStatus).toBe('normalized');
    expect(stores.testState.organizations.size).toBe(1);
    expect(stores.testState.services.size).toBe(1);
    expect(stores.testState.locations.size).toBe(1);
  });

  it('serializes concurrent attempts and materializes each entity only once', async () => {
    const stores = createMockStores();
    const record = buildSourceRecord();

    const [first, second] = await Promise.all([
      normalizeSourceRecord({ stores: stores as never, sourceRecord: record as never }),
      normalizeSourceRecord({ stores: stores as never, sourceRecord: record as never }),
    ]);

    expect(second).toEqual(first);
    expect(stores.sourceRecords.claimPendingForNormalization).toHaveBeenCalledTimes(2);
    expect(stores.canonicalOrganizations.create).toHaveBeenCalledTimes(1);
    expect(stores.canonicalServices.create).toHaveBeenCalledTimes(1);
    expect(stores.canonicalLocations.create).toHaveBeenCalledTimes(1);
    expect(stores.canonicalProvenance.bulkCreate).toHaveBeenCalledTimes(1);
    expect(stores.sourceRecords.updateStatus).toHaveBeenCalledTimes(1);
  });

  it('fails closed when atomic transaction support is unavailable', async () => {
    const stores = createMockStores();
    delete stores.runAtomically;

    await expect(normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: buildSourceRecord() as never,
    })).rejects.toThrow('requires an atomic multi-store transaction');
    expect(stores.canonicalOrganizations.create).not.toHaveBeenCalled();
  });

  it('rejects records whose source feed cannot be resolved and rolls back the claim', async () => {
    const stores = createMockStores();
    stores.sourceFeeds.getById.mockResolvedValueOnce(null);

    await expect(normalizeSourceRecord({
      stores: stores as never,
      sourceRecord: buildSourceRecord() as never,
    })).rejects.toThrow('references missing source feed');
    expect(stores.testState.processingStatus).toBe('pending');
  });

  it('handles multiple services and locations with deterministic junction IDs', async () => {
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
    expect(stores.testState.serviceLocations.size).toBe(4);
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
