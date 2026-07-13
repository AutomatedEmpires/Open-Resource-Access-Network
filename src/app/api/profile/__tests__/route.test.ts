import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
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
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('api/profile route', () => {
  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Profile service is temporarily unavailable.',
    });
  });

  it('returns 429 when rate limiting blocks profile reads', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 12,
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest({ ip: '203.0.113.8' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('returns 401 when profile reads are unauthenticated', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns null when the authenticated user has no profile row', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      clerkUserId: 'user_clerk-1',
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profile: null });
  });

  it('returns a mapped profile payload for authenticated users', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      clerkUserId: 'user_clerk-1',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        preferred_locale: 'es',
        approximate_city: 'Denver',
      },
    ]);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: {
        userId: 'user-1',
        displayName: null,
        email: null,
        phone: null,
        authProvider: null,
        preferredLocale: 'es',
        approximateCity: 'Denver',
        seekerProfile: null,
      },
    });
  });

  it('returns 400 when profile updates have invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      clerkUserId: 'user_clerk-1',
    });
    const { PUT } = await loadRoute();

    const response = await PUT(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when profile updates fail validation', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      clerkUserId: 'user_clerk-1',
    });
    const { PUT } = await loadRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          approximateCity: 'x'.repeat(101),
        },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('does not persist onboarding-only context without explicit profile-storage consent', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      clerkUserId: 'user_clerk-1',
    });
    const { PUT } = await loadRoute();

    const response = await PUT(createRequest({
      jsonBody: {
        seekerProfile: {
          employmentStatus: 'employed_part_time',
          onboardingProfileConsent: false,
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('binds the authenticated Clerk identity while keeping the canonical ORAN user ID', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'oran-user-1',
      clerkUserId: 'user_clerk-1',
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        user_id: 'oran-user-1',
        auth_provider: 'clerk',
        preferred_locale: 'fr',
        approximate_city: 'Paris',
      },
    ]);
    const { PUT } = await loadRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          preferredLocale: 'fr',
          approximateCity: 'Paris',
          userId: 'attacker-selected-user',
          clerkUserId: 'user_attacker',
          authProvider: 'credentials',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: {
        userId: 'oran-user-1',
        displayName: null,
        email: null,
        phone: null,
        authProvider: 'clerk',
        preferredLocale: 'fr',
        approximateCity: 'Paris',
        seekerProfile: null,
      },
    });

    const [query, params] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('user_id, clerk_user_id, auth_provider');
    expect(query).toContain("auth_provider = 'clerk'");
    expect(params).toEqual([
      'oran-user-1',
      'user_clerk-1',
      null,
      null,
      'fr',
      'Paris',
    ]);
  });

  it('persists consented onboarding context in the actor-scoped seeker row', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      clerkUserId: 'user_clerk-1',
    });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        user_id: 'user-1',
        preferred_locale: null,
        approximate_city: 'Tacoma, WA',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        user_id: 'user-1',
        service_interests: ['housing'],
        employment_status: 'employed_part_time',
        income_range: '1500_2999_monthly',
        household_size: 3,
        veteran_service_preference: true,
        onboarding_profile_consent: true,
        onboarding_consent_version: 'onboarding-profile-v1',
        onboarding_completed_at: new Date('2026-07-13T20:00:00.000Z'),
      }]);
    const { PUT } = await loadRoute();

    const response = await PUT(createRequest({
      jsonBody: {
        approximateCity: 'Tacoma, WA',
        seekerProfile: {
          serviceInterests: ['housing'],
          employmentStatus: 'employed_part_time',
          incomeRange: '1500_2999_monthly',
          householdSize: 3,
          veteranServicePreference: true,
          onboardingProfileConsent: true,
          onboardingConsentVersion: 'onboarding-profile-v1',
          onboardingCompletedAt: '2026-07-13T20:00:00.000Z',
        },
      },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profile.seekerProfile).toEqual(expect.objectContaining({
      employmentStatus: 'employed_part_time',
      incomeRange: '1500_2999_monthly',
      householdSize: 3,
      veteranServicePreference: true,
      onboardingProfileConsent: true,
      onboardingConsentVersion: 'onboarding-profile-v1',
      onboardingCompletedAt: '2026-07-13T20:00:00.000Z',
    }));

    const seekerParams = dbMocks.executeQuery.mock.calls[1]?.[1] as unknown[];
    expect(seekerParams.slice(13, 20)).toEqual([
      'employed_part_time',
      '1500_2999_monthly',
      3,
      true,
      true,
      'onboarding-profile-v1',
      '2026-07-13T20:00:00.000Z',
    ]);
  });
});
