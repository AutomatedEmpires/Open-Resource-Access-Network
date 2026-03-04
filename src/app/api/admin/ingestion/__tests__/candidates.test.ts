import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
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

    expect(rateLimitMock).toHaveBeenCalledWith('203.0.113.9', expect.any(Object));
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
    ingestionStores.assignments.listForCandidate.mockResolvedValueOnce([
      { id: 'assign-1' },
    ]);
    ingestionStores.tagConfirmations.listForCandidate.mockResolvedValueOnce([
      { id: 'confirm-1' },
    ]);
    ingestionStores.llmSuggestions.listForCandidate.mockResolvedValueOnce([
      { id: 'suggest-1' },
    ]);
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
      assignments: [{ id: 'assign-1' }],
      tagConfirmations: [{ id: 'confirm-1' }],
      suggestions: [{ id: 'suggest-1' }],
    });
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

  it('updates review status through the candidate detail route', async () => {
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

    expect(ingestionStores.candidates.updateReviewStatus).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'verified',
      'community-1'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('captures unexpected store errors on patch', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    ingestionStores.candidates.updateReviewStatus.mockRejectedValueOnce(
      new Error('db blew up')
    );
    const { PATCH } = await loadCandidateDetailRoute();

    const response = await PATCH(
      createRequest({
        jsonBody: {
          reviewStatus: 'verified',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111')
    );

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error));
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error.',
    });
  });
});
