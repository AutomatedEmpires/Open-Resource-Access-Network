import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const flagServiceMocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
}));
const triageFeedbackMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/flags/flags', () => ({
  flagService: flagServiceMocks,
}));
vi.mock('@/services/feedback/triage', () => ({
  triageFeedback: triageFeedbackMock,
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
  dbMocks.executeQuery.mockResolvedValue([{ id: 'fb-1' }]);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  captureExceptionMock.mockResolvedValue(undefined);
  flagServiceMocks.isEnabled.mockResolvedValue(false);
  triageFeedbackMock.mockResolvedValue(null);
});

describe('api/feedback route', () => {
  it('returns 405 for GET requests', async () => {
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
  });

  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Feedback is temporarily unavailable (database not configured).',
    });
  });

  it('returns 429 when rate limiting blocks feedback submission', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 20,
    });
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ ip: '203.0.113.30' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('20');
  });

  it('returns 400 when the feedback payload is invalid JSON', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when the feedback payload fails validation', async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          serviceId: 'bad-id',
          sessionId: 'bad-id',
          rating: 10,
        },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('stores feedback and returns success', async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          serviceId: '11111111-1111-4111-8111-111111111111',
          sessionId: '22222222-2222-4222-8222-222222222222',
          rating: 5,
          comment: 'Worked well',
          contactSuccess: true,
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(dbMocks.executeQuery).toHaveBeenCalledOnce();
  });

  it('persists triage data asynchronously when flag is enabled and triage returns a result', async () => {
    flagServiceMocks.isEnabled.mockResolvedValueOnce(true);
    triageFeedbackMock.mockResolvedValueOnce({
      category: 'incorrect_phone',
      urgency: 'high',
      extractedFields: ['phone'],
    });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ id: 'fb-triage' }])
      .mockResolvedValueOnce([]);
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          serviceId: '11111111-1111-4111-8111-111111111111',
          sessionId: '22222222-2222-4222-8222-222222222222',
          rating: 4,
          comment: 'Phone number is disconnected',
        },
      }),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(flagServiceMocks.isEnabled).toHaveBeenCalledOnce();
      expect(triageFeedbackMock).toHaveBeenCalledWith('Phone number is disconnected');
      expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
    });
    expect(dbMocks.executeQuery.mock.calls[1]?.[0]).toContain(
      'UPDATE seeker_feedback SET triage_category = $1, triage_result = $2 WHERE id = $3',
    );
    expect(dbMocks.executeQuery.mock.calls[1]?.[1]).toEqual([
      'incorrect_phone',
      JSON.stringify({
        category: 'incorrect_phone',
        urgency: 'high',
        extractedFields: ['phone'],
      }),
      'fb-triage',
    ]);
  });

  it('returns 500 and captures exception when insert fails', async () => {
    flagServiceMocks.isEnabled.mockResolvedValueOnce(false);
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('insert failed'));
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          serviceId: '11111111-1111-4111-8111-111111111111',
          sessionId: '22222222-2222-4222-8222-222222222222',
          rating: 3,
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_feedback',
      sessionId: '22222222-2222-4222-8222-222222222222',
    });
  });
});
