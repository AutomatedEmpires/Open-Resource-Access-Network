import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getTokenMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

const originalClientId = process.env.AZURE_AD_CLIENT_ID;
const originalNodeEnv = process.env.NODE_ENV;
const originalSecret = process.env.NEXTAUTH_SECRET;
const mutableEnv = process.env as Record<string, string | undefined>;

async function loadMiddlewareModule() {
  return import('../proxy');
}

function makeRequest(pathname: string) {
  return makeRequestWithOptions(pathname);
}

function makeRequestWithOptions(
  pathname: string,
  options: {
    method?: string;
    origin?: string;
    fetchSite?: string;
    authorization?: string;
  } = {},
) {
  const url = new URL(`https://oran.test${pathname}`);
  const headers = new Headers();

  if (options.origin) {
    headers.set('origin', options.origin);
  }
  if (options.fetchSite) {
    headers.set('sec-fetch-site', options.fetchSite);
  }
  if (options.authorization) {
    headers.set('authorization', options.authorization);
  }

  return {
    method: options.method ?? 'GET',
    headers,
    nextUrl: url,
    url: url.toString(),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mutableEnv.AZURE_AD_CLIENT_ID;
  delete mutableEnv.NEXTAUTH_SECRET;
  mutableEnv.NODE_ENV = 'test';
});

afterEach(() => {
  if (originalClientId === undefined) {
    delete mutableEnv.AZURE_AD_CLIENT_ID;
  } else {
    mutableEnv.AZURE_AD_CLIENT_ID = originalClientId;
  }

  if (originalSecret === undefined) {
    delete mutableEnv.NEXTAUTH_SECRET;
  } else {
    mutableEnv.NEXTAUTH_SECRET = originalSecret;
  }

  if (originalNodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalNodeEnv;
  }
});

describe('middleware', () => {
  it('passes through unprotected routes without checking auth', async () => {
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/public-page'));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes through protected routes in non-production when Entra is not configured', async () => {
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/saved'));

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('fails closed in production when auth is not configured', async () => {
    mutableEnv.NODE_ENV = 'production';
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/saved'));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toContain('Authentication is not configured');
  });

  it('redirects protected routes to sign-in when no token is present', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    mutableEnv.NEXTAUTH_SECRET = 'secret';
    getTokenMock.mockResolvedValue(null);
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/saved'));

    expect(getTokenMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://oran.test/api/auth/signin?callbackUrl=%2Fsaved');
  });

  it('returns forbidden when the token role is insufficient', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    getTokenMock.mockResolvedValue({ role: 'seeker' });
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/approvals'));

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain('Forbidden');
  });

  it('allows the request when the token role satisfies the route requirement', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    getTokenMock.mockResolvedValue({ role: 'oran_admin' });
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/approvals'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('fails closed in production if token parsing throws', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    mutableEnv.NODE_ENV = 'production';
    getTokenMock.mockRejectedValue(new Error('jwt unavailable'));
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/saved'));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toContain('temporarily unavailable');
  });

  it('fails open outside production if token parsing throws', async () => {
    mutableEnv.AZURE_AD_CLIENT_ID = 'client-id';
    mutableEnv.NODE_ENV = 'development';
    getTokenMock.mockRejectedValue(new Error('jwt unavailable'));
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(makeRequest('/saved'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('blocks cross-site writes to protected API routes in production', async () => {
    mutableEnv.NODE_ENV = 'production';
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(
      makeRequestWithOptions('/api/profile', {
        method: 'PUT',
        origin: 'https://evil.test',
      }),
    );

    expect(getTokenMock).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain('Cross-site');
  });

  it('allows same-origin writes to protected API routes', async () => {
    mutableEnv.NODE_ENV = 'production';
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(
      makeRequestWithOptions('/api/profile', {
        method: 'PUT',
        origin: 'https://oran.test',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('allows same-origin writes via fetch metadata fallback', async () => {
    mutableEnv.NODE_ENV = 'production';
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(
      makeRequestWithOptions('/api/saved', {
        method: 'POST',
        fetchSite: 'same-origin',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not apply the same-origin write guard to internal bearer routes', async () => {
    mutableEnv.NODE_ENV = 'production';
    const { proxy: middleware } = await loadMiddlewareModule();

    const response = await middleware(
      makeRequestWithOptions('/api/internal/sla-check', {
        method: 'POST',
        authorization: 'Bearer test-secret',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
