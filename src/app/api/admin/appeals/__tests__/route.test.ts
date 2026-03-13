import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const clientQueryMock = vi.hoisted(() => vi.fn());
const engineMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
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
vi.mock('@/services/workflow/engine', () => engineMocks);

async function loadRoute() {
  return import('../route');
}

function createGetRequest(url = 'https://example.org/api/admin/appeals', ip?: string) {
  const headers = new Headers();
  if (ip) {
    headers.set('x-forwarded-for', ip);
  }

  return {
    headers,
    nextUrl: new URL(url),
  } as never;
}

function createPostRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof clientQueryMock }) => unknown) => {
    return fn({ query: clientQueryMock });
  });

  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });

  authMocks.getAuthContext.mockResolvedValue({
    userId: '11111111-1111-4111-8111-111111111111',
    role: 'oran_admin',
  });

  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
  clientQueryMock.mockReset();
  engineMocks.advance.mockResolvedValue({
    success: true,
    submissionId: '22222222-2222-4222-8222-222222222222',
    fromStatus: 'submitted',
    toStatus: 'approved',
    transitionId: 'tr-1',
    gateResults: [],
  });
  engineMocks.acquireLock.mockResolvedValue(true);
  engineMocks.releaseLock.mockResolvedValue(undefined);
});

describe('GET /api/admin/appeals', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());

    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 13 });
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest('https://example.org/api/admin/appeals', '203.0.113.11'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('13');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());

    expect(response.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    requireMinRoleMock.mockReturnValueOnce(false);
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());

    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid query parameters', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest('https://example.org/api/admin/appeals?page=0'));

    expect(response.status).toBe(400);
  });

  it('returns paginated results and private cache headers', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        {
          id: 'appeal-1',
          status: 'submitted',
          title: 'Appeal title',
          notes: 'Appeal notes',
          reviewer_notes: null,
          submitted_by_user_id: 'user-1',
          assigned_to_user_id: null,
          priority: 0,
          original_submission_id: 'orig-1',
          original_submission_type: 'service_verification',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          service_id: 'svc-1',
        },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const { GET } = await loadRoute();
    const response = await GET(
      createGetRequest('https://example.org/api/admin/appeals?page=1&limit=20&status=submitted'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      results: expect.any(Array),
      total: 1,
      page: 1,
      hasMore: false,
    });
  });

  it('returns 500 and captures exception on read failure', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('query failed'));
    const { GET } = await loadRoute();

    const response = await GET(createGetRequest());

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});

describe('POST /api/admin/appeals', () => {
  const validBody = {
    appealId: '22222222-2222-4222-8222-222222222222',
    decision: 'approved',
    notes: 'Re-open this for second review.',
  };

  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 8 });
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('8');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    requireMinRoleMock.mockReturnValueOnce(false);
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonError: true }));

    expect(response.status).toBe(400);
  });

  it('returns 400 for validation errors', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({
      jsonBody: { appealId: 'not-a-uuid', decision: 'maybe' },
    }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when denying without notes', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({
      jsonBody: { appealId: '22222222-2222-4222-8222-222222222222', decision: 'denied' },
    }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when returning without notes', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({
      jsonBody: { appealId: '22222222-2222-4222-8222-222222222222', decision: 'returned' },
    }));

    expect(response.status).toBe(400);
  });

  it('returns 409 when lock cannot be acquired', async () => {
    engineMocks.acquireLock.mockResolvedValueOnce(false);
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Appeal is currently being reviewed by another admin',
    });
  });

  it('returns 409 when advance fails and releases lock', async () => {
    engineMocks.advance.mockResolvedValueOnce({
      success: false,
      error: 'Invalid transition',
    });
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(409);
    expect(engineMocks.releaseLock).toHaveBeenCalledWith(
      validBody.appealId,
      '11111111-1111-4111-8111-111111111111',
      false,
    );
  });

  it('approves appeal, re-opens original submission via transaction', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          payload: { original_submission_id: '44444444-4444-4444-8444-444444444444' },
        }],
      })
      .mockResolvedValue({ rows: [] });

    const { POST } = await loadRoute();
    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.decision).toBe('approved');
    expect(json.message).toBe('Appeal approved successfully');
    expect(engineMocks.acquireLock).toHaveBeenCalledWith(
      validBody.appealId,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(engineMocks.advance).toHaveBeenCalledOnce();
    expect(clientQueryMock.mock.calls.some((args: unknown[]) =>
      String(args[0]).includes("SET status = 'needs_review'"),
    )).toBe(true);
  });

  it('denies appeal with notes', async () => {
    engineMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: validBody.appealId,
      fromStatus: 'submitted',
      toStatus: 'denied',
      transitionId: 'tr-2',
      gateResults: [],
    });

    const { POST } = await loadRoute();
    const response = await POST(createPostRequest({
      jsonBody: { ...validBody, decision: 'denied', notes: 'Insufficient evidence.' },
    }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.decision).toBe('denied');
    // Should save reviewer_notes
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('reviewer_notes'),
      ['Insufficient evidence.', validBody.appealId],
    );
  });

  it('returns appeal with notes', async () => {
    engineMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: validBody.appealId,
      fromStatus: 'submitted',
      toStatus: 'returned',
      transitionId: 'tr-3',
      gateResults: [],
    });

    const { POST } = await loadRoute();
    const response = await POST(createPostRequest({
      jsonBody: { ...validBody, decision: 'returned', notes: 'Please provide more evidence.' },
    }));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.decision).toBe('returned');
  });

  it('returns 500 and releases lock when unexpected error occurs', async () => {
    engineMocks.acquireLock.mockRejectedValueOnce(new Error('db error'));
    const { POST } = await loadRoute();

    const response = await POST(createPostRequest({ jsonBody: validBody }));

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
