import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));

function createRequest(search = '') {
  const url = new URL(`https://oran.test/api/admin/audit${search}`);
  return {
    headers: new Headers({ 'x-forwarded-for': '1.2.3.4' }),
    nextUrl: url,
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'oran_admin' });
  requireMinRoleMock.mockReturnValue(true);
});

describe('GET /api/admin/audit', () => {
  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns 403 when not oran_admin', async () => {
    requireMinRoleMock.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid parameters', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest('?action=bad_action'));
    expect(res.status).toBe(400);
  });

  it('returns audit_logs rows with correct column names', async () => {
    const row = {
      id: 'uuid-1',
      action: 'create',
      resource_type: 'services',
      resource_id: 'uuid-2',
      actor_user_id: 'user-1',
      before: null,
      after: '{}',
      ip_digest: 'abc',
      created_at: '2026-01-01T00:00:00Z',
    };
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([row]);

    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([row]);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);

    // Verify SQL references audit_logs (plural), not audit_log
    const countCall = dbMocks.executeQuery.mock.calls[0][0] as string;
    expect(countCall).toContain('audit_logs');
    expect(countCall).not.toContain('audit_log ');

    const selectCall = dbMocks.executeQuery.mock.calls[1][0] as string;
    expect(selectCall).toContain('audit_logs');
    expect(selectCall).toContain('resource_type');
    expect(selectCall).toContain('actor_user_id');
    expect(selectCall).toContain('ip_digest');
    // Verify old wrong column names are NOT used
    expect(selectCall).not.toContain('table_name');
    expect(selectCall).not.toContain('al.user_id');
    expect(selectCall).not.toContain('old_data');
    expect(selectCall).not.toContain('new_data');
    expect(selectCall).not.toContain('ip_address');
  });

  it('filters by action and resourceType', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([]);

    const { GET } = await import('../route');
    const res = await GET(createRequest('?action=create&resourceType=services'));
    expect(res.status).toBe(200);

    const countSql = dbMocks.executeQuery.mock.calls[0][0] as string;
    expect(countSql).toContain('al.action = $1');
    expect(countSql).toContain('al.resource_type = $2');
    // params array is shared by ref; after count query, limit/offset are pushed
    const countParams = dbMocks.executeQuery.mock.calls[0][1] as unknown[];
    expect(countParams[0]).toBe('create');
    expect(countParams[1]).toBe('services');
  });

  it('returns 500 on db error and reports to sentry', async () => {
    dbMocks.executeQuery.mockRejectedValue(new Error('pg down'));
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
