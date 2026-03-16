import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

function createRequest(options: { search?: string; jsonBody?: unknown; jsonError?: boolean } = {}) {
  const url = new URL(`https://oran.test/api/admin/security/accounts${options.search ?? ''}`);
  return {
    headers: new Headers({ 'x-forwarded-for': '203.0.113.1' }),
    nextUrl: url,
    json: options.jsonError ? vi.fn().mockRejectedValue(new Error('bad json')) : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function createClient() {
  return { query: vi.fn() };
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (client: ReturnType<typeof createClient>) => unknown) => fn(createClient()));
  authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin', accountStatus: 'active', orgIds: [], orgRoles: new Map() });
  requireMinRoleMock.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('GET /api/admin/security/accounts', () => {
  it('lists account rows', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        user_id: 'user-1',
        display_name: 'Jordan',
        email: 'jordan@example.com',
        role: 'host_admin',
        account_status: 'active',
        security_note: null,
        suspended_at: null,
        restored_at: null,
        organization_count: 2,
        updated_at: '2026-03-16T12:00:00.000Z',
      }])
      .mockResolvedValueOnce([{ count: '1' }]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest({ search: '?status=active' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(body.results[0].user_id).toBe('user-1');
  });

  it('returns 401 without auth', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/admin/security/accounts', () => {
  it('rejects self freeze', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { userId: 'oran-1', action: 'freeze', note: 'Suspicious activity detected' } }));
    expect(response.status).toBe(400);
  });

  it('prevents freezing the last active ORAN admin', async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'oran-2', role: 'oran_admin', account_status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { userId: 'oran-2', action: 'freeze', note: 'Compromised administrator session' } }));
    expect(response.status).toBe(409);
  });

  it('freezes an account and returns the new status', async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-2', role: 'host_admin', account_status: 'active' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    dbMocks.withTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client));

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { userId: 'user-2', action: 'freeze', note: 'Credential stuffing investigation' } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accountStatus).toBe('frozen');
  });
});
