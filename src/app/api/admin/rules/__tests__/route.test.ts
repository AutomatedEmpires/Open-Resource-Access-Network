import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const flagServiceMocks = vi.hoisted(() => ({
  getAllFlags: vi.fn(),
  setFlag: vi.fn(),
  getFlag: vi.fn(),
}));
const getFlagServiceImplementationMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/flags/flags', () => ({
  flagService: flagServiceMocks,
  getFlagServiceImplementation: getFlagServiceImplementationMock,
}));

function createRequest(options: { ip?: string; body?: unknown; jsonError?: boolean } = {}) {
  const headers = new Headers();
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('bad json'))
      : vi.fn().mockResolvedValue(options.body),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
  flagServiceMocks.getAllFlags.mockResolvedValue([]);
  flagServiceMocks.setFlag.mockResolvedValue(undefined);
  flagServiceMocks.getFlag.mockResolvedValue({ name: 'x', enabled: true, rolloutPct: 100 });
  getFlagServiceImplementationMock.mockResolvedValue('in_memory');
});

describe('admin rules route', () => {
  it('handles GET rate-limit/auth/authz and failure branch', async () => {
    const { GET } = await import('../route');

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 3 });
    const limited = await GET(createRequest({ ip: '203.0.113.3' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('3');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await GET(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await GET(createRequest());
    expect(forbidden.status).toBe(403);

    flagServiceMocks.getAllFlags.mockRejectedValueOnce(new Error('flag read failed'));
    const failed = await GET(createRequest());
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_rules_list',
    });
  });

  it('returns flags for GET success', async () => {
    flagServiceMocks.getAllFlags.mockResolvedValueOnce([
      { name: 'chat-summary', enabled: true, rolloutPct: 50 },
    ]);
    const { GET } = await import('../route');

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      flags: [{ name: 'chat-summary', enabled: true, rolloutPct: 50 }],
      implementation: 'in_memory',
    });
  });

  it('handles PUT guards, validation, default rollout, and error branch', async () => {
    const { PUT } = await import('../route');

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 8 });
    const limited = await PUT(createRequest({ ip: '203.0.113.8' }));
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await PUT(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await PUT(createRequest());
    expect(forbidden.status).toBe(403);

    const badJson = await PUT(createRequest({ jsonError: true }));
    expect(badJson.status).toBe(400);

    const invalid = await PUT(createRequest({ body: { name: '', enabled: true } }));
    expect(invalid.status).toBe(400);

    flagServiceMocks.getFlag.mockResolvedValueOnce({
      name: 'chat-summary',
      enabled: false,
      rolloutPct: 100,
    });
    const success = await PUT(createRequest({ body: { name: 'chat-summary', enabled: false } }));
    expect(success.status).toBe(200);
    expect(flagServiceMocks.setFlag).toHaveBeenCalledWith('chat-summary', false, 100, {
      actorUserId: 'oran-1',
      actorRole: 'oran_admin',
      reason: 'Updated via ORAN admin rules API',
    });

    await expect(success.json()).resolves.toEqual({
      success: true,
      flag: {
        name: 'chat-summary',
        enabled: false,
        rolloutPct: 100,
      },
      implementation: 'in_memory',
      message: 'Flag "chat-summary" updated: disabled at 100% rollout.',
    });

    flagServiceMocks.setFlag.mockRejectedValueOnce(new Error('flag write failed'));
    const failed = await PUT(createRequest({ body: { name: 'chat-summary', enabled: true, rolloutPct: 20 } }));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_rules_update',
    });
  });
});
