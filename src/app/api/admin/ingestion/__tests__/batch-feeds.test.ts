import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const getDrizzleMock = vi.hoisted(() => vi.fn());
const storeFactoryMocks = vi.hoisted(() => ({
  createIngestionStores: vi.fn(),
}));
const createIngestionServiceMock = vi.hoisted(() => vi.fn());
const runBatchMock = vi.hoisted(() => vi.fn());
const pollFeedsMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: dbConfigMock,
}));
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
vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: getDrizzleMock,
}));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => storeFactoryMocks);
vi.mock('@/agents/ingestion/service', () => ({
  createIngestionService: createIngestionServiceMock,
}));

function createRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL('https://oran.test');
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

async function loadBatchRoute() {
  return import('../batch/route');
}

async function loadFeedsPollRoute() {
  return import('../feeds/poll/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbConfigMock.mockReturnValue(true);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  getDrizzleMock.mockReturnValue({ kind: 'db' });
  storeFactoryMocks.createIngestionStores.mockReturnValue({ stores: true });
  createIngestionServiceMock.mockReturnValue({
    runBatch: runBatchMock,
    pollFeeds: pollFeedsMock,
  });
  runBatchMock.mockResolvedValue([{ url: 'https://example.org/a', status: 'queued' }]);
  pollFeedsMock.mockResolvedValue({
    polled: 2,
    queued: 2,
  });
});

describe('admin ingestion batch and feeds routes', () => {
  it('validates batch payloads before service invocation', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadBatchRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          urls: [],
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(runBatchMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe('Invalid input.');
  });

  it('queues batch URLs and returns submission summary', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadBatchRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          urls: ['https://example.org/a', 'https://example.org/b'],
          priority: 5,
        },
        ip: '203.0.113.10',
      }),
    );

    expect(rateLimitMock).toHaveBeenCalledWith('203.0.113.10', expect.any(Object));
    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(runBatchMock).toHaveBeenCalledWith(
      ['https://example.org/a', 'https://example.org/b'],
      'oran-1',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      submitted: 2,
      results: [{ url: 'https://example.org/a', status: 'queued' }],
    });
  });

  it('polls due feeds and returns result payload', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadFeedsPollRoute();

    const response = await POST(createRequest());

    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(pollFeedsMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      polled: 2,
      queued: 2,
    });
  });

  it('captures feed polling failures and responds with 500', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    pollFeedsMock.mockRejectedValueOnce(new Error('feed backend unavailable'));
    const { POST } = await loadFeedsPollRoute();

    const response = await POST(createRequest());

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error.',
    });
  });
});
