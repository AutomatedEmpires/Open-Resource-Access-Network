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
const clientQueryMock = vi.hoisted(() => vi.fn());
const engineMocks = vi.hoisted(() => ({
  applySla: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/workflow/engine', () => engineMocks);

async function loadRoute() {
  return import('../route');
}

function createRequest(options: {
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
    role: 'seeker',
  });

  captureExceptionMock.mockResolvedValue(undefined);
  clientQueryMock.mockReset();
  engineMocks.applySla.mockResolvedValue(undefined);
});

describe('POST /api/submissions/appeal', () => {
  const validBody = {
    submissionId: '22222222-2222-4222-8222-222222222222',
    reason: 'I have supporting evidence for this denial decision.',
    evidence: [
      { type: 'document', description: 'Appeal evidence' },
    ],
  };

  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 15 });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody, ip: '203.0.113.17' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('15');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
  });

  it('returns 400 for schema validation failure', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        submissionId: 'not-a-uuid',
        reason: 'short',
      },
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when original submission is missing', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Submission not found' });
  });

  it('returns 403 when user appeals someone else\'s submission', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{
        id: validBody.submissionId,
        status: 'denied',
        submitted_by_user_id: '33333333-3333-4333-8333-333333333333',
        submission_type: 'service_verification',
        target_type: 'service',
        target_id: '44444444-4444-4444-8444-444444444444',
        service_id: '55555555-5555-4555-8555-555555555555',
        title: 'Original title',
      }],
    });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(403);
  });

  it('returns 409 when submission is not denied', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{
        id: validBody.submissionId,
        status: 'approved',
        submitted_by_user_id: '11111111-1111-4111-8111-111111111111',
        submission_type: 'service_verification',
        target_type: 'service',
        target_id: null,
        service_id: null,
        title: 'Original title',
      }],
    });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(409);
  });

  it('returns 409 when another active appeal already exists', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: validBody.submissionId,
          status: 'denied',
          submitted_by_user_id: '11111111-1111-4111-8111-111111111111',
          submission_type: 'service_verification',
          target_type: 'service',
          target_id: null,
          service_id: null,
          title: 'Original title',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-appeal' }] });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'An appeal is already pending for this submission' });
  });

  it('creates appeal submission and records transition', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{
          id: validBody.submissionId,
          status: 'denied',
          submitted_by_user_id: '11111111-1111-4111-8111-111111111111',
          submission_type: 'service_verification',
          target_type: 'service',
          target_id: '66666666-6666-4666-8666-666666666666',
          service_id: '77777777-7777-4777-8777-777777777777',
          title: 'Original denial',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'appeal-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ assigned_to_user_id: 'reviewer-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      appealId: 'appeal-1',
      message: 'Appeal submitted successfully',
    });
  });

  it('returns 500 when transaction throws', async () => {
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('db exploded'));
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});

describe('GET /api/submissions/appeal', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 12 });
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
  });

  it('returns user appeals with private cache headers', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'appeal-1',
        status: 'submitted',
        title: 'Appeal title',
        notes: 'Appeal notes',
        reviewer_notes: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        original_submission_id: '22222222-2222-4222-8222-222222222222',
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.appeals).toHaveLength(1);
  });

  it('returns 500 when listing throws', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('query failed'));
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
