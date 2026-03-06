import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const twoPersonMocks = vi.hoisted(() => ({
  requestGrant: vi.fn(),
  listPendingGrants: vi.fn(),
  decideGrant: vi.fn(),
  revokeGrant: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/workflow/two-person', () => twoPersonMocks);

function createRequest(options: { search?: string; ip?: string; body?: unknown; jsonError?: boolean } = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
  const headers = new Headers();
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  return {
    headers,
    url: url.toString(),
    nextUrl: url,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('bad json'))
      : vi.fn().mockResolvedValue(options.body),
  } as never;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
  twoPersonMocks.requestGrant.mockResolvedValue({ success: true, grantId: 'g-1' });
  twoPersonMocks.listPendingGrants.mockResolvedValue([]);
  twoPersonMocks.decideGrant.mockResolvedValue({ success: true, grantId: 'g-1' });
  twoPersonMocks.revokeGrant.mockResolvedValue(true);
});

describe('admin scopes grants extra coverage', () => {
  it('covers grants GET infra/authz/rate/error branches', async () => {
    const { GET } = await import('../scopes/grants/route');

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await GET(createRequest())).status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 6 });
    const limited = await GET(createRequest({ ip: '203.0.113.6' }));
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await GET(createRequest())).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await GET(createRequest())).status).toBe(403);

    twoPersonMocks.listPendingGrants.mockRejectedValueOnce(new Error('list failed'));
    const failed = await GET(createRequest());
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_grants_list',
    });
  });

  it('covers grants POST infra/auth/validation/conflict/success/error branches', async () => {
    const { POST } = await import('../scopes/grants/route');

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await POST(createRequest())).status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 4 });
    expect((await POST(createRequest({ ip: '203.0.113.4' }))).status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await POST(createRequest())).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await POST(createRequest())).status).toBe(403);

    expect((await POST(createRequest({ jsonError: true }))).status).toBe(400);
    expect((await POST(createRequest({ body: { userId: 'u1' } }))).status).toBe(400);

    twoPersonMocks.requestGrant.mockResolvedValueOnce({
      success: false,
      error: 'duplicate',
      grantId: 'g-dup',
    });
    const conflict = await POST(createRequest({
      body: {
        userId: 'user-2',
        scopeName: 'admin.test',
        justification: 'Needed',
      },
    }));
    expect(conflict.status).toBe(409);

    const created = await POST(createRequest({
      body: {
        userId: 'user-2',
        scopeName: 'admin.test',
        organizationId: null,
        justification: 'Needed',
      },
    }));
    expect(created.status).toBe(201);

    twoPersonMocks.requestGrant.mockRejectedValueOnce(new Error('request failed'));
    const failed = await POST(createRequest({
      body: {
        userId: 'user-2',
        scopeName: 'admin.test',
        justification: 'Needed',
      },
    }));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_grants_request',
    });
  });

  it('covers grants/[id] PUT and DELETE guard/error branches', async () => {
    const detail = await import('../scopes/grants/[id]/route');

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await detail.PUT(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 10 });
    expect((await detail.PUT(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await detail.PUT(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await detail.PUT(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(403);

    expect((await detail.PUT(createRequest(), ctx('bad-id'))).status).toBe(400);
    expect((await detail.PUT(createRequest({ jsonError: true }), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(400);
    expect((await detail.PUT(createRequest({ body: { decision: 'approved' } }), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(400);

    twoPersonMocks.decideGrant.mockRejectedValueOnce(new Error('decide failed'));
    const putFailed = await detail.PUT(
      createRequest({ body: { decision: 'approved', reason: 'ok' } }),
      ctx('11111111-1111-4111-8111-111111111111'),
    );
    expect(putFailed.status).toBe(500);

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    expect((await detail.DELETE(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 7 });
    expect((await detail.DELETE(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    expect((await detail.DELETE(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    expect((await detail.DELETE(createRequest(), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(403);

    expect((await detail.DELETE(createRequest(), ctx('bad-id'))).status).toBe(400);
    expect((await detail.DELETE(createRequest({ jsonError: true }), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(400);
    expect((await detail.DELETE(createRequest({ body: {} }), ctx('11111111-1111-4111-8111-111111111111'))).status).toBe(400);

    twoPersonMocks.revokeGrant.mockRejectedValueOnce(new Error('revoke failed'));
    const delFailed = await detail.DELETE(
      createRequest({ body: { reason: 'cleanup' } }),
      ctx('11111111-1111-4111-8111-111111111111'),
    );
    expect(delFailed.status).toBe(500);

    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_grants_decide',
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_grants_revoke',
    });
  });
});
