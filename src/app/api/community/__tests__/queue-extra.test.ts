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
const engineMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
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
vi.mock('@/services/workflow/engine', () => engineMocks);

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

async function loadQueueRoute() {
  return import('../queue/route');
}

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);

  authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
  requireMinRoleMock.mockReturnValue(true);

  engineMocks.acquireLock.mockResolvedValue(true);
  engineMocks.advance.mockResolvedValue({ success: true, fromStatus: 'submitted', toStatus: 'under_review', transitionId: 'tx-1' });
  engineMocks.releaseLock.mockResolvedValue(undefined);
});

describe('community queue extra coverage', () => {
  it('covers GET db/rate/auth/permission/validation/success/error branches', async () => {
    const { GET } = await loadQueueRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await GET(createRequest());
    expect(noDb.status).toBe(503);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 12 });
    const limited = await GET(createRequest());
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await GET(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await GET(createRequest());
    expect(forbidden.status).toBe(403);

    const invalid = await GET(createRequest({ search: '?limit=101' }));
    expect(invalid.status).toBe(400);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ id: 'sub-1' }]);
    const listed = await GET(
      createRequest({
        search: '?status=submitted&type=org_claim&assignedToMe=true&page=2&limit=1',
      }),
    );
    expect(listed.status).toBe(200);
    expect(dbMocks.executeQuery.mock.calls[0]?.[0]).toContain('sub.status =');
    expect(dbMocks.executeQuery.mock.calls[0]?.[0]).toContain('sub.submission_type =');
    expect(dbMocks.executeQuery.mock.calls[0]?.[0]).toContain('sub.assigned_to_user_id =');

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('list failed'));
    const failed = await GET(createRequest());
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_community_queue_list',
    });
  });

  it('covers POST db/rate/auth/permission/json/validation/lock/error branches', async () => {
    const { POST } = await loadQueueRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await POST(createRequest());
    expect(noDb.status).toBe(503);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 7 });
    const limited = await POST(createRequest());
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await POST(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await POST(createRequest());
    expect(forbidden.status).toBe(403);

    const badJson = await POST(createRequest({ jsonError: true }));
    expect(badJson.status).toBe(400);

    const invalid = await POST(createRequest({ jsonBody: { submissionId: 'bad-id' } }));
    expect(invalid.status).toBe(400);

    engineMocks.acquireLock.mockResolvedValueOnce(false);
    const lockFail = await POST(createRequest({ jsonBody: { submissionId: SUBMISSION_ID } }));
    expect(lockFail.status).toBe(409);

    engineMocks.acquireLock.mockResolvedValueOnce(true);
    engineMocks.advance.mockResolvedValueOnce({ success: false, error: 'Transition denied' });
    const transitionFail = await POST(createRequest({ jsonBody: { submissionId: SUBMISSION_ID } }));
    expect(transitionFail.status).toBe(409);
    expect(engineMocks.releaseLock).toHaveBeenCalledWith(SUBMISSION_ID, 'community-1', false);

    engineMocks.acquireLock.mockResolvedValueOnce(true);
    engineMocks.advance.mockRejectedValueOnce(new Error('engine exploded'));
    engineMocks.releaseLock.mockRejectedValueOnce(new Error('release failed'));
    const failed = await POST(createRequest({ jsonBody: { submissionId: SUBMISSION_ID } }));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_community_queue_assign',
    });
  });
});
