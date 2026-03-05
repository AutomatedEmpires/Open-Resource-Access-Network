import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);

function createRequest(ip = '127.0.0.1') {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    headers,
    nextUrl: new URL('https://oran.test/api/user/data-export'),
    url: 'https://oran.test/api/user/data-export',
    json: vi.fn().mockResolvedValue({}),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'seeker',
    orgIds: [],
    orgRoles: new Map(),
  });
});

describe('POST /api/user/data-export', () => {
  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns export data for authenticated user', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ id: 'sub-1', submission_type: 'new_service' }]) // submissions
      .mockResolvedValueOnce([{ id: 'mem-1', role: 'host_member' }])            // memberships
      .mockResolvedValueOnce([{ id: 'notif-1', event_type: 'status_change' }])  // notifications
      .mockResolvedValueOnce([{ id: 'pref-1', event_type: 'sla_breach' }])      // preferences
      .mockResolvedValueOnce([{ id: 'audit-1', action: 'login' }]);             // audit entries

    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.userId).toBe('user-1');
    expect(body.submissions).toHaveLength(1);
    expect(body.memberships).toHaveLength(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.preferences).toHaveLength(1);
    expect(body.auditEntries).toHaveLength(1);
    expect(body.exportedAt).toBeDefined();

    // Content-Disposition header for download
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="oran-data-export-/);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 600 });
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(429);
  });

  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(503);
  });

  it('returns 500 when database query fails', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('connection error'));
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
