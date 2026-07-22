import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ isDatabaseConfigured: vi.fn() }));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const erasureMocks = vi.hoisted(() => ({
  queueAccountErasure: vi.fn(),
  processAccountErasure: vi.fn(),
  isAccountErasureUnavailable: vi.fn((error: unknown) => (
    error instanceof Error && error.name === 'AccountErasureUnavailableError'
  )),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/privacy/accountErasure', () => erasureMocks);
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

function createRequest(ip = '127.0.0.1') {
  const headers = new Headers({ 'x-forwarded-for': ip });
  return {
    headers,
    nextUrl: new URL('https://oran.test/api/user/data-delete'),
    url: 'https://oran.test/api/user/data-delete',
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({
    clerkUserId: 'user_clerk_1',
    userId: 'user-1',
    role: 'seeker',
    accountStatus: 'active',
    orgIds: [],
    orgRoles: new Map(),
  });
  erasureMocks.queueAccountErasure.mockResolvedValue({
    requestId: '11111111-1111-4111-8111-111111111111',
    status: 'pending',
    userId: 'user-1',
    clerkUserId: 'user_clerk_1',
    leaseAcquired: true,
  });
  erasureMocks.processAccountErasure.mockResolvedValue({
    completed: true,
    requestId: '11111111-1111-4111-8111-111111111111',
    status: 'completed',
    accessRevoked: true,
    identityProviderDeleted: true,
    nextStep: null,
  });
  captureExceptionMock.mockResolvedValue(undefined);
});
describe('DELETE /api/user/data-delete', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { DELETE } = await import('../route');
    expect((await DELETE(createRequest())).status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());
    expect(res.status).toBe(401);
    expect(erasureMocks.queueAccountErasure).not.toHaveBeenCalled();
  });

  it('fails closed when the shared rate limiter is unavailable', async () => {
    rateLimitMock.mockResolvedValue({
      exceeded: true,
      backendUnavailable: true,
      retryAfterSeconds: 600,
    });
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());
    expect(res.status).toBe(503);
    expect(erasureMocks.queueAccountErasure).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockResolvedValue({ exceeded: true, retryAfterSeconds: 600 });
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest('203.0.113.20'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
  });

  it('revokes, deletes the Clerk identity, and completes durable erasure', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: 'completed',
      message: 'Your account and personal data have been deleted.',
    });
    expect(erasureMocks.queueAccountErasure).toHaveBeenCalledWith(
      'user-1',
      'user_clerk_1',
    );
    expect(erasureMocks.processAccountErasure).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: '11111111-1111-4111-8111-111111111111' }),
    );
  });

  it('returns accepted after revocation when the durable worker must retry', async () => {
    erasureMocks.processAccountErasure.mockResolvedValueOnce({
      completed: false,
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 'processing',
      accessRevoked: true,
      identityProviderDeleted: true,
      nextStep: 'secure_data_erasure',
    });
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'pending',
      accessRevoked: true,
      identityProviderDeleted: true,
      erasureStatus: 'in_progress',
      nextStep: 'secure_data_erasure',
    });
    expect(body).not.toHaveProperty('tombstone');
    expect(body).not.toHaveProperty('requestId');
    expect(body).not.toHaveProperty('cursor');
    expect(body).not.toHaveProperty('currentStep');
  });

  it('does not race the worker when another invocation already owns the lease', async () => {
    erasureMocks.queueAccountErasure.mockResolvedValueOnce({
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 'processing',
      userId: 'user-1',
      clerkUserId: 'user_clerk_1',
      leaseAcquired: false,
    });
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());

    expect(res.status).toBe(202);
    expect(erasureMocks.processAccountErasure).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      accessRevoked: true,
      erasureStatus: 'in_progress',
    });
  });

  it('stays accepted after a post-queue processing exception', async () => {
    erasureMocks.processAccountErasure.mockRejectedValueOnce(new Error('worker unavailable'));
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({
      status: 'pending',
      accessRevoked: true,
      identityProviderDeleted: null,
      erasureStatus: 'queued',
      nextStep: null,
    });
  });

  it('returns 500 when the durable request cannot be queued', async () => {
    erasureMocks.queueAccountErasure.mockRejectedValueOnce(new Error('db unavailable'));
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to queue account deletion.' });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });

  it('returns 503 while the online index gate is not active', async () => {
    const unavailable = new Error('not ready');
    unavailable.name = 'AccountErasureUnavailableError';
    erasureMocks.queueAccountErasure.mockRejectedValueOnce(unavailable);
    const { DELETE } = await import('../route');
    const res = await DELETE(createRequest());

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
