import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const getDrizzleMock = vi.hoisted(() => vi.fn());
const storeFactoryMocks = vi.hoisted(() => ({
  createIngestionStores: vi.fn(),
}));
const geocodingMocks = vi.hoisted(() => ({
  geocode: vi.fn(),
  isConfigured: vi.fn(),
}));
const livePublishMocks = vi.hoisted(() => ({
  publishCandidateToLiveService: vi.fn(),
}));
const executeQueryMock = vi.hoisted(() => vi.fn());

const stores = vi.hoisted(() => ({
  publishReadiness: {
    meetsThreshold: vi.fn(),
    getReadiness: vi.fn(),
  },
  candidates: {
    getById: vi.fn(),
  },
  audit: {
    append: vi.fn(),
  },
  llmSuggestions: {
    listForCandidate: vi.fn(),
    getById: vi.fn(),
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
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
  requireRole: requireRoleMock,
}));
vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: getDrizzleMock,
}));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => storeFactoryMocks);
vi.mock('@/services/geocoding/azureMaps', () => geocodingMocks);
vi.mock('@/agents/ingestion/livePublish', () => livePublishMocks);

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
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  requireRoleMock.mockReturnValue(true);
  getDrizzleMock.mockReturnValue({ kind: 'db' });
  storeFactoryMocks.createIngestionStores.mockReturnValue(stores);

  stores.publishReadiness.meetsThreshold.mockResolvedValue(true);
  stores.publishReadiness.getReadiness.mockResolvedValue({
    score: 82,
    thresholdMet: true,
  });
  stores.candidates.getById.mockResolvedValue(null);
  stores.audit.append.mockResolvedValue(undefined);
  stores.llmSuggestions.listForCandidate.mockResolvedValue([]);
  stores.llmSuggestions.getById.mockResolvedValue({
    id: '22222222-2222-4222-8222-222222222222',
    candidateId: '11111111-1111-4111-8111-111111111111',
    fieldName: 'name',
    suggestedValue: 'Valid service name',
  });
  stores.llmSuggestions.getAcceptedValues.mockResolvedValue(new Map());
  stores.llmSuggestions.updateDecision.mockResolvedValue('updated');
  stores.tagConfirmations.listForCandidate.mockResolvedValue([]);
  stores.tagConfirmations.countPendingByTier.mockResolvedValue({
    green: 1,
    orange: 0,
    red: 0,
  });
  stores.tagConfirmations.updateDecision.mockResolvedValue('updated');
  executeQueryMock.mockImplementation((statement: string) => {
    const sql = String(statement);
    if (sql.includes('SELECT assignment.id')) {
      return Promise.resolve([{
        id: 'assignment-own', status: 'claimed', outcome: null, expires_at: null,
      }]);
    }
    if (sql.includes('public.evaluate_candidate_readiness')) {
      return Promise.resolve([{ is_ready: false }]);
    }
    if (sql.includes('readiness.has_required_fields')) {
      return Promise.resolve([{
        has_required_fields: true,
        has_required_tags: true,
        tags_confirmed: true,
        meets_score_threshold: true,
        blockers: ['Need 2 admin approvals, have 1'],
        can_mutate_evidence: true,
      }]);
    }
    return Promise.resolve([]);
  });
  geocodingMocks.isConfigured.mockReturnValue(false);
  geocodingMocks.geocode.mockResolvedValue([]);
  livePublishMocks.publishCandidateToLiveService.mockResolvedValue({
    serviceId: 'service-id',
    organizationId: 'org-id',
    locationId: 'loc-id',
  });
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
    expect(livePublishMocks.publishCandidateToLiveService).not.toHaveBeenCalled();
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
    const { POST } = await loadPublishRoute();

    const response = await POST(
      createRequest({ ip: '198.51.100.33' }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(rateLimitMock).toHaveBeenCalledWith(
      'admin:ingestion:candidates:publish:write:198.51.100.33',
      expect.any(Object),
    );
    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(livePublishMocks.publishCandidateToLiveService).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: '11111111-1111-4111-8111-111111111111',
        publishedByUserId: 'oran-1',
        geocode: undefined,
      }),
    );
    expect(stores.audit.append).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      serviceId: 'service-id',
    });
  });

  it('enforces publish route infra/auth/rate-limit/input guards', async () => {
    const { POST } = await loadPublishRoute();

    dbConfigMock.mockReturnValueOnce(false);
    const unavailable = await POST(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'));
    expect(unavailable.status).toBe(503);

    dbConfigMock.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await POST(
      createRequest({ ip: '203.0.113.25' }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await POST(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'));
    expect(unauth.status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'oran-1' });
    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await POST(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'));
    expect(forbidden.status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'oran-1' });
    const invalid = await POST(createRequest(), createRouteContext('bad-id'));
    expect(invalid.status).toBe(400);
  });

  it('passes the geocoder into the live publish helper when enabled', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    geocodingMocks.isConfigured.mockReturnValueOnce(true);
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('event-id')
      .mockReturnValueOnce('corr-id');
    const { POST } = await loadPublishRoute();

    const response = await POST(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    expect(livePublishMocks.publishCandidateToLiveService).toHaveBeenCalledWith(
      expect.objectContaining({
        geocode: geocodingMocks.geocode,
      }),
    );
    uuidSpy.mockRestore();
  });

  it('omits the geocoder when geocoding is not configured', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    geocodingMocks.isConfigured.mockReturnValueOnce(false);
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('event-id')
      .mockReturnValueOnce('corr-id');
    const { POST } = await loadPublishRoute();

    const response = await POST(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    expect(livePublishMocks.publishCandidateToLiveService).toHaveBeenCalledWith(
      expect.objectContaining({
        geocode: undefined,
      }),
    );
    uuidSpy.mockRestore();
  });

  it('returns readiness for community admins and 404 when missing', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    requireMinRoleMock.mockImplementation(
      (_ctx: unknown, role: string) => role !== 'oran_admin',
    );
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
        canApprove: true,
        hasRequiredFields: true,
        hasRequiredTags: true,
        tagsConfirmed: true,
        meetsScoreThreshold: true,
        passesVerification: true,
        blockers: [],
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
    requireMinRoleMock.mockImplementation(
      (_ctx: unknown, role: string) => role !== 'oran_admin',
    );
    stores.llmSuggestions.listForCandidate.mockResolvedValueOnce([
      {
        id: 'suggest-1',
        field: 'name',
        reviewedByUserId: 'peer-user',
        reviewNotes: 'Peer subjective notes',
      },
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
      '11111111-1111-4111-8111-111111111111',
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

    const missingModifiedValue = await PUT(
      createRequest({
        jsonBody: {
          suggestionId: '22222222-2222-4222-8222-222222222222',
          status: 'modified',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(missingModifiedValue.status).toBe(400);

    const unexpectedAcceptedValue = await PUT(
      createRequest({
        jsonBody: {
          suggestionId: '22222222-2222-4222-8222-222222222222',
          status: 'accepted',
          acceptedValue: 'A hidden override',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(unexpectedAcceptedValue.status).toBe(400);

    stores.llmSuggestions.getById.mockResolvedValueOnce({
      id: '22222222-2222-4222-8222-222222222222',
      candidateId: '11111111-1111-4111-8111-111111111111',
      fieldName: 'website',
      suggestedValue: 'javascript:alert(1)',
    });
    const invalidAcceptedUrl = await PUT(
      createRequest({
        jsonBody: {
          suggestionId: '22222222-2222-4222-8222-222222222222',
          status: 'accepted',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(invalidAcceptedUrl.status).toBe(400);
    await expect(invalidAcceptedUrl.json()).resolves.toEqual({
      error: 'Website must be an http(s) URL without credentials.',
    });
  });

  it('lists tag confirmations and updates decisions', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    requireMinRoleMock.mockImplementation(
      (_ctx: unknown, role: string) => role !== 'oran_admin',
    );
    stores.tagConfirmations.listForCandidate.mockResolvedValueOnce([
      {
        id: 'confirm-1',
        proposedTag: 'food',
        reviewedByUserId: 'peer-user',
        reviewNotes: 'Peer subjective notes',
      },
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
          status: 'modified',
          confirmedValue: 'food_assistance',
          notes: 'Exact taxonomy match',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(stores.tagConfirmations.updateDecision).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      'modified',
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

  it('returns 409 when tag or suggestion decision evidence is stale or mismatched', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    stores.llmSuggestions.updateDecision.mockResolvedValueOnce('conflict');
    stores.tagConfirmations.updateDecision.mockResolvedValueOnce('conflict');
    const suggestionsRoute = await loadSuggestionsRoute();
    const tagsRoute = await loadTagsRoute();

    const suggestionResponse = await suggestionsRoute.PUT(
      createRequest({
        jsonBody: {
          suggestionId: '22222222-2222-4222-8222-222222222222',
          status: 'accepted',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    const tagResponse = await tagsRoute.PUT(
      createRequest({
        jsonBody: {
          confirmationId: '33333333-3333-4333-8333-333333333333',
          status: 'confirmed',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(suggestionResponse.status).toBe(409);
    expect(tagResponse.status).toBe(409);
    await expect(suggestionResponse.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('Refresh') }),
    );
    await expect(tagResponse.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining('Refresh') }),
    );
  });

  it('allows ORAN-admin oversight reads but denies tag and suggestion mutations', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-oversight-1', role: 'oran_admin' });
    requireMinRoleMock.mockReturnValue(true);
    requireRoleMock.mockReturnValue(false);
    const suggestionsRoute = await loadSuggestionsRoute();
    const tagsRoute = await loadTagsRoute();

    const suggestionResponse = await suggestionsRoute.PUT(
      createRequest({
        jsonBody: {
          suggestionId: '22222222-2222-4222-8222-222222222222',
          status: 'accepted',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    const tagResponse = await tagsRoute.PUT(
      createRequest({
        jsonBody: {
          confirmationId: '33333333-3333-4333-8333-333333333333',
          status: 'confirmed',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(suggestionResponse.status).toBe(403);
    expect(tagResponse.status).toBe(403);
    expect(stores.llmSuggestions.updateDecision).not.toHaveBeenCalled();
    expect(stores.tagConfirmations.updateDecision).not.toHaveBeenCalled();
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

  it('covers tag route guard and validation branches for GET and PUT', async () => {
    const { GET, PUT } = await loadTagsRoute();

    dbConfigMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(503);

    dbConfigMock.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 5 });
    const limitedGet = await GET(
      createRequest({ ip: '203.0.113.10' }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(limitedGet.status).toBe(429);
    expect(limitedGet.headers.get('Retry-After')).toBe('5');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    expect((await GET(createRequest(), createRouteContext('bad-id'))).status).toBe(400);

    dbConfigMock.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(503);

    dbConfigMock.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 4 });
    const limitedPut = await PUT(
      createRequest({ ip: '203.0.113.11' }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(limitedPut.status).toBe(429);
    expect(limitedPut.headers.get('Retry-After')).toBe('4');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await PUT(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    requireRoleMock.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    expect((await PUT(createRequest(), createRouteContext('bad-id'))).status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    const invalidBody = await PUT(
      createRequest({
        jsonBody: {
          confirmationId: 'not-a-uuid',
          status: 'confirmed',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(invalidBody.status).toBe(400);
    await expect(invalidBody.json()).resolves.toEqual(
      expect.objectContaining({
        error: 'Invalid input.',
      }),
    );

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    const mislabeledConfirmedValue = await PUT(
      createRequest({
        jsonBody: {
          confirmationId: '33333333-3333-4333-8333-333333333333',
          status: 'confirmed',
          confirmedValue: 'different_value',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(mislabeledConfirmedValue.status).toBe(400);
  });

  it('captures tag PUT exceptions and returns 500', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    stores.tagConfirmations.updateDecision.mockRejectedValueOnce(new Error('write failed'));
    const { PUT } = await loadTagsRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          confirmationId: '44444444-4444-4444-8444-444444444444',
          status: 'rejected',
          notes: 'not valid',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error.',
    });
  });

  it('covers readiness route guard branches and exceptions', async () => {
    const { GET } = await loadReadinessRoute();

    dbConfigMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(503);

    dbConfigMock.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 6 });
    expect((await GET(createRequest({ ip: '203.0.113.6' }), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    expect((await GET(createRequest(), createRouteContext('bad-id'))).status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    stores.publishReadiness.getReadiness.mockRejectedValueOnce(new Error('readiness down'));
    const failed = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(failed.status).toBe(500);
  });

  it('covers suggestions route guard branches and exceptions', async () => {
    const { GET, PUT } = await loadSuggestionsRoute();

    dbConfigMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(503);

    dbConfigMock.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 8 });
    expect((await GET(createRequest({ ip: '203.0.113.8' }), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await GET(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    expect((await GET(createRequest(), createRouteContext('bad-id'))).status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    stores.llmSuggestions.listForCandidate.mockRejectedValueOnce(new Error('list down'));
    const getFailed = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(getFailed.status).toBe(500);

    dbConfigMock.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(503);

    dbConfigMock.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    expect((await PUT(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await PUT(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    requireRoleMock.mockReturnValueOnce(false);
    expect((await PUT(createRequest(), createRouteContext('11111111-1111-4111-8111-111111111111'))).status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    expect((await PUT(createRequest(), createRouteContext('bad-id'))).status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    const badJsonPut = await PUT(
      createRequest({ jsonError: true }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(badJsonPut.status).toBe(500);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'community-1' });
    stores.llmSuggestions.updateDecision.mockRejectedValueOnce(new Error('update failed'));
    const putFailed = await PUT(
      createRequest({
        jsonBody: {
          suggestionId: '22222222-2222-4222-8222-222222222222',
          status: 'accepted',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(putFailed.status).toBe(500);
  });
});
