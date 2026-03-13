import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Mocks (hoisted so vi.mock can reference them)
// ============================================================

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);

// ============================================================
// Helpers
// ============================================================

function createRequest(options: {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test/api/submissions/report${options.search ?? ''}`);
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

async function loadRoute() {
  return import('../../submissions/report/route');
}

function createMockClient() {
  return { query: vi.fn() };
}

// ============================================================
// Setup
// ============================================================

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (c: ReturnType<typeof createMockClient>) => unknown) =>
    fn(createMockClient()),
  );
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue(null);
  captureExceptionMock.mockResolvedValue(undefined);
});

// ============================================================
// POST /api/submissions/report
// ============================================================

describe('POST /api/submissions/report', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('returns 400 for invalid JSON', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonError: true }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid body (missing required fields)', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: { serviceId: 'not-uuid' },
    }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid reason enum', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'invalid_reason',
        details: 'Some details about the issue',
      },
    }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when details too short', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'incorrect_info',
        details: 'hi',
      },
    }));
    expect(response.status).toBe(400);
  });

  it('returns 404 when service not found', async () => {
    const client = createMockClient();
    client.query.mockResolvedValueOnce({ rows: [] }); // service not found
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'incorrect_info',
        details: 'The phone number listed is wrong',
      },
    }));
    expect(response.status).toBe(404);
  });

  it('returns 409 for duplicate recent report', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    // 1. Service found
    client.query.mockResolvedValueOnce({ rows: [{ id: 'svc-1', name: 'Test Service' }] });
    // 2. Duplicate found
    client.query.mockResolvedValueOnce({ rows: [{ id: 'dup-report' }] });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'wrong_phone',
        details: 'The phone number is incorrect',
      },
    }));
    expect(response.status).toBe(409);
  });

  it('creates report successfully (authenticated user)', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    // 1. Service found
    client.query.mockResolvedValueOnce({ rows: [{ id: 'svc-1', name: 'Food Bank' }] });
    // 2. No duplicate
    client.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT report
    client.query.mockResolvedValueOnce({ rows: [{ id: 'report-new' }] });
    // 4. INSERT transition
    client.query.mockResolvedValueOnce({ rows: [] });

    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'wrong_phone',
        details: 'The phone number is incorrect — should be 555-1234',
      },
    }));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.reportId).toBe('report-new');
    expect(body.message).toContain('Report submitted');
  });

  it('creates report successfully (anonymous user)', async () => {
    // authCtx resolves to null → anonymous
    const client = createMockClient();
    // 1. Service found
    client.query.mockResolvedValueOnce({ rows: [{ id: 'svc-1', name: 'Shelter' }] });
    // 2. No duplicate
    client.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT report
    client.query.mockResolvedValueOnce({ rows: [{ id: 'report-anon' }] });
    // 4. INSERT transition
    client.query.mockResolvedValueOnce({ rows: [] });

    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      ip: '1.2.3.4',
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'permanently_closed',
        details: 'This place has been closed for months',
      },
    }));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.reportId).toBe('report-anon');
  });

  it('creates suspected_fraud report with elevated priority', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    // 1. Service found
    client.query.mockResolvedValueOnce({ rows: [{ id: 'svc-1', name: 'Fake Service' }] });
    // 2. No duplicate
    client.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT report
    client.query.mockResolvedValueOnce({ rows: [{ id: 'report-fraud' }] });
    // 4. INSERT transition
    client.query.mockResolvedValueOnce({ rows: [] });

    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'suspected_fraud',
        details: 'This listing appears to be fraudulent',
      },
    }));
    expect(response.status).toBe(201);

    // Verify the INSERT call used the fraud reason that triggers priority=2
    const insertCall = client.query.mock.calls[2];
    expect(insertCall[1]).toContain('suspected_fraud');
  });

  it('accepts optional contactEmail', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    const client = createMockClient();
    client.query.mockResolvedValueOnce({ rows: [{ id: 'svc-1', name: 'Service' }] });
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({ rows: [{ id: 'report-email' }] });
    client.query.mockResolvedValueOnce({ rows: [] });

    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        serviceId: '11111111-1111-4111-8111-111111111111',
        reason: 'wrong_hours',
        details: 'Hours listed are Saturday hours, not weekday hours',
        contactEmail: 'reporter@example.com',
      },
    }));
    expect(response.status).toBe(201);
  });
});

// ============================================================
// GET /api/submissions/report
// ============================================================

describe('GET /api/submissions/report', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 15 });
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('15');
  });

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('lists user reports', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'report-1',
        status: 'submitted',
        title: 'Report: wrong phone — Food Bank',
        notes: 'The phone number is wrong',
        reviewer_notes: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        service_id: 'svc-1',
        reason: 'wrong_phone',
      },
    ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].id).toBe('report-1');
    expect(body.reports[0].reason).toBe('wrong_phone');
  });

  it('returns empty list when user has no reports', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.reports).toHaveLength(0);
  });
});
