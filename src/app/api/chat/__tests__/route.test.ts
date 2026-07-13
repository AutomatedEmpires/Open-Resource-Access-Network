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
const detectCrisisMock = vi.hoisted(() => vi.fn());
const hydrateChatContextMock = vi.hoisted(() => vi.fn());
const isEnabledMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const translateBatchMock = vi.hoisted(() => vi.fn());
const isTranslatorConfiguredMock = vi.hoisted(() => vi.fn());
const chatQuotaMocks = vi.hoisted(() => ({
  checkQuotaByIdentity: vi.fn(),
  finalizeChatRequest: vi.fn(),
  reserveChatRequest: vi.fn(),
}));

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
  detectCrisis: detectCrisisMock,
  ChatRateLimitExceededError: MockChatRateLimitExceededError,
}));
vi.mock('@/services/profile/chatHydration', () => ({
  hydrateChatContext: hydrateChatContextMock,
}));
vi.mock('@/services/chat/quota', () => chatQuotaMocks);
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
  detectCrisisMock.mockReturnValue(false);
  chatQuotaMocks.checkQuotaByIdentity.mockResolvedValue({
    sessionId: 'device:test',
    messageCount: 0,
    remaining: 50,
    exceeded: false,
    resetAt: undefined,
  });
  chatQuotaMocks.reserveChatRequest.mockImplementation(async (input: {
    requestId: string;
    deviceId: string;
    userId?: string;
  }) => ({
    ...input,
    decision: 'allowed',
    backend: 'database',
    quota: {
      sessionId: 'device:test',
      messageCount: 0,
      remaining: 50,
      exceeded: false,
      resetAt: undefined,
    },
    retryAfterSeconds: 60,
  }));
  chatQuotaMocks.finalizeChatRequest.mockResolvedValue({
    sessionId: 'device:test',
    messageCount: 0,
    remaining: 50,
    exceeded: false,
    resetAt: undefined,
  });
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
      quotaRemaining: 50,
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
      expect.objectContaining({
        text: 'food housing',
        cachePolicy: 'skip',
        geo: undefined,
        filters: expect.objectContaining({
          attributeFilters: { delivery: ['virtual'] },
          minConfidenceScore: undefined,
          organizationId: undefined,
          status: 'active',
          taxonomyTermIds: undefined,
        }),
        cityBias: 'Denver',
        pagination: expect.objectContaining({
          page: 1,
          limit: 15,
        }),
        profileSignals: expect.objectContaining({
          accessTags: ['interpreter_on_site', 'no_id_required', 'same_day', 'transportation_provided'],
          cultureTags: ['bilingual_services'],
          deliveryTags: ['virtual', 'phone', 'hybrid', 'in_person'],
          populationTags: ['pregnant', 'single_parent'],
          situationTags: ['no_fixed_address', 'language_barrier', 'transportation_barrier', 'digital_barrier'],
        }),
        sortBy: 'relevance',
      }),
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
      quotaRemaining: 50,
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
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'food',
      cachePolicy: 'skip',
      geo: undefined,
      filters: expect.objectContaining({
        status: 'active',
        organizationId: undefined,
        attributeFilters: undefined,
        taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
        minConfidenceScore: 80,
      }),
      cityBias: undefined,
      pagination: expect.objectContaining({
        page: 1,
        limit: 15,
      }),
      profileSignals: undefined,
      sortBy: 'relevance',
    }));
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
      quotaRemaining: 50,
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
      quotaRemaining: 50,
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
      quotaRemaining: 50,
    });
  });

  it('uses session context city and filters when the current request does not send explicit browse filters', async () => {
    searchMock.mockResolvedValueOnce({
      results: [],
      total: 0,
    }).mockResolvedValueOnce({
      results: [],
      total: 1,
    });
    orchestrateChatMock.mockImplementationOnce(async (_message, sessionId, userId, locale, _rateLimitKey, deps) => {
      const context = await deps.hydrateContext?.({
        sessionId,
        userId,
        locale,
        messageCount: 0,
      });
      const retrieval = await deps.retrieveServices(
        { category: 'housing', rawQuery: 'Anything open today?', urgencyQualifier: 'urgent', actionQualifier: 'hours' },
        context ?? { sessionId, userId, locale, messageCount: 0 },
      );
      return { retrievalStatus: retrieval.retrievalStatus, quotaRemaining: 50 };
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          message: 'Anything open today?',
          sessionId: '11111111-1111-4111-8111-111111111111',
          locale: 'en',
          sessionContext: {
            activeNeedId: 'housing',
            activeCity: 'Denver',
            trustFilter: 'HIGH',
            taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
            attributeFilters: {
              access: ['same_day'],
            },
            preferredDeliveryModes: ['phone'],
            profileShapingEnabled: true,
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cityBias: 'Denver',
        filters: expect.objectContaining({
          minConfidenceScore: 80,
          taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
          attributeFilters: {
            access: ['same_day'],
            delivery: ['phone'],
          },
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      retrievalStatus: 'no_match',
      quotaRemaining: 50,
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
      quotaRemaining: 50,
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
      quotaRemaining: 50,
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
      quotaRemaining: 50,
    });
  });

  it('bypasses every usage control for explicit self-crisis routing', async () => {
    detectCrisisMock.mockReturnValueOnce(true);
    chatQuotaMocks.checkQuotaByIdentity.mockResolvedValueOnce({
      sessionId: 'device:test',
      messageCount: 7,
      remaining: 3,
      exceeded: false,
      resetAt: undefined,
    });
    orchestrateChatMock.mockResolvedValueOnce({
      message: 'Call or text 988 now.',
      services: [],
      isCrisis: true,
      quotaRemaining: 20,
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'I want to kill myself',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(200);
    expect(chatQuotaMocks.reserveChatRequest).not.toHaveBeenCalled();
    expect(chatQuotaMocks.finalizeChatRequest).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      isCrisis: true,
      quotaRemaining: 20,
    });
  });

  it('bypasses quota for deterministic crisis-scope clarification', async () => {
    orchestrateChatMock.mockResolvedValueOnce({
      message: 'If someone is in immediate danger, call 911 now.',
      services: [],
      isCrisis: false,
      retrievalStatus: 'clarification_required',
      clarification: {
        reason: 'crisis_scope',
        prompt: 'If someone is in immediate danger, call 911 now.',
        suggestions: [],
      },
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'What is the suicide hotline?',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(200);
    expect(chatQuotaMocks.reserveChatRequest).not.toHaveBeenCalled();
    expect(chatQuotaMocks.finalizeChatRequest).not.toHaveBeenCalled();
  });

  it('releases quota when search is temporarily unavailable', async () => {
    orchestrateChatMock.mockResolvedValueOnce({
      message: 'Search is temporarily unavailable.',
      services: [],
      isCrisis: false,
      retrievalStatus: 'temporarily_unavailable',
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'Find food nearby',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(200);
    expect(chatQuotaMocks.finalizeChatRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'allowed' }),
      false,
    );
  });

  it('releases a reservation when orchestration errors', async () => {
    orchestrateChatMock.mockRejectedValueOnce(new Error('search exploded'));
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'Find rental help',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(500);
    expect(chatQuotaMocks.finalizeChatRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'allowed' }),
      false,
    );
  });

  it('commits quota only for a successful ordinary response', async () => {
    orchestrateChatMock.mockResolvedValueOnce({
      message: 'I found two services.',
      services: [],
      isCrisis: false,
      retrievalStatus: 'results',
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'Find a food pantry',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(200);
    expect(chatQuotaMocks.finalizeChatRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'allowed' }),
      true,
    );
  });

  it('returns an atomic quota denial before orchestration and establishes the device cookie', async () => {
    chatQuotaMocks.reserveChatRequest.mockResolvedValueOnce({
      requestId: '22222222-2222-4222-8222-222222222222',
      deviceId: '33333333-3333-4333-8333-333333333333',
      decision: 'quota_exceeded',
      backend: 'database',
      quota: {
        sessionId: 'device:test',
        messageCount: 10,
        remaining: 0,
        exceeded: true,
        resetAt: new Date('2027-01-16T00:00:00.000Z'),
      },
      retryAfterSeconds: 3600,
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'Find food',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3600');
    expect(response.headers.get('set-cookie')).toContain('oran-did=');
    expect(orchestrateChatMock).not.toHaveBeenCalled();
  });

  it('returns a retryable 503 when configured usage controls are unavailable', async () => {
    chatQuotaMocks.reserveChatRequest.mockResolvedValueOnce({
      requestId: '22222222-2222-4222-8222-222222222222',
      deviceId: '33333333-3333-4333-8333-333333333333',
      decision: 'unavailable',
      backend: 'database',
      quota: {
        sessionId: 'device:test',
        messageCount: 0,
        remaining: 10,
        exceeded: false,
        resetAt: undefined,
      },
      retryAfterSeconds: 30,
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'Find food',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain('oran-did=');
    await expect(response.json()).resolves.toEqual({
      error: 'Chat is temporarily unavailable. Please try again shortly.',
    });
    expect(orchestrateChatMock).not.toHaveBeenCalled();
    expect(chatQuotaMocks.finalizeChatRequest).not.toHaveBeenCalled();
  });

  it('never ships a successful response when persistent quota finalization fails', async () => {
    orchestrateChatMock.mockResolvedValueOnce({
      message: 'I found a food pantry.',
      services: [],
      isCrisis: false,
      retrievalStatus: 'results',
    });
    chatQuotaMocks.finalizeChatRequest
      .mockRejectedValueOnce(new Error('finalize database unavailable'))
      .mockResolvedValueOnce({
        sessionId: 'device:test',
        messageCount: 0,
        remaining: 10,
        exceeded: false,
        resetAt: undefined,
      });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'Find a food pantry',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(chatQuotaMocks.finalizeChatRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ decision: 'allowed' }),
      true,
    );
    expect(chatQuotaMocks.finalizeChatRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ decision: 'allowed' }),
      false,
    );
  });

  it('rejects messages above 2,000 characters before any usage reservation', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'x'.repeat(2001),
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(400);
    expect(chatQuotaMocks.reserveChatRequest).not.toHaveBeenCalled();
  });

  it('does not provide OpenAI summarization or enrichment dependencies', async () => {
    orchestrateChatMock.mockImplementationOnce(async (...args: unknown[]) => {
      const deps = args[5] as Record<string, unknown>;
      expect(deps).not.toHaveProperty('summarizeWithLLM');
      expect(deps).not.toHaveProperty('enrichIntent');
      return {
        message: 'Deterministic response',
        services: [],
        isCrisis: false,
        retrievalStatus: 'no_match',
      };
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({
      jsonBody: {
        message: 'Find utility help',
        sessionId: '11111111-1111-4111-8111-111111111111',
        locale: 'en',
      },
    }));

    expect(response.status).toBe(200);
  });
});
