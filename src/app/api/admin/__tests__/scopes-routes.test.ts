import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const twoPersonMocks = vi.hoisted(() => ({
  requestGrant: vi.fn(),
  decideGrant: vi.fn(),
  revokeGrant: vi.fn(),
  listPendingGrants: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
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
vi.mock('@/services/workflow/two-person', () => twoPersonMocks);

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

async function loadScopesRoute() {
  return import('../scopes/route');
}

async function loadGrantsRoute() {
  return import('../scopes/grants/route');
}

async function loadGrantDetailRoute() {
  return import('../scopes/grants/[id]/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
  twoPersonMocks.requestGrant.mockResolvedValue({ success: true, grantId: 'grant-1' });
  twoPersonMocks.decideGrant.mockResolvedValue({ success: true, grantId: 'grant-1' });
  twoPersonMocks.revokeGrant.mockResolvedValue(true);
  twoPersonMocks.listPendingGrants.mockResolvedValue([]);
});

// ============================================================
// /api/admin/scopes
// ============================================================

describe('GET /api/admin/scopes', () => {
  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    requireMinRoleMock.mockReturnValue(false);
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 42 });
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(503);
  });

  it('lists all scopes with pagination', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'scope-1', name: 'admin.users', description: 'Manage users',
        risk_level: 'high', requires_approval: true, is_active: true,
        created_at: '2024-01-01',
      }])
      .mockResolvedValueOnce([{ count: '1' }]);

    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest({ search: '?page=1&limit=20' }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].name).toBe('admin.users');
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('rejects invalid page param', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest({ search: '?page=0' }));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/admin/scopes', () => {
  it('creates a new scope', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ id: 'scope-new' }]) // INSERT
      .mockResolvedValueOnce([]); // Audit log

    const { POST } = await loadScopesRoute();
    const response = await POST(createRequest({
      jsonBody: {
        name: 'admin.reports',
        description: 'Access reporting',
        risk_level: 'medium',
        requires_approval: true,
      },
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe('scope-new');
    expect(body.name).toBe('admin.reports');
  });

  it('rejects duplicate scope name (409)', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery.mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING

    const { POST } = await loadScopesRoute();
    const response = await POST(createRequest({
      jsonBody: {
        name: 'admin.existing',
        description: 'Duplicate',
      },
    }));
    expect(response.status).toBe(409);
  });

  it('validates scope name format', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { POST } = await loadScopesRoute();
    const response = await POST(createRequest({
      jsonBody: {
        name: 'Invalid Name!',
        description: 'Bad name',
      },
    }));
    expect(response.status).toBe(400);
  });

  it('rejects invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { POST } = await loadScopesRoute();
    const response = await POST(createRequest({ jsonError: true }));
    expect(response.status).toBe(400);
  });
});

// ============================================================
// /api/admin/scopes/grants
// ============================================================

describe('GET /api/admin/scopes/grants', () => {
  it('lists pending grants', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    twoPersonMocks.listPendingGrants.mockResolvedValue([
      { id: 'pg-1', scope_name: 'admin.users', status: 'pending' },
    ]);

    const { GET } = await loadGrantsRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(twoPersonMocks.listPendingGrants).toHaveBeenCalledWith('admin-1');
  });

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadGrantsRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/admin/scopes/grants', () => {
  it('requests a new grant', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    twoPersonMocks.requestGrant.mockResolvedValue({ success: true, grantId: 'grant-new' });

    const { POST } = await loadGrantsRoute();
    const response = await POST(createRequest({
      jsonBody: {
        userId: 'user-1',
        scopeName: 'admin.reports',
        justification: 'Needs access for Q4 review',
      },
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.grantId).toBe('grant-new');
  });

  it('returns 409 when grant already exists', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    twoPersonMocks.requestGrant.mockResolvedValue({
      success: false, grantId: 'existing', error: 'User already has this scope grant',
    });

    const { POST } = await loadGrantsRoute();
    const response = await POST(createRequest({
      jsonBody: {
        userId: 'user-1',
        scopeName: 'admin.reports',
        justification: 'Duplicate',
      },
    }));
    expect(response.status).toBe(409);
  });

  it('validates request body', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { POST } = await loadGrantsRoute();
    const response = await POST(createRequest({
      jsonBody: { userId: 'user-1' }, // missing required fields
    }));
    expect(response.status).toBe(400);
  });
});

// ============================================================
// /api/admin/scopes/grants/[id]
// ============================================================

describe('PUT /api/admin/scopes/grants/[id]', () => {
  it('approves a pending grant', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-2' });
    twoPersonMocks.decideGrant.mockResolvedValue({ success: true, grantId: '11111111-1111-4111-8111-111111111111' });

    const { PUT } = await loadGrantDetailRoute();
    const response = await PUT(
      createRequest({
        jsonBody: { decision: 'approved', reason: 'Verified need' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toBe('approved');
  });

  it('denies a pending grant', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-2' });
    twoPersonMocks.decideGrant.mockResolvedValue({ success: true, grantId: '11111111-1111-4111-8111-111111111111' });

    const { PUT } = await loadGrantDetailRoute();
    const response = await PUT(
      createRequest({
        jsonBody: { decision: 'denied', reason: 'No justification' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toBe('denied');
  });

  it('rejects invalid UUID', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-2' });
    const { PUT } = await loadGrantDetailRoute();
    const response = await PUT(
      createRequest({
        jsonBody: { decision: 'approved', reason: 'OK' },
      }),
      createRouteContext('not-a-uuid'),
    );
    expect(response.status).toBe(400);
  });

  it('returns 409 on two-person violation', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    twoPersonMocks.decideGrant.mockResolvedValue({
      success: false,
      grantId: '11111111-1111-4111-8111-111111111111',
      error: 'Cannot approve your own grant request (two-person rule)',
    });

    const { PUT } = await loadGrantDetailRoute();
    const response = await PUT(
      createRequest({
        jsonBody: { decision: 'approved', reason: 'Self-approve' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(409);
  });
});

describe('DELETE /api/admin/scopes/grants/[id]', () => {
  it('revokes an active grant', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    twoPersonMocks.revokeGrant.mockResolvedValue(true);

    const { DELETE } = await loadGrantDetailRoute();
    const response = await DELETE(
      createRequest({
        jsonBody: { reason: 'Access no longer needed' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revoked).toBe(true);
  });

  it('returns 404 when grant not found', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    twoPersonMocks.revokeGrant.mockResolvedValue(false);

    const { DELETE } = await loadGrantDetailRoute();
    const response = await DELETE(
      createRequest({
        jsonBody: { reason: 'Test' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(404);
  });

  it('rejects missing reason', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { DELETE } = await loadGrantDetailRoute();
    const response = await DELETE(
      createRequest({ jsonBody: {} }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(400);
  });
});
