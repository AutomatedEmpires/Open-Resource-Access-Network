import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
const executeQueryMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const getDrizzleMock = vi.hoisted(() => vi.fn());
const storeFactoryMocks = vi.hoisted(() => ({
  createIngestionStores: vi.fn(),
}));

const stores = vi.hoisted(() => ({
  publishReadiness: {
    meetsThreshold: vi.fn(),
    getReadiness: vi.fn(),
  },
  candidates: {
    markPublished: vi.fn(),
  },
  links: {
    transferToService: vi.fn(),
  },
  assignments: {
    withdrawAllForCandidate: vi.fn(),
  },
  audit: {
    append: vi.fn(),
  },
  llmSuggestions: {
    listForCandidate: vi.fn(),
    getAcceptedValues: vi.fn(),
    updateDecision: vi.fn(),
  },
  tagConfirmations: {
    listForCandidate: vi.fn(),
    countPendingByTier: vi.fn(),
    updateDecision: vi.fn(),
  },
}));

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: dbConfigMock,
  executeQuery: executeQueryMock,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));
vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: getDrizzleMock,
}));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => storeFactoryMocks);

function createRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL('https://oran.test');
  const headers = new Headers();

  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    nextUrl: url,
    url: url.toString(),
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function createRouteContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as never;
}

async function loadPublishRoute() {
  return import('../candidates/[id]/publish/route');
}

async function loadReadinessRoute() {
  return import('../candidates/[id]/readiness/route');
}

async function loadSuggestionsRoute() {
  return import('../candidates/[id]/suggestions/route');
}

async function loadTagsRoute() {
  return import('../candidates/[id]/tags/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbConfigMock.mockReturnValue(true);
  executeQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  getDrizzleMock.mockReturnValue({ kind: 'db' });
  storeFactoryMocks.createIngestionStores.mockReturnValue(stores);

  stores.publishReadiness.meetsThreshold.mockResolvedValue(true);
  stores.publishReadiness.getReadiness.mockResolvedValue({
    score: 82,
    thresholdMet: true,
  });
  stores.candidates.markPublished.mockResolvedValue(undefined);
  stores.links.transferToService.mockResolvedValue(undefined);
  stores.assignments.withdrawAllForCandidate.mockResolvedValue(2);
  stores.audit.append.mockResolvedValue(undefined);
  stores.llmSuggestions.listForCandidate.mockResolvedValue([]);
  stores.llmSuggestions.getAcceptedValues.mockResolvedValue(new Map());
  stores.llmSuggestions.updateDecision.mockResolvedValue(undefined);
  stores.tagConfirmations.listForCandidate.mockResolvedValue([]);
  stores.tagConfirmations.countPendingByTier.mockResolvedValue({
    green: 1,
    orange: 0,
    red: 0,
  });
  stores.tagConfirmations.updateDecision.mockResolvedValue(undefined);
});

describe('admin ingestion candidate action routes', () => {
  it('blocks publishing when readiness does not meet threshold', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    stores.publishReadiness.meetsThreshold.mockResolvedValueOnce(false);
    stores.publishReadiness.getReadiness.mockResolvedValueOnce({
      score: 40,
      thresholdMet: false,
      reasons: ['missing tags'],
    });
    const { POST } = await loadPublishRoute();

    const response = await POST(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(422);
    expect(stores.candidates.markPublished).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'Candidate does not meet publish threshold.',
      readiness: {
        score: 40,
        thresholdMet: false,
        reasons: ['missing tags'],
      },
    });
  });

  it('publishes a ready candidate and writes side effects', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('service-id')
      .mockReturnValueOnce('event-id')
      .mockReturnValueOnce('corr-id');
    const { POST } = await loadPublishRoute();

    const response = await POST(
      createRequest({ ip: '198.51.100.33' }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(rateLimitMock).toHaveBeenCalledWith('198.51.100.33', expect.any(Object));
    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(stores.candidates.markPublished).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'service-id',
      'oran-1',
    );
    expect(stores.links.transferToService).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'service-id',
    );
    expect(stores.assignments.withdrawAllForCandidate).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-id',
        correlationId: 'corr-id',
        outputs: { serviceId: 'service-id' },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      serviceId: 'service-id',
    });

    uuidSpy.mockRestore();
  });

  it('returns readiness for community admins and 404 when missing', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { GET } = await loadReadinessRoute();

    const okResponse = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(requireMinRoleMock).toHaveBeenCalledWith(
      { userId: 'community-1' },
      'community_admin',
    );
    expect(okResponse.status).toBe(200);
    await expect(okResponse.json()).resolves.toEqual({
      readiness: {
        score: 82,
        thresholdMet: true,
      },
    });

    stores.publishReadiness.getReadiness.mockResolvedValueOnce(null);

    const notFoundResponse = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(notFoundResponse.status).toBe(404);
    await expect(notFoundResponse.json()).resolves.toEqual({
      error: 'Readiness data not found for candidate.',
    });
  });

  it('lists suggestions with accepted values and updates suggestion decisions', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    stores.llmSuggestions.listForCandidate.mockResolvedValueOnce([
      { id: 'suggest-1', field: 'name' },
    ]);
    stores.llmSuggestions.getAcceptedValues.mockResolvedValueOnce(
      new Map([
        ['name', 'Updated Name'],
        ['description', 'Updated Description'],
      ]),
    );
    const { GET, PUT } = await loadSuggestionsRoute();

    const listResponse = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      suggestions: [{ id: 'suggest-1', field: 'name' }],
      acceptedValues: {
        name: 'Updated Name',
        description: 'Updated Description',
      },
    });

    const updateResponse = await PUT(
      createRequest({
        jsonBody: {
          suggestionId: '22222222-2222-4222-8222-222222222222',
          status: 'modified',
          acceptedValue: 'Edited value',
          notes: 'Reviewed by admin',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(stores.llmSuggestions.updateDecision).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'modified',
      'Edited value',
      'community-1',
      'Reviewed by admin',
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toEqual({
      success: true,
    });
  });

  it('validates suggestion update payloads', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { PUT } = await loadSuggestionsRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          suggestionId: 'bad-id',
          status: 'accepted',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(400);
    expect(stores.llmSuggestions.updateDecision).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe('Invalid input.');
  });

  it('lists tag confirmations and updates decisions', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    stores.tagConfirmations.listForCandidate.mockResolvedValueOnce([
      { id: 'confirm-1', proposedTag: 'food' },
    ]);
    stores.tagConfirmations.countPendingByTier.mockResolvedValueOnce({
      green: 2,
      orange: 1,
      red: 0,
    });
    const { GET, PUT } = await loadTagsRoute();

    const listResponse = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      confirmations: [{ id: 'confirm-1', proposedTag: 'food' }],
      pendingByTier: {
        green: 2,
        orange: 1,
        red: 0,
      },
    });

    const updateResponse = await PUT(
      createRequest({
        jsonBody: {
          confirmationId: '33333333-3333-4333-8333-333333333333',
          status: 'confirmed',
          confirmedValue: 'food_assistance',
          notes: 'Exact taxonomy match',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(stores.tagConfirmations.updateDecision).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'confirmed',
      'food_assistance',
      undefined,
      'community-1',
      'Exact taxonomy match',
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toEqual({
      success: true,
    });
  });

  it('captures tag route exceptions and returns 500', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    stores.tagConfirmations.listForCandidate.mockRejectedValueOnce(new Error('store failed'));
    const { GET } = await loadTagsRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error.',
    });
  });
});
