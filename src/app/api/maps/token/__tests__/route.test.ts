import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));

function createRequest(ip?: string) {
  const headers = new Headers();
  if (ip) {
    headers.set('x-forwarded-for', ip);
  }

  return {
    headers,
  } as never;
}

async function loadRoute() {
  return import('../route');
}

const originalMapsKey = process.env.AZURE_MAPS_KEY;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  process.env.AZURE_MAPS_KEY = originalMapsKey;
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
});

describe('api/maps/token route', () => {
  it('returns 429 when rate limiting blocks token requests', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 11,
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest('203.0.113.40'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('11');
  });

  it('returns 503 when Azure Maps is not configured', async () => {
    delete process.env.AZURE_MAPS_KEY;
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Azure Maps is not configured on the server.',
    });
  });

  it('returns the configured Azure Maps subscription key', async () => {
    process.env.AZURE_MAPS_KEY = 'test-key';
    const { GET } = await loadRoute();

    const response = await GET(createRequest('203.0.113.41'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    await expect(response.json()).resolves.toEqual({ subscriptionKey: 'test-key' });
  });
});
