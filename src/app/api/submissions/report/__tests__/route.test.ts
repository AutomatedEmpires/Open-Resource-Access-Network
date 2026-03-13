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

describe('POST /api/submissions/report', () => {
  const validBody = {
    serviceId: '22222222-2222-4222-8222-222222222222',
    reason: 'incorrect_info',
    details: 'The listed hours are out of date and should be corrected.',
    contactEmail: 'reporter@example.org',
  };

  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody, ip: '203.0.113.42' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('9');
  });

  it('returns 400 for invalid JSON', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
  });

  it('returns 400 for validation failure', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        serviceId: 'not-a-uuid',
        reason: 'other',
        details: 'x',
      },
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when service does not exist', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Service not found' });
  });

  it('returns 409 when user recently reported the same service', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: validBody.serviceId, name: 'Shelter Service' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-report' }] });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'You have already reported this listing recently' });
  });

  it('creates report successfully for authenticated user', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: validBody.serviceId, name: 'Shelter Service' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'report-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      reportId: 'report-1',
      message: 'Report submitted. Thank you for helping keep listings accurate.',
    });
  });

  it('creates report for anonymous submitter when auth context is absent', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: validBody.serviceId, name: 'Shelter Service' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'report-2' }] })
      .mockResolvedValueOnce({ rows: [] });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: validBody, ip: '203.0.113.15' }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.reportId).toBe('report-2');
  });

  it('returns 500 when transaction throws', async () => {
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('write failed'));
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonBody: validBody }));

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});

describe('GET /api/submissions/report', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 21 });
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('21');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
  });

  it('returns user reports with no-store cache headers', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'report-1',
        status: 'submitted',
        title: 'Bad listing',
        notes: 'Outdated info',
        reviewer_notes: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        service_id: '22222222-2222-4222-8222-222222222222',
        reason: 'incorrect_info',
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.reports).toHaveLength(1);
  });

  it('returns 500 when list query throws', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('read failed'));
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
