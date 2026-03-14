import { describe, expect, it, vi } from 'vitest';

import { poll211NdpFeed } from '../ndp211Connector';
import type { Ndp211Organization } from '../ndp211Types';

// ── Test Fixtures ─────────────────────────────────────────────

const SAMPLE_211_ORG: Ndp211Organization = {
  id: '211montere-4491382',
  name: 'United States Department Of Veterans Affairs (VA), Palo Alto Division',
  alternateNames: ['VAPAHCS'],
  description: 'A federal agency providing inpatient and outpatient healthcare services for veterans.',
  url: 'https://www.paloalto.va.gov',
  email: 'contact@paloalto.va.gov',
  yearIncorporated: 2014,
  taxStatus: null,
  taxId: null,
  legalStatus: 'government',
  funding: null,
  contacts: [],
  phones: [{
    id: '1631926135174452576',
    name: 'Main Number',
    type: 'main',
    number: '(123) 456-7890',
    extension: '123',
    description: 'Main number is for general public',
    isMain: true,
    access: 'public',
  }],
  services: [{
    id: '211montere-4491387',
    idProgram: null,
    idOrganization: '211montere-4491382',
    name: 'Outpatient Health Services',
    alternateNames: ['OHS'],
    description: 'Operates outpatient primary and medical care clinics for veterans.',
    contacts: [],
    phones: [{
      id: '1631926135174452576',
      name: 'Main Number',
      type: 'main',
      number: '(123) 456-7890',
      extension: null,
      description: null,
      isMain: true,
      access: 'public',
    }],
    schedules: [{
      id: '5234566234562346534',
      type: 'regular',
      validFrom: '2026-01-20T05:06:15Z',
      validTo: '2026-03-11T05:06:15Z',
      open: [{ day: 'mon', opensAt: '09:00', closesAt: '17:00' }],
      description: 'Open Monday',
    }],
    taxonomy: [{
      id: '1804717539083665810',
      taxonomyTerm: 'Diabetes Screening',
      taxonomyCode: 'LF-4900.1700',
      taxonomyTermLevel1: 'Health Care',
      taxonomyTermLevel2: 'Health Screening/Diagnostic Services',
      taxonomyTermLevel3: null,
      taxonomyTermLevel4: null,
      taxonomyTermLevel5: null,
      taxonomyTermLevel6: null,
      targets: [{ code: 'Y-1200', term: 'Youth' }],
    }],
    applicationProcess: 'Sign up online before arrival',
    interpretationServices: 'By registration only',
    email: 'screening@program.com',
    url: 'https://callformoreinfo.com',
    waitTime: null,
    fees: { type: 'no_fee', description: 'Paid through VA benefits' },
    accreditations: [],
    licenses: [],
    languages: { description: 'English or Spanish', codes: ['english', 'spanish'] },
    funding: null,
    eligibility: { description: 'Veterans for life', types: ['veteran', 'disability'] },
    serviceAreas: [{
      id: '5777975716727595897',
      type: 'county',
      value: 'Monterey, California, United States',
      geoJson: null,
      geoComponents: [{ postalCode: null, locality: null, county: 'Monterey', state: 'California', country: 'United States' }],
    }],
    documents: { description: 'Bring veterans card', types: ['drivers_license'] },
    locationIds: ['211montere-4491386'],
    meta: {
      idResource: '211montere-4491382',
      tags: ['veterans'],
      access: 'public',
      status: 'active',
      reasonInactive: null,
      lastUpdated: '2026-01-10',
      lastVerified: '2025-10-12',
      created: '2023-04-26',
      temporaryMessage: null,
    },
  }],
  programs: [],
  locations: [{
    id: '211montere-4491386',
    idOrganization: '211montere-4491382',
    name: 'Marina Outpatient Clinic',
    alternateNames: ['MOC'],
    description: 'Full services for all veterans',
    contacts: [],
    phones: [],
    schedules: [],
    longitude: -121.813597,
    latitude: 36.662565,
    addresses: [{
      id: '3142310592743643694',
      type: 'physical',
      postalCode: '93933',
      street: '201 Ninth Street',
      city: 'Marina',
      county: 'Monterey',
      state: 'CA',
      country: 'United States',
      geocode: null,
      description: null,
      access: 'public',
    }],
    accessibility: { description: 'Wheelchair accessible', types: 'wheel_chair_access' },
    transportation: null,
    languages: { description: 'English or Spanish', codes: ['english', 'spanish'] },
    url: 'https://www.test.com',
    email: 'noreply@email.com',
    serviceIds: ['211montere-4491387'],
    meta: {
      idResource: '211montere-4491386',
      tags: ['veteran center'],
      access: 'public',
      status: 'active',
      reasonInactive: null,
      lastUpdated: '2026-01-10',
      lastVerified: '2025-10-12',
      created: '2023-04-26',
      temporaryMessage: null,
    },
  }],
  servicesAtLocations: [{
    id: '211montere-4491394',
    idOrganization: '211montere-4491382',
    idService: '211montere-4491387',
    idLocation: '211montere-4491386',
    contacts: [],
    phones: [],
    schedules: [],
    url: null,
    email: null,
    meta: null,
  }],
  meta: null,
  dataOwner: '211monterey',
  dataOwnerDisplayName: '211 Monterey',
  dataSteward: '211datasteward',
  dataStewardDisplayName: '211 Data Steward Display Name',
};

function buildSourceSystem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sys-211',
    name: '211 Monterey',
    family: 'partner_api',
    homepageUrl: null,
    licenseNotes: '211 NDP Data Sharing Agreement',
    termsUrl: null,
    trustTier: 'trusted_partner',
    hsdsProfileUri: null,
    domainRules: [],
    crawlPolicy: {},
    jurisdictionScope: { state: 'CA', county: 'Monterey' },
    contactInfo: {},
    isActive: true,
    notes: null,
    legacyIngestionSourceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildFeed(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feed-211',
    sourceSystemId: 'sys-211',
    feedName: '211 NDP Export V2',
    feedType: 'api',
    feedHandler: 'ndp_211',
    baseUrl: 'https://api.211.org/resources/v2',
    healthcheckUrl: null,
    authType: 'api_key',
    profileUri: null,
    jurisdictionScope: { state: 'CA' },
    refreshIntervalHours: 24,
    lastPolledAt: null,
    lastSuccessAt: null,
    lastError: null,
    errorCount: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockStores() {
  return {
    sourceRecords: {
      findByDedup: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((row) => ({
        id: `sr-${Math.random().toString(36).slice(2, 8)}`,
        ...row,
      })),
      addTaxonomy: vi.fn().mockResolvedValue(undefined),
    },
    sourceFeeds: {
      updateAfterPoll: vi.fn().mockResolvedValue(undefined),
    },
    sourceFeedStates: {
      getByFeedId: vi.fn().mockResolvedValue({
        sourceFeedId: 'feed-211',
        checkpointCursor: '0',
        replayFromCursor: null,
      }),
      update: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('poll211NdpFeed', () => {
  it('fetches and decomposes an organization bundle into child source records', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      // Search endpoint returns org IDs
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: '211montere-4491382' }]),
      })
      // Export endpoint returns org bundle
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([SAMPLE_211_ORG]),
      });

    const result = await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      correlationId: 'poll-211-001',
      subscriptionKey: 'test-key-abc',
    });

    // 1 bundle + 1 org + 1 service + 1 location + 1 service_at_location = 5
    expect(result.recordsCreated).toBe(5);
    expect(result.recordsSkippedDuplicate).toBe(0);
    expect(result.organizationBundlesFetched).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify fetch was called with subscription key header
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('search'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Ocp-Apim-Subscription-Key': 'test-key-abc',
        }),
      }),
    );

    // Verify correct source record types were created
    const createCalls = stores.sourceRecords.create.mock.calls;
    const types = createCalls.map((c: unknown[]) => (c[0] as Record<string, string>).sourceRecordType);
    expect(types).toContain('organization_bundle');
    expect(types).toContain('organization');
    expect(types).toContain('service');
    expect(types).toContain('location');
    expect(types).toContain('service_at_location');

    // Verify taxonomy was attached
    expect(stores.sourceRecords.addTaxonomy).toHaveBeenCalled();
    expect(result.taxonomyCodesAttached).toBe(1);
    expect(stores.sourceFeedStates.update).toHaveBeenCalledWith(
      'feed-211',
      expect.objectContaining({ checkpointCursor: '0', replayFromCursor: null }),
    );
  });

  it('replays the same discovered batch after a failed export fetch', async () => {
    const stores = createMockStores();
    stores.sourceFeedStates.getByFeedId.mockResolvedValueOnce({
      sourceFeedId: 'feed-211',
      checkpointCursor: '1',
      replayFromCursor: null,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'org-1' }, { id: 'org-2' }, { id: 'org-3' }]),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

    const result = await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      correlationId: 'poll-211-002',
      subscriptionKey: 'test-key-abc',
      maxOrganizations: 1,
    });

    expect(result.errors).not.toHaveLength(0);
    expect(stores.sourceFeedStates.update).toHaveBeenCalledWith(
      'feed-211',
      expect.objectContaining({ checkpointCursor: '1', replayFromCursor: '1' }),
    );
  });

  it('uses explicit organization IDs when provided', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([SAMPLE_211_ORG]),
      });

    const result = await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: ['211montere-4491382'],
    });

    // Should NOT call search endpoint, only export
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('export/organizations/211montere-4491382'),
      expect.any(Object),
    );

    expect(result.organizationBundlesFetched).toBe(1);
    expect(result.recordsCreated).toBe(5);
  });

  it('handles duplicate records via payload hash dedup', async () => {
    const stores = createMockStores();
    // Make all records appear as duplicates
    stores.sourceRecords.findByDedup.mockResolvedValue({ id: 'existing' });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([SAMPLE_211_ORG]),
      });

    const result = await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: ['211montere-4491382'],
    });

    expect(result.recordsCreated).toBe(0);
    expect(result.recordsSkippedDuplicate).toBe(5);
  });

  it('handles API errors gracefully', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: ['nonexistent-id'],
      maxRetries: 0,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('404');
    expect(result.recordsCreated).toBe(0);

    // Feed poll should record error
    expect(stores.sourceFeeds.updateAfterPoll).toHaveBeenCalledWith(
      'feed-211',
      expect.objectContaining({
        lastError: expect.stringContaining('404'),
        errorCount: 1,
      }),
    );
  });

  it('handles invalid org data with validation error', async () => {
    const stores = createMockStores();
    const invalidOrg = { description: 'no name or id' }; // Missing required fields

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([invalidOrg]),
      });

    const result = await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: ['bad-org'],
      maxRetries: 0,
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('validation failed');
    expect(result.recordsCreated).toBe(0);
  });

  it('sends dataOwners header when provided', async () => {
    const stores = createMockStores();
    const simpleOrg: Ndp211Organization = {
      ...SAMPLE_211_ORG,
      services: [],
      locations: [],
      servicesAtLocations: [],
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([simpleOrg]),
      });

    await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: [simpleOrg.id],
      dataOwners: '211ventura,211monterey',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          dataOwners: '211ventura,211monterey',
        }),
      }),
    );
  });

  it('normalizes organization payload with HSDS-aligned keys', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([SAMPLE_211_ORG]),
      });

    await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: [SAMPLE_211_ORG.id],
    });

    // Find the organization child record creation
    const orgCreate = stores.sourceRecords.create.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, string>).sourceRecordType === 'organization',
    );
    expect(orgCreate).toBeDefined();

    const orgPayload = (orgCreate![0] as Record<string, unknown>).parsedPayload as Record<string, unknown>;
    expect(orgPayload).toMatchObject({
      name: SAMPLE_211_ORG.name,
      description: SAMPLE_211_ORG.description,
      url: SAMPLE_211_ORG.url,
      email: SAMPLE_211_ORG.email,
      phone: '(123) 456-7890',
      legal_status: 'government',
      _211_data_owner: '211monterey',
    });
  });

  it('normalizes service payload with fees and eligibility metadata', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([SAMPLE_211_ORG]),
      });

    await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: [SAMPLE_211_ORG.id],
    });

    const svcCreate = stores.sourceRecords.create.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, string>).sourceRecordType === 'service',
    );
    expect(svcCreate).toBeDefined();

    const svcPayload = (svcCreate![0] as Record<string, unknown>).parsedPayload as Record<string, unknown>;
    expect(svcPayload).toMatchObject({
      name: 'Outpatient Health Services',
      fees: 'Free',
      application_process: 'Sign up online before arrival',
      _211_eligibility: { description: 'Veterans for life', types: ['veteran', 'disability'] },
      _211_location_ids: ['211montere-4491386'],
    });
  });

  it('normalizes location payload with physical address extraction', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([SAMPLE_211_ORG]),
      });

    await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: [SAMPLE_211_ORG.id],
    });

    const locCreate = stores.sourceRecords.create.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, string>).sourceRecordType === 'location',
    );
    expect(locCreate).toBeDefined();

    const locPayload = (locCreate![0] as Record<string, unknown>).parsedPayload as Record<string, unknown>;
    expect(locPayload).toMatchObject({
      name: 'Marina Outpatient Clinic',
      latitude: 36.662565,
      longitude: -121.813597,
      address_1: '201 Ninth Street',
      city: 'Marina',
      region: 'CA',
      postal_code: '93933',
    });
  });

  it('respects maxOrganizations limit', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { id: 'org-1' }, { id: 'org-2' }, { id: 'org-3' },
        ]),
      })
      // Only first org should be fetched with maxOrganizations=1
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ ...SAMPLE_211_ORG, id: 'org-1', services: [], locations: [], servicesAtLocations: [] }]),
      });

    const result = await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      maxOrganizations: 1,
    });

    expect(result.organizationBundlesFetched).toBe(1);
    // 2 calls: 1 search + 1 export
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('updates feed poll status on success', async () => {
    const stores = createMockStores();
    const simpleOrg: Ndp211Organization = {
      ...SAMPLE_211_ORG,
      services: [],
      locations: [],
      servicesAtLocations: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([simpleOrg]),
      });

    await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: [simpleOrg.id],
    });

    expect(stores.sourceFeeds.updateAfterPoll).toHaveBeenCalledWith(
      'feed-211',
      expect.objectContaining({
        lastPolledAt: expect.any(String),
        lastSuccessAt: expect.any(String),
        errorCount: 0,
      }),
    );
  });

  it('attaches taxonomy rows using the DB-generated source record UUID, not the external ID', async () => {
    const stores = createMockStores();
    // Track the generated UUID for the service record
    let serviceRecordUuid: string | undefined;
    stores.sourceRecords.create.mockImplementation((row: Record<string, unknown>) => {
      const id = `sr-${Math.random().toString(36).slice(2, 8)}`;
      if (row.sourceRecordType === 'service') {
        serviceRecordUuid = id;
      }
      return { id, ...row };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([SAMPLE_211_ORG]),
      });

    await poll211NdpFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      organizationIds: [SAMPLE_211_ORG.id],
    });

    expect(serviceRecordUuid).toBeDefined();
    expect(stores.sourceRecords.addTaxonomy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRecordId: serviceRecordUuid,
          taxonomyName: 'airs_211',
          termCode: 'LF-4900.1700',
        }),
      ]),
    );
    // Verify it's NOT the external 211 ID
    const taxCall = stores.sourceRecords.addTaxonomy.mock.calls[0][0];
    expect(taxCall[0].sourceRecordId).not.toBe('211montere-4491387');
  });
});
