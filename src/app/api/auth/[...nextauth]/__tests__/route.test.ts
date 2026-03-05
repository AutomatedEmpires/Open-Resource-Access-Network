import { beforeEach, describe, expect, it, vi } from 'vitest';

const nextAuthHandlerMock = vi.hoisted(() => vi.fn());
const nextAuthFactoryMock = vi.hoisted(() => vi.fn(() => nextAuthHandlerMock));
const checkRateLimitMock = vi.hoisted(() => vi.fn());
const authOptionsMock = vi.hoisted(() => ({ providers: ['entra'] }));

vi.mock('next-auth', () => ({
  default: nextAuthFactoryMock,
}));
vi.mock('@/lib/auth', () => ({
  authOptions: authOptionsMock,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

async function loadRouteModule() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  nextAuthHandlerMock.mockResolvedValue(new Response('ok', { status: 200 }));
  checkRateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
});

describe('nextauth route', () => {
  it('initializes NextAuth and applies auth rate limiting to GET', async () => {
    const { GET } = await loadRouteModule();
    const req = {
      headers: new Headers(),
    };
    const ctx = {
      params: Promise.resolve({ nextauth: ['signin'] }),
    };

    const response = await GET(req as never, ctx);

    expect(nextAuthFactoryMock).toHaveBeenCalledWith(authOptionsMock);
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      'auth:unknown',
      expect.objectContaining({ maxRequests: 30 }),
    );
    expect(nextAuthHandlerMock).toHaveBeenCalledWith(req, {
      params: { nextauth: ['signin'] },
    });
    expect(response.status).toBe(200);
  });

  it('returns 429 responses when the auth route is rate limited', async () => {
    checkRateLimitMock.mockReturnValue({
      exceeded: true,
      retryAfterSeconds: 12,
    });
    const { GET } = await loadRouteModule();

    const response = await GET(
      {
        headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
      } as never,
      { params: Promise.resolve({ nextauth: ['signin'] }) },
    );

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      'auth:203.0.113.9',
      expect.objectContaining({ maxRequests: 30 }),
    );
    expect(nextAuthHandlerMock).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    await expect(response.json()).resolves.toEqual({ error: 'Rate limit exceeded.' });
  });

  it('passes POST requests through to NextAuth after the guard check', async () => {
    nextAuthHandlerMock.mockResolvedValue(new Response('created', { status: 201 }));
    const { POST } = await loadRouteModule();
    const req = {
      headers: new Headers({ 'x-forwarded-for': '198.51.100.4, 10.0.0.9' }),
    };
    const ctx = {
      params: Promise.resolve({ nextauth: ['callback', 'azure-ad'] }),
    };

    const response = await POST(req as never, ctx);

    expect(checkRateLimitMock).toHaveBeenCalledWith(
      'auth:198.51.100.4',
      expect.objectContaining({ maxRequests: 30 }),
    );
    expect(nextAuthHandlerMock).toHaveBeenCalledWith(req, {
      params: { nextauth: ['callback', 'azure-ad'] },
    });
    expect(response.status).toBe(201);
  });
});
