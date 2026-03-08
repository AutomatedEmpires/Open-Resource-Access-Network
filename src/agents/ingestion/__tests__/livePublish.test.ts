import { beforeEach, describe, expect, it, vi } from 'vitest';

const withTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  withTransaction: withTransactionMock,
}));

async function loadModule() {
  return import('../livePublish');
}

function createStores() {
  return {
    candidates: {
      getById: vi.fn(),
    },
    publishReadiness: {
      getReadiness: vi.fn(),
    },
    llmSuggestions: {
      getAcceptedValues: vi.fn(),
    },
    tags: {
      listFor: vi.fn(),
    },
    tagConfirmations: {
      listConfirmed: vi.fn(),
    },
  };
}

function buildCandidate() {
  return {
    candidateId: 'cand-1',
    fields: {
      organizationName: 'Example Community Action',
      serviceName: 'Pantry Program',
      description: 'Emergency pantry support.',
      websiteUrl: 'https://example.gov/pantry',
      phone: '(206) 555-0100',
      address: {
        line1: '123 Main St',
        city: 'Seattle',
        region: 'WA',
        postalCode: '98101',
        country: 'US',
      },
      isRemoteService: false,
    },
  };
}

describe('publishCandidateToLiveService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('materializes a published candidate into the live seeker tables and HSDS snapshot', async () => {
    const stores = createStores();
    const clientQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    withTransactionMock.mockImplementation(async (callback) =>
      callback({ query: clientQueryMock } as never),
    );

    stores.candidates.getById.mockResolvedValue(buildCandidate());
    stores.publishReadiness.getReadiness.mockResolvedValue({ confidenceScore: 88 });
    stores.llmSuggestions.getAcceptedValues.mockResolvedValue(
      new Map([
        ['name', 'Pantry Program Updated'],
        ['description', 'Updated pantry description.'],
        ['intake_process', 'Walk in during open hours.'],
      ]),
    );
    stores.tags.listFor.mockResolvedValue([
      {
        candidateId: 'cand-1',
        tagType: 'category',
        tagValue: 'food',
        tagConfidence: 96,
        assignedBy: 'agent',
      },
      {
        candidateId: 'cand-1',
        tagType: 'geographic',
        tagValue: 'us_wa_seattle',
        tagConfidence: 100,
        assignedBy: 'system',
      },
    ]);
    stores.tagConfirmations.listConfirmed.mockResolvedValue([]);

    const geocodeMock = vi.fn().mockResolvedValue([
      {
        lat: 47.62,
        lon: -122.33,
        formattedAddress: '123 Main St, Seattle, WA',
        confidence: 'High',
      },
    ]);

    const { publishCandidateToLiveService } = await loadModule();
    const result = await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
      geocode: geocodeMock,
    });

    expect(geocodeMock).toHaveBeenCalledWith('123 Main St, Seattle, WA, 98101, US');
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO organizations'),
      expect.arrayContaining(['Example Community Action']),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO services'),
      expect.arrayContaining(['Pantry Program Updated', 'Walk in during open hours.']),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO service_attributes'),
      expect.arrayContaining(['delivery', 'in_person', 'delivery', 'phone']),
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO hsds_export_snapshots'),
      [
        expect.any(String),
        1,
        expect.stringContaining('"sourceCandidateId":"cand-1"'),
        'https://openreferral.org/imls/hsds/',
      ],
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE extracted_candidates'),
      [
        'cand-1',
        expect.stringContaining('"geocodedLat":47.62'),
      ],
    );
    expect(result).toEqual({
      serviceId: expect.any(String),
      organizationId: expect.any(String),
      locationId: expect.any(String),
    });
  });

  it('fails open on geocoding errors and still publishes', async () => {
    const stores = createStores();
    const clientQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    withTransactionMock.mockImplementation(async (callback) =>
      callback({ query: clientQueryMock } as never),
    );

    stores.candidates.getById.mockResolvedValue(buildCandidate());
    stores.publishReadiness.getReadiness.mockResolvedValue({ confidenceScore: 72 });
    stores.llmSuggestions.getAcceptedValues.mockResolvedValue(new Map());
    stores.tags.listFor.mockResolvedValue([]);
    stores.tagConfirmations.listConfirmed.mockResolvedValue([]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const geocodeMock = vi.fn().mockRejectedValue(new Error('maps down'));

    const { publishCandidateToLiveService } = await loadModule();
    const result = await publishCandidateToLiveService({
      stores: stores as never,
      candidateId: 'cand-1',
      publishedByUserId: 'oran-1',
      geocode: geocodeMock,
    });

    expect(warnSpy).toHaveBeenCalledWith('[publish] Geocoding failed (non-fatal):', 'maps down');
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO locations'),
      [expect.any(String), expect.any(String), 'Pantry Program', null, null],
    );
    expect(
      clientQueryMock.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('investigation_pack'),
      ),
    ).toBe(false);
    expect(result.serviceId).toEqual(expect.any(String));

    warnSpy.mockRestore();
  });
});
