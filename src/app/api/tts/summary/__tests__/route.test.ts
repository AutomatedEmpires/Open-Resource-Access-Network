import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const isEnabledMock = vi.hoisted(() => vi.fn());
const ttsMocks = vi.hoisted(() => ({
  synthesizeSpeech: vi.fn(),
  isConfigured: vi.fn(),
}));
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/flags/flags', () => ({
  flagService: {
    isEnabled: isEnabledMock,
  },
}));
vi.mock('@/services/tts/azureSpeech', () => ttsMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(options: {
  body?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('bad json'))
      : vi.fn().mockResolvedValue(options.body),
  } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  isEnabledMock.mockResolvedValue(true);
  ttsMocks.isConfigured.mockReturnValue(true);
  ttsMocks.synthesizeSpeech.mockResolvedValue(Buffer.from([1, 2, 3]));
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/tts/summary route', () => {
  it('returns 405 for GET', async () => {
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed.' });
  });

  it('returns 401 for unauthenticated requests', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ body: { text: 'hello' } }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required.' });
  });

  it('enforces rate limiting', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 12 });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ body: { text: 'hello' }, ip: '203.0.113.10' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('checks feature flag and service configuration', async () => {
    const { POST } = await loadRoute();

    isEnabledMock.mockResolvedValueOnce(false);
    const disabled = await POST(createRequest({ body: { text: 'hello' } }));
    expect(disabled.status).toBe(403);

    isEnabledMock.mockResolvedValueOnce(true);
    ttsMocks.isConfigured.mockReturnValueOnce(false);
    const notConfigured = await POST(createRequest({ body: { text: 'hello' } }));
    expect(notConfigured.status).toBe(503);
  });

  it('validates request JSON and body schema', async () => {
    const { POST } = await loadRoute();

    const badJson = await POST(createRequest({ jsonError: true }));
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toEqual({ error: 'Invalid JSON body.' });

    const invalidBody = await POST(createRequest({ body: { text: '' } }));
    expect(invalidBody.status).toBe(400);
    const payload = await invalidBody.json();
    expect(payload.error).toBe('Invalid request.');
    expect(Array.isArray(payload.details)).toBe(true);
  });

  it('returns 502 when synthesis fails', async () => {
    ttsMocks.synthesizeSpeech.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ body: { text: 'hello', locale: 'en' } }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Speech synthesis failed.' });
  });

  it('returns audio/mpeg bytes when synthesis succeeds', async () => {
    ttsMocks.synthesizeSpeech.mockResolvedValueOnce(Buffer.from([9, 8, 7]));
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ body: { text: 'hello world', locale: 'es' } }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Length')).toBe('3');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([9, 8, 7]).buffer);
    expect(ttsMocks.synthesizeSpeech).toHaveBeenCalledWith('hello world', { locale: 'es' });
  });

  it('captures synthesis exceptions and returns 500', async () => {
    ttsMocks.synthesizeSpeech.mockRejectedValueOnce(new Error('azure down'));
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ body: { text: 'hello' } }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error.' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_tts_summary',
      userId: 'user-1',
    });
  });
});
