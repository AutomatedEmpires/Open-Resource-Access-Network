import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeCount: vi.fn(),
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const searchMock = vi.hoisted(() => vi.fn());
const orchestrateChatMock = vi.hoisted(() => vi.fn());
const isEnabledMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

class MockChatRateLimitExceededError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('rate limited');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/search/engine', () => ({
  ServiceSearchEngine: class {
    search = searchMock;
  },
}));
vi.mock('@/services/chat/orchestrator', () => ({
  orchestrateChat: orchestrateChatMock,
  ChatRateLimitExceededError: MockChatRateLimitExceededError,
}));
vi.mock('@/services/flags/flags', () => ({
  flagService: {
    isEnabled: isEnabledMock,
  },
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(options: {
  jsonBody?: unknown;
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
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  authMocks.getAuthContext.mockResolvedValue(null);
  searchMock.mockResolvedValue({ results: [] });
  isEnabledMock.mockReturnValue(false);
  orchestrateChatMock.mockResolvedValue({ reply: 'ok' });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/chat route', () => {
  it('returns 405 for GET requests', async () => {
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when the request body is invalid JSON', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when the chat payload fails validation', async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: { message: '', sessionId: 'bad-id' },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('builds an IP-based rate-limit key for anonymous users', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    orchestrateChatMock.mockImplementationOnce(async (_message, _sessionId, userId, _locale, rateLimitKey, deps) => {
      const services = await deps.retrieveServices({ rawQuery: 'food' }, { userId });
      return { rateLimitKey, userId, services, summaries: deps.isFlagEnabled('chat-summary') };
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        ip: '203.0.113.20',
        jsonBody: {
          message: 'food',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rateLimitKey: 'chat:ip:203.0.113.20',
      userId: undefined,
      services: [],
      summaries: false,
    });
  });

  it('loads city bias and retrieves services for authenticated users', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{ approximate_city: 'Denver' }]);
    searchMock.mockResolvedValueOnce({
      results: [
        {
          service: {
            id: 'svc-1',
            name: 'Food Pantry',
          },
        },
      ],
    });
    orchestrateChatMock.mockImplementationOnce(async (_message, _sessionId, userId, _locale, rateLimitKey, deps) => {
      const services = await deps.retrieveServices({ rawQuery: 'food' }, { userId });
      return { rateLimitKey, services };
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'food',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith({
      text: 'food',
      filters: {
        status: 'active',
      },
      pagination: {
        page: 1,
        limit: 5,
      },
      cityBias: 'Denver',
    });
    await expect(response.json()).resolves.toEqual({
      rateLimitKey: 'chat:user:user-1',
      services: [
        {
          id: 'svc-1',
          name: 'Food Pantry',
        },
      ],
    });
  });

  it('returns 429 when the orchestrator raises a chat rate-limit error', async () => {
    orchestrateChatMock.mockRejectedValueOnce(new MockChatRateLimitExceededError(30));
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'help',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
        },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('returns 500 when the orchestrator throws an unexpected error', async () => {
    orchestrateChatMock.mockRejectedValueOnce(new Error('boom'));
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'help',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
