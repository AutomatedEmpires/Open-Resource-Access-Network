import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAGS } from '@/domain/constants';

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
const hydrateChatContextMock = vi.hoisted(() => vi.fn());
const isEnabledMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const translateBatchMock = vi.hoisted(() => vi.fn());
const isTranslatorConfiguredMock = vi.hoisted(() => vi.fn());

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
    hybridSearch = searchMock;
  },
}));
vi.mock('@/services/chat/orchestrator', () => ({
  orchestrateChat: orchestrateChatMock,
  ChatRateLimitExceededError: MockChatRateLimitExceededError,
}));
vi.mock('@/services/profile/chatHydration', () => ({
  hydrateChatContext: hydrateChatContextMock,
}));
vi.mock('@/services/flags/flags', () => ({
  flagService: {
    isEnabled: isEnabledMock,
  },
}));
vi.mock('@/services/i18n/translator', () => ({
  translateBatch: translateBatchMock,
  isConfigured: isTranslatorConfiguredMock,
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
  const routeModule = await import('../route');
  return {
    GET: routeModule.GET,
    POST: routeModule.POST,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  authMocks.getAuthContext.mockResolvedValue(null);
  searchMock.mockResolvedValue({ results: [], total: 0 });
  isEnabledMock.mockReturnValue(false);
  isTranslatorConfiguredMock.mockReturnValue(false);
  translateBatchMock.mockResolvedValue([]);
  orchestrateChatMock.mockResolvedValue({ reply: 'ok' });
  hydrateChatContextMock.mockImplementation(async (context: unknown) => context);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/chat route', () => {
  it('returns 405 for GET requests', async () => {
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
  }, 20_000);

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
      const retrieval = await deps.retrieveServices({ rawQuery: 'food' }, { userId });
      return {
        rateLimitKey,
        userId,
        services: retrieval.services,
        retrievalStatus: retrieval.retrievalStatus,
        summaries: deps.isFlagEnabled('chat-summary'),
      };
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        ip: '203.0.113.20',
        jsonBody: {
          message: 'food',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
          filters: {
            attributeFilters: {
              delivery: ['virtual'],
            },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rateLimitKey: 'chat:ip:203.0.113.20',
      userId: undefined,
      services: [],
      retrievalStatus: 'temporarily_unavailable',
      summaries: false,
    });
  });

  it('retrieves services for authenticated users with /api/search-aligned ordering', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
    });
    searchMock.mockResolvedValueOnce({
      results: [
        {
          service: {
            id: 'svc-1',
            name: 'Food Pantry',
          },
        },
      ],
      total: 1,
    });
    hydrateChatContextMock.mockResolvedValueOnce({
      sessionId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      locale: 'en',
      messageCount: 0,
      userProfile: {
        userId: 'user-1',
        serviceInterests: ['housing'],
        accessibilityNeeds: ['virtual_option', 'language_interpretation'],
        selfIdentifiers: ['pregnant'],
        householdType: 'single_parent',
        housingSituation: 'shelter',
        transportationBarrier: true,
        preferredDeliveryModes: ['in_person'],
        urgencyWindow: 'same_day',
        documentationBarriers: ['no_id'],
        digitalAccessBarrier: true,
      },
      approximateLocation: {
        city: 'Denver',
      },
    });
    orchestrateChatMock.mockImplementationOnce(async (_message, sessionId, userId, locale, rateLimitKey, deps) => {
      const context = await deps.hydrateContext?.({
        sessionId,
        userId,
        locale,
        messageCount: 0,
        userProfile: userId ? { userId } : undefined,
      });
      const retrieval = await deps.retrieveServices(
        { category: 'general', rawQuery: 'food', urgencyQualifier: 'standard' },
        context ?? { sessionId, userId, locale, messageCount: 0 },
      );
      return { rateLimitKey, services: retrieval.services, retrievalStatus: retrieval.retrievalStatus };
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'food',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
          filters: {
            attributeFilters: {
              delivery: ['virtual'],
            },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith(
      {
        text: 'food housing',
        cachePolicy: 'skip',
        geo: undefined,
        filters: {
          attributeFilters: { delivery: ['virtual'] },
          minConfidenceScore: undefined,
          organizationId: undefined,
          status: 'active',
          taxonomyTermIds: undefined,
        },
        cityBias: 'Denver',
        pagination: {
          page: 1,
          limit: 5,
        },
        profileSignals: {
          accessTags: ['interpreter_on_site', 'no_id_required', 'same_day', 'transportation_provided'],
          cultureTags: ['bilingual_services'],
          deliveryTags: ['virtual', 'phone', 'hybrid', 'in_person'],
          populationTags: ['pregnant', 'single_parent'],
          situationTags: ['no_fixed_address', 'language_barrier', 'transportation_barrier', 'digital_barrier'],
        },
        sortBy: 'relevance',
      },
    );
    await expect(response.json()).resolves.toEqual({
      rateLimitKey: 'chat:user:user-1',
      services: [
        {
          id: 'svc-1',
          name: 'Food Pantry',
        },
      ],
      retrievalStatus: 'results',
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

  it('applies trust/taxonomy filters when provided', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-filtered' });
    searchMock.mockResolvedValueOnce({
      results: [
        {
          service: {
            id: 'svc-1',
            name: 'Filtered Service',
          },
        },
      ],
      total: 1,
    });
    orchestrateChatMock.mockImplementationOnce(async (_message, _sessionId, userId, _locale, _rateLimitKey, deps) => {
      const retrieval = await deps.retrieveServices({ rawQuery: 'food' }, { userId });
      return { services: retrieval.services, retrievalStatus: retrieval.retrievalStatus };
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'food',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
          filters: {
            trust: 'HIGH',
            taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith({
      text: 'food',
      cachePolicy: 'skip',
      filters: {
        status: 'active',
        taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
        minConfidenceScore: 80,
      },
      cityBias: undefined,
      pagination: {
        page: 1,
        limit: 5,
      },
      profileSignals: undefined,
      sortBy: 'relevance',
    });
  });

  it('distinguishes no-match results from empty catalog scope', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-1' });
    searchMock
      .mockResolvedValueOnce({ results: [], total: 0 })
      .mockResolvedValueOnce({ results: [], total: 3 });
    orchestrateChatMock.mockImplementationOnce(async (_message, _sessionId, userId, _locale, _rateLimitKey, deps) => {
      const retrieval = await deps.retrieveServices({ rawQuery: 'rent help' }, { userId });
      return { retrievalStatus: retrieval.retrievalStatus, services: retrieval.services };
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'rent help',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      retrievalStatus: 'no_match',
      services: [],
    });
    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies profile-ignore requests without dropping active browse filters', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'user-1' });
    hydrateChatContextMock.mockResolvedValueOnce({
      sessionId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      locale: 'en',
      messageCount: 0,
      approximateLocation: { city: 'Denver' },
      userProfile: {
        userId: 'user-1',
        serviceInterests: ['food_assistance'],
      },
    });
    orchestrateChatMock.mockImplementationOnce(async (_message, sessionId, userId, locale, _rateLimitKey, deps) => {
      const context = await deps.hydrateContext?.({
        sessionId,
        userId,
        locale,
        messageCount: 0,
      });

      return context;
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'food',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
          profileMode: 'ignore',
          filters: {
            attributeFilters: {
              delivery: ['phone'],
            },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      locale: 'en',
      messageCount: 0,
      profileShapingDisabled: true,
      userProfile: {
        userId: 'user-1',
        browsePreference: {
          attributeFilters: {
            delivery: ['phone'],
          },
        },
      },
    });
  });

  it('merges active browse filters into hydrated chat context for deterministic result explanations', async () => {
    hydrateChatContextMock.mockResolvedValueOnce({
      sessionId: '11111111-1111-4111-8111-111111111111',
      userId: undefined,
      locale: 'en',
      messageCount: 0,
    });
    orchestrateChatMock.mockImplementationOnce(async (_message, sessionId, userId, locale, _rateLimitKey, deps) => {
      const context = await deps.hydrateContext?.({
        sessionId,
        userId,
        locale,
        messageCount: 0,
      });
      return context;
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'food',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
          filters: {
            taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
            attributeFilters: {
              delivery: ['phone'],
            },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: '11111111-1111-4111-8111-111111111111',
      userId: undefined,
      locale: 'en',
      messageCount: 0,
      userProfile: {
        userId: 'guest',
        browsePreference: {
          taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
          attributeFilters: {
            delivery: ['phone'],
          },
        },
      },
    });
  });

  it('translates descriptions when multilingual flag and translator are enabled for supported locales', async () => {
    isEnabledMock.mockImplementation((flagName: string) => flagName === FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS);
    isTranslatorConfiguredMock.mockReturnValue(true);
    translateBatchMock.mockResolvedValueOnce([
      { translatedText: 'Despensa de alimentos' },
      { translatedText: 'Refugio nocturno' },
    ]);
    orchestrateChatMock.mockResolvedValueOnce({
      reply: 'ok',
      services: [
        { id: 'svc-1', description: 'Food pantry' },
        { id: 'svc-2', description: 'Overnight shelter' },
      ],
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'help',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'es',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(translateBatchMock).toHaveBeenCalledWith(
      ['Food pantry', 'Overnight shelter'],
      'es',
    );
    await expect(response.json()).resolves.toEqual({
      reply: 'ok',
      services: [
        { id: 'svc-1', description: 'Despensa de alimentos' },
        { id: 'svc-2', description: 'Refugio nocturno' },
      ],
    });
  });

  it('skips translation for unsupported locales even when multilingual is enabled', async () => {
    isEnabledMock.mockImplementation((flagName: string) => flagName === FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS);
    isTranslatorConfiguredMock.mockReturnValue(true);
    orchestrateChatMock.mockResolvedValueOnce({
      reply: 'ok',
      services: [{ id: 'svc-1', description: 'Food pantry' }],
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'help',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'xx',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(translateBatchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      reply: 'ok',
      services: [{ id: 'svc-1', description: 'Food pantry' }],
    });
  });

  it('fails open when translation errors occur and keeps original descriptions', async () => {
    isEnabledMock.mockImplementation((flagName: string) => flagName === FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS);
    isTranslatorConfiguredMock.mockReturnValue(true);
    translateBatchMock.mockRejectedValueOnce(new Error('translator timeout'));
    orchestrateChatMock.mockResolvedValueOnce({
      reply: 'ok',
      services: [{ id: 'svc-1', description: 'Food pantry' }],
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'help',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'es',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reply: 'ok',
      services: [{ id: 'svc-1', description: 'Food pantry' }],
    });
  });
});
