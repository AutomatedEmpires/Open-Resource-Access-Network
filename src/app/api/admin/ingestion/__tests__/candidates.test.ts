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
const storeMocks = vi.hoisted(() => ({
  createIngestionStores: vi.fn(),
}));

const ingestionStores = vi.hoisted(() => ({
  candidates: {
    list: vi.fn(),
    getById: vi.fn(),
    updateReviewStatus: vi.fn(),
  },
  tags: {
    listFor: vi.fn(),
  },
  checks: {
    listFor: vi.fn(),
  },
  links: {
    listForCandidate: vi.fn(),
  },
  assignments: {
    listForCandidate: vi.fn(),
  },
  tagConfirmations: {
    listForCandidate: vi.fn(),
  },
  llmSuggestions: {
    listForCandidate: vi.fn(),
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
}));
vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: getDrizzleMock,
}));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => storeMocks);

function createRequest(options: {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
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

async function loadCandidatesRoute() {
  return import('../candidates/route');
}

async function loadCandidateDetailRoute() {
  return import('../candidates/[id]/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbConfigMock.mockReturnValue(true);
  executeQueryMock.mockReset().mockResolvedValue([]);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  getDrizzleMock.mockReturnValue({ kind: 'db' });
  storeMocks.createIngestionStores.mockReturnValue(ingestionStores);

  ingestionStores.candidates.list.mockResolvedValue([]);
  ingestionStores.candidates.getById.mockResolvedValue(null);
  ingestionStores.candidates.updateReviewStatus.mockResolvedValue(undefined);
  ingestionStores.tags.listFor.mockResolvedValue([]);
  ingestionStores.checks.listFor.mockResolvedValue([]);
  ingestionStores.links.listForCandidate.mockResolvedValue([]);
  ingestionStores.assignments.listForCandidate.mockResolvedValue([]);
  ingestionStores.tagConfirmations.listForCandidate.mockResolvedValue([]);
  ingestionStores.llmSuggestions.listForCandidate.mockResolvedValue([]);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('admin ingestion candidate routes', () => {
  it('requires authentication before listing candidates', async () => {
    const { GET } = await loadCandidatesRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
  });

  it('validates candidate list parameters before querying stores', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { GET } = await loadCandidatesRoute();

    const response = await GET(createRequest({ search: '?page=0&limit=500&tier=blue' }));

    expect(response.status).toBe(400);
    expect(ingestionStores.candidates.list).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe('Invalid parameters.');
  });

  it('lists candidates with translated filter and pagination arguments', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    ingestionStores.candidates.list.mockResolvedValueOnce([
      { candidateId: 'cand-1', review: { status: 'pending' } },
    ]);
    const { GET } = await loadCandidatesRoute();

    const response = await GET(
      createRequest({
        search: '?status=pending&tier=orange&state=WA&page=2&limit=10',
        ip: '203.0.113.9',
      })
    );

    expect(rateLimitMock).toHaveBeenCalledWith('admin:ingestion:candidates:read:203.0.113.9', expect.any(Object));
    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'admin-1' }, 'oran_admin');
    expect(ingestionStores.candidates.list).toHaveBeenCalledWith(
      {
        reviewStatus: 'pending',
        confidenceTier: 'orange',
        jurisdictionState: 'WA',
      },
      10,
      10
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      candidates: [{ candidateId: 'cand-1', review: { status: 'pending' } }],
      page: 2,
      limit: 10,
    });
  });

  it('rejects invalid candidate ids on the detail route', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { GET } = await loadCandidateDetailRoute();

    const response = await GET(createRequest(), createRouteContext('bad-id'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid candidate ID.',
    });
  });

  it('returns candidate detail with related review artifacts', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    ingestionStores.candidates.getById.mockResolvedValueOnce({
      candidateId: '11111111-1111-4111-8111-111111111111',
      review: { status: 'in_review' },
    });
    ingestionStores.tags.listFor.mockResolvedValueOnce([{ tag: 'housing' }]);
    ingestionStores.checks.listFor.mockResolvedValueOnce([{ checkId: 'check-1' }]);
    ingestionStores.links.listForCandidate.mockResolvedValueOnce([{ id: 'link-1' }]);
    ingestionStores.tagConfirmations.listForCandidate.mockResolvedValueOnce([
      { id: 'confirm-1' },
    ]);
    ingestionStores.llmSuggestions.listForCandidate.mockResolvedValueOnce([
      { id: 'suggest-1' },
    ]);
    ingestionStores.assignments.listForCandidate.mockResolvedValue([{
      id: 'peer-assignment-secret',
      adminProfileId: 'peer-profile-secret',
      outcomeNotes: 'peer-private-note',
      completedAt: '2026-07-14T22:00:00.000Z',
    }]);
    executeQueryMock.mockResolvedValueOnce([{
      id: 'assign-current',
      status: 'claimed',
      outcome: null,
      expires_at: '2026-07-15T00:00:00.000Z',
    }]).mockResolvedValueOnce([{
      completed_review_count: 1,
      open_review_count: 2,
    }]);
    const { GET } = await loadCandidateDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111')
    );

    expect(requireMinRoleMock).toHaveBeenCalledWith(
      { userId: 'community-1' },
      'community_admin'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      candidate: {
        candidateId: '11111111-1111-4111-8111-111111111111',
        review: { status: 'in_review' },
      },
      tags: [{ tag: 'housing' }],
      checks: [{ checkId: 'check-1' }],
      links: [{ id: 'link-1' }],
      tagConfirmations: [{ id: 'confirm-1' }],
      suggestions: [{ id: 'suggest-1' }],
      currentUserAssignment: {
        id: 'assign-current',
        status: 'claimed',
        outcome: null,
        expires_at: '2026-07-15T00:00:00.000Z',
      },
      assignmentProgress: {
        completedReviewCount: 1,
        openReviewCount: 2,
        requiredMatchingReviewCount: 2,
      },
    });
    expect(ingestionStores.assignments.listForCandidate).not.toHaveBeenCalled();
    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('reviewer.user_id = $2'),
      ['11111111-1111-4111-8111-111111111111', 'community-1'],
    );
  });

  it('returns 404 when the candidate detail record is missing', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { GET } = await loadCandidateDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111')
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Candidate not found.',
    });
  });

  it('rejects direct review status mutation through the candidate detail route', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { PATCH } = await loadCandidateDetailRoute();

    const response = await PATCH(
      createRequest({
        jsonBody: {
          reviewStatus: 'verified',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111')
    );

    expect(ingestionStores.candidates.updateReviewStatus).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      error: 'Candidate status decisions must use the assigned approval workflow.',
    });
    expect(JSON.stringify(responseBody)).not.toMatch(
      /peer-assignment-secret|peer-profile-secret|peer-private-note|2026-07-14T22:00:00\.000Z/,
    );
  });

  it('reserves full assignment evidence for ORAN oversight', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    ingestionStores.candidates.getById.mockResolvedValueOnce({
      candidateId: '11111111-1111-4111-8111-111111111111',
      review: { status: 'in_review' },
    });
    ingestionStores.assignments.listForCandidate.mockResolvedValueOnce([
      { id: 'assignment-with-oversight-evidence', outcomeNotes: 'oversight only' },
    ]);
    executeQueryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ completed_review_count: 1, open_review_count: 1 }]);
    const { GET } = await loadCandidateDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      assignments: [
        { id: 'assignment-with-oversight-evidence', outcomeNotes: 'oversight only' },
      ],
    }));
  });

  it('rejects unsupported candidate patch fields', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { PATCH } = await loadCandidateDetailRoute();

    const response = await PATCH(
      createRequest({
        jsonBody: {
          organizationName: 'Unreviewed replacement',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111')
    );

    expect(response.status).toBe(400);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'Invalid input.',
    }));
  });
});
