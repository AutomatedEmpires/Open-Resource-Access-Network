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
const requireMinRoleMock = vi.hoisted(() => vi.fn());
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

// ============================================================
// Helpers
// ============================================================

function createRequest(options: {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test/api/admin/appeals${options.search ?? ''}`);
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
  return import('../appeals/route');
}

// ============================================================
// Mock transaction helper
// ============================================================

function _mockTransaction(callback: (client: ReturnType<typeof createMockClient>) => unknown) {
  const client = createMockClient();
  dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));
  callback(client);
  return client;
}

function createMockClient() {
  return {
    query: vi.fn(),
  };
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
  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
  engineMocks.advance.mockResolvedValue({
    success: true,
    submissionId: '11111111-1111-4111-8111-111111111111',
    fromStatus: 'submitted',
    toStatus: 'approved',
    transitionId: 'tr-1',
    gateResults: [],
  });
  engineMocks.acquireLock.mockResolvedValue(true);
  engineMocks.releaseLock.mockResolvedValue(undefined);
});

// ============================================================
// GET /api/admin/appeals
// ============================================================

describe('GET /api/admin/appeals', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    requireMinRoleMock.mockReturnValue(false);
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid page param', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    const { GET } = await loadRoute();
    const response = await GET(createRequest({ search: '?page=0' }));
    expect(response.status).toBe(400);
  });

  it('lists appeals with pagination', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'appeal-1',
        status: 'submitted',
        title: 'Appeal: org_claim',
        notes: 'I was wrongly denied',
        reviewer_notes: null,
        submitted_by_user_id: 'user-1',
        assigned_to_user_id: null,
        priority: 1,
        original_submission_id: 'sub-1',
        original_submission_type: 'org_claim',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        service_id: null,
      }])
      .mockResolvedValueOnce([{ count: '1' }]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest({ search: '?page=1&limit=20' }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe('appeal-1');
    expect(body.results[0].original_submission_id).toBe('sub-1');
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('filters by status', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest({ search: '?status=denied' }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

// ============================================================
// POST /api/admin/appeals — Decide an appeal
// ============================================================

describe('POST /api/admin/appeals', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 60 });
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('returns 401 when unauthenticated', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker' });
    requireMinRoleMock.mockReturnValue(false);
    const { POST } = await loadRoute();
    const response = await POST(createRequest());
    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonError: true }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid body', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: { appealId: 'not-a-uuid', decision: 'maybe' },
    }));
    expect(response.status).toBe(400);
  });

  it('returns 409 when lock cannot be acquired', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    engineMocks.acquireLock.mockResolvedValueOnce(false);

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        appealId: '11111111-1111-4111-8111-111111111111',
        decision: 'approved',
        notes: 'Looks good',
      },
    }));
    expect(response.status).toBe(409);
  });

  it('returns 409 when advance fails', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    engineMocks.advance.mockResolvedValueOnce({
      success: false,
      error: 'Invalid transition',
    });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        appealId: '11111111-1111-4111-8111-111111111111',
        decision: 'denied',
        notes: 'Insufficient evidence',
      },
    }));
    expect(response.status).toBe(409);
    expect(engineMocks.releaseLock).toHaveBeenCalled();
  });

  it('approves an appeal and re-opens original submission', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    const client = createMockClient();
    // 1. SELECT appeal payload
    client.query.mockResolvedValueOnce({
      rows: [{
        payload: { original_submission_id: 'sub-original' },
      }],
    });
    // 2. UPDATE original submission (re-open)
    client.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT transition for original
    client.query.mockResolvedValueOnce({ rows: [] });

    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        appealId: '11111111-1111-4111-8111-111111111111',
        decision: 'approved',
        notes: 'Appeal granted — reviewing again',
      },
    }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.decision).toBe('approved');
    expect(engineMocks.acquireLock).toHaveBeenCalled();
    expect(engineMocks.advance).toHaveBeenCalledOnce();

    // Verify original submission was re-opened via transaction
    const reOpenCall = client.query.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('needs_review'),
    );
    expect(reOpenCall).toBeDefined();
  });

  it('denies an appeal without re-opening original', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'community_admin' });
    engineMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: '11111111-1111-4111-8111-111111111111',
      fromStatus: 'under_review',
      toStatus: 'denied',
      transitionId: 'tr-2',
      gateResults: [],
    });

    const { POST } = await loadRoute();
    const response = await POST(createRequest({
      jsonBody: {
        appealId: '11111111-1111-4111-8111-111111111111',
        decision: 'denied',
        notes: 'Insufficient evidence',
      },
    }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.decision).toBe('denied');
    // No transaction for re-opening
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });
});
