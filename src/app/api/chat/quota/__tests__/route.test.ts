import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookiesMock = vi.hoisted(() => vi.fn());
const getAuthContextMock = vi.hoisted(() => vi.fn());
const checkQuotaByIdentityMock = vi.hoisted(() => vi.fn());
const checkRateLimitSharedMock = vi.hoisted(() => vi.fn());
const getIpMock = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: cookiesMock }));
vi.mock('@/services/auth/session', () => ({ getAuthContext: getAuthContextMock }));
vi.mock('@/services/chat/quota', () => ({
  checkQuotaByIdentity: checkQuotaByIdentityMock,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: checkRateLimitSharedMock,
}));
vi.mock('@/services/security/ip', () => ({ getIp: getIpMock }));

async function loadRoute() {
  return import('../route');
}

describe('api/chat/quota route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getIpMock.mockReturnValue('203.0.113.10');
    checkRateLimitSharedMock.mockResolvedValue({
      backendUnavailable: false,
      exceeded: false,
      retryAfterSeconds: 60,
    });
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
    getAuthContextMock.mockResolvedValue(null);
    checkQuotaByIdentityMock.mockResolvedValue({
      remaining: 10,
      resetAt: undefined,
    });
  });

  it('reports the anonymous launch allowance as 10 before an identity exists', async () => {
    const { GET } = await loadRoute();
    const response = await GET({} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ remaining: 10, resetAt: null });
    expect(checkQuotaByIdentityMock).not.toHaveBeenCalled();
  });

  it('reads the most restrictive persisted account/device quota', async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: '11111111-1111-4111-8111-111111111111' }),
    });
    getAuthContextMock.mockResolvedValue({ userId: 'user-1' });
    checkQuotaByIdentityMock.mockResolvedValue({
      remaining: 4,
      resetAt: new Date('2027-01-16T00:00:00.000Z'),
    });
    const { GET } = await loadRoute();
    const response = await GET({} as never);

    expect(checkQuotaByIdentityMock).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'user-1',
    );
    await expect(response.json()).resolves.toEqual({
      remaining: 4,
      resetAt: '2027-01-16T00:00:00.000Z',
    });
  });

  it('rate-limits abusive quota polling', async () => {
    checkRateLimitSharedMock.mockResolvedValue({
      backendUnavailable: false,
      exceeded: true,
      retryAfterSeconds: 30,
    });
    const { GET } = await loadRoute();
    const response = await GET({} as never);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('fails closed when the shared limiter is unavailable', async () => {
    checkRateLimitSharedMock.mockResolvedValue({
      backendUnavailable: true,
      exceeded: false,
      retryAfterSeconds: 12,
    });
    const { GET } = await loadRoute();
    const response = await GET({} as never);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('rejects POST', async () => {
    const { POST } = await loadRoute();
    const response = await POST();
    expect(response.status).toBe(405);
  });
});
