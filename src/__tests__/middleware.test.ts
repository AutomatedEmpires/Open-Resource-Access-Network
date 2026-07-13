import type { NextFetchEvent, NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ClerkBoundaryHandler = (
  auth: () => Promise<{ userId: string | null }>,
  request: NextRequest,
) => Response | Promise<Response>;

const clerkMocks = vi.hoisted(() => ({
  userId: vi.fn(),
  middleware: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: clerkMocks.middleware.mockImplementation(
    (handler: ClerkBoundaryHandler) => async (request: NextRequest) => handler(
      async () => ({ userId: await clerkMocks.userId() as string | null }),
      request,
    ),
  ),
}));

const mutableEnv = process.env as Record<string, string | undefined>;
const originalEnv = {
  nodeEnv: process.env.NODE_ENV,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
};

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
    host?: string;
    fetchSite?: string;
    authorization?: string;
  } = {},
): NextRequest {
  const url = new URL(`https://oran.test${pathname}`);
  const headers = new Headers();

  if (options.origin) headers.set('origin', options.origin);
  if (options.host) headers.set('host', options.host);
  if (options.fetchSite) headers.set('sec-fetch-site', options.fetchSite);
  if (options.authorization) headers.set('authorization', options.authorization);

  return {
    method: options.method ?? 'GET',
    headers,
    nextUrl: url,
    url: url.toString(),
  } as unknown as NextRequest;
}

function makeEvent(): NextFetchEvent {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as NextFetchEvent;
}

async function runRequest(request: NextRequest): Promise<Response> {
  const { proxy } = await loadMiddlewareModule();
  return proxy(request, makeEvent());
}

function configureClerk() {
  mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_oran';
  mutableEnv.CLERK_SECRET_KEY = 'sk_test_oran';
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete mutableEnv.CLERK_SECRET_KEY;
  mutableEnv.NODE_ENV = 'test';
  clerkMocks.userId.mockResolvedValue(null);
});

afterEach(() => {
  if (originalEnv.publishableKey === undefined) {
    delete mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  } else {
    mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalEnv.publishableKey;
  }
  if (originalEnv.secretKey === undefined) {
    delete mutableEnv.CLERK_SECRET_KEY;
  } else {
    mutableEnv.CLERK_SECRET_KEY = originalEnv.secretKey;
  }
  if (originalEnv.nodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalEnv.nodeEnv;
  }
});

describe('Clerk request boundary', () => {
  it('passes through public routes when Clerk is not configured', async () => {
    const response = await runRequest(makeRequest('/public-page'));

    expect(clerkMocks.userId).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes through protected routes only for unconfigured local development', async () => {
    mutableEnv.NODE_ENV = 'development';
    const response = await runRequest(makeRequest('/saved'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('fails closed on protected routes when production Clerk config is missing', async () => {
    mutableEnv.NODE_ENV = 'production';
    const response = await runRequest(makeRequest('/saved'));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toContain('Authentication is not configured');
  });

  it('redirects a signed-out user to the Clerk sign-in route with a safe relative return path', async () => {
    configureClerk();
    const response = await runRequest(makeRequest('/saved?view=compact'));

    expect(clerkMocks.userId).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://oran.test/auth/signin?redirect_url=%2Fsaved%3Fview%3Dcompact',
    );
  });

  it('allows authenticated identity through while leaving roles to ORAN data guards', async () => {
    configureClerk();
    clerkMocks.userId.mockResolvedValue('user_clerk_1');
    const response = await runRequest(makeRequest('/approvals'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('fails closed on protected routes when Clerk identity resolution is unavailable', async () => {
    configureClerk();
    clerkMocks.userId.mockRejectedValueOnce(new Error('Clerk unavailable'));
    const response = await runRequest(makeRequest('/profile'));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toContain('temporarily unavailable');
  });

  it('keeps public discovery available during a Clerk interruption', async () => {
    configureClerk();
    clerkMocks.userId.mockRejectedValueOnce(new Error('Clerk unavailable'));
    const response = await runRequest(makeRequest('/directory'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('blocks cross-site writes to protected API routes', async () => {
    mutableEnv.NODE_ENV = 'production';
    const response = await runRequest(makeRequestWithOptions('/api/profile', {
      method: 'PUT',
      origin: 'https://evil.test',
    }));

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain('Cross-site');
  });

  it('allows same-origin writes to protected API routes', async () => {
    mutableEnv.NODE_ENV = 'production';
    const response = await runRequest(makeRequestWithOptions('/api/profile', {
      method: 'PUT',
      origin: 'https://oran.test',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('accepts forwarded hosts when Origin matches the actual request Host', async () => {
    mutableEnv.NODE_ENV = 'production';
    const response = await runRequest(makeRequestWithOptions('/api/chat', {
      method: 'POST',
      origin: 'http://127.0.0.1:3100',
      host: '127.0.0.1:3100',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('allows same-origin writes via fetch metadata fallback', async () => {
    mutableEnv.NODE_ENV = 'production';
    const response = await runRequest(makeRequestWithOptions('/api/saved', {
      method: 'POST',
      fetchSite: 'same-origin',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('allows bearer-authenticated internal writes outside the guarded prefixes', async () => {
    mutableEnv.NODE_ENV = 'production';
    const response = await runRequest(makeRequestWithOptions('/api/internal/sla-check', {
      method: 'POST',
      authorization: 'Bearer test-secret',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    '/host',
    '/host-forms',
    '/resource-studio',
    '/community-forms',
    '/discovery-preview',
    '/forms',
  ])('protects the scoped workspace route %s', async (route) => {
    configureClerk();
    const response = await runRequest(makeRequest(route));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth/signin');
  });
});
