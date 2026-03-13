import { describe, expect, it, vi } from 'vitest';

import { pollHsdsFeed } from '../hsdsFeedConnector';

function buildSourceSystem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sys-1',
    name: 'Open Referral Test',
    family: 'hsds',
    homepageUrl: null,
    licenseNotes: 'CC-BY-4.0',
    termsUrl: null,
    trustTier: 'curated',
    hsdsProfileUri: null,
    domainRules: [],
    crawlPolicy: {},
    jurisdictionScope: {},
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
    id: 'feed-1',
    sourceSystemId: 'sys-1',
    feedName: 'Test HSDS Feed',
    feedType: 'hsds_api',
    feedHandler: 'hsds_api',
    baseUrl: 'https://api.example.org/hsds',
    healthcheckUrl: null,
    authType: 'none',
    profileUri: null,
    jurisdictionScope: {},
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
    },
    sourceFeeds: {
      updateAfterPoll: vi.fn(),
    },
  };
}

describe('pollHsdsFeed', () => {
  it('fetches organizations and services from HSDS API', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { id: 'org-1', name: 'Acme', description: 'Nonprofit' },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { id: 'svc-1', name: 'Food Bank', organization_id: 'org-1' },
          { id: 'svc-2', name: 'Housing Aid', organization_id: 'org-1' },
        ]),
      });

    const result = await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      correlationId: 'poll-001',
    });

    expect(result.recordsCreated).toBe(3); // 1 org + 2 services
    expect(result.recordsSkippedDuplicate).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Verify fetch calls
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.org/hsds/organizations',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.org/hsds/services',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );

    // Source record created with correct type
    expect(stores.sourceRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRecordType: 'organization',
        sourceRecordId: 'org-1',
        correlationId: 'poll-001',
      }),
    );
    expect(stores.sourceRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRecordType: 'service',
        sourceRecordId: 'svc-1',
      }),
    );

    // Feed poll updated
    expect(stores.sourceFeeds.updateAfterPoll).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({ errorCount: 0 }),
    );
  });

  it('skips duplicate records based on payload hash', async () => {
    const stores = createMockStores();
    stores.sourceRecords.findByDedup
      .mockResolvedValueOnce({ id: 'existing' }) // org duplicate
      .mockResolvedValueOnce(null); // service new

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'org-1', name: 'Acme' }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'svc-1', name: 'Pantry' }]),
      });

    const result = await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
    });

    expect(result.recordsCreated).toBe(1);
    expect(result.recordsSkippedDuplicate).toBe(1);
  });

  it('handles API errors gracefully and records them', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const result = await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      maxRetries: 0,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('500');
    expect(result.recordsCreated).toBe(0);

    // Feed poll recorded error
    expect(stores.sourceFeeds.updateAfterPoll).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        lastError: expect.stringContaining('500'),
        errorCount: 1,
      }),
    );
  });

  it('handles HSDS v3 { contents: [...] } response format', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ contents: [{ id: 'org-1', name: 'Test' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'svc-1', name: 'Test Svc' }] }),
      });

    const result = await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
    });

    expect(result.recordsCreated).toBe(2);
  });

  it('handles network errors per endpoint without aborting', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'svc-1', name: 'Pantry' }]),
      });

    const result = await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      maxRetries: 0,
      fetchFn: fetchMock as never,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Network timeout');
    expect(result.recordsCreated).toBe(1); // services still works
  });

  it('propagates source system trust tier in confidence signals', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'o1', name: 'X' }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem({ trustTier: 'verified_publisher' }) as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
    });

    expect(stores.sourceRecords.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConfidenceSignals: { trustTier: 'verified_publisher', family: 'hsds' },
      }),
    );
  });

  it('handles malformed JSON response gracefully', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'svc-1', name: 'Valid' }]),
      });

    const result = await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('invalid JSON');
    expect(result.recordsCreated).toBe(1);
  });

  it('retries transient 5xx errors with backoff (R5)', async () => {
    const stores = createMockStores();
    const fetchMock = vi.fn()
      // /organizations: fail once (500), succeed on retry
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'org-retry', name: 'Retry Org' }]),
      })
      // /services: succeed first time
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

    const result = await pollHsdsFeed({
      stores: stores as never,
      sourceSystem: buildSourceSystem() as never,
      feed: buildFeed() as never,
      fetchFn: fetchMock as never,
      maxRetries: 1,
    });

    // The retry succeeded, so no errors
    expect(result.errors).toHaveLength(0);
    expect(result.recordsCreated).toBe(1);
    // fetchMock called 3 times: 1st fail + 1st retry + /services
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
