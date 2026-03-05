import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientQueryMock = vi.hoisted(() => vi.fn());

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const applySlaMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/workflow/engine', () => ({
  applySla: applySlaMock,
}));

function createRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  forwardedFor?: string;
} = {}) {
  const headers = new Headers();
  if (options.forwardedFor) {
    headers.set('x-forwarded-for', options.forwardedFor);
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
  dbMocks.withTransaction.mockImplementation(
    async (fn: (client: { query: typeof clientQueryMock }) => unknown) => {
      return fn({ query: clientQueryMock });
    },
  );
  clientQueryMock.mockReset();
  clientQueryMock
    .mockResolvedValueOnce({ rows: [{ id: 'new-sub-id' }] }) // submission insert
    .mockResolvedValueOnce({ rows: [] })                      // transition insert
    .mockResolvedValueOnce({ rows: [] });                     // audit_log insert
  applySlaMock.mockResolvedValue(undefined);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
});

describe('api/reports route', () => {
  it('returns 503 when reporting is disabled by database configuration', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Reporting is temporarily unavailable.',
    });
  });

  it('rate limits by caller IP using the first forwarded address', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 17,
    });
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        forwardedFor: '203.0.113.10, 198.51.100.4',
      }),
    );

    expect(rateLimitMock).toHaveBeenCalledWith(
      'report:ip:203.0.113.10',
      expect.objectContaining({ maxRequests: 5 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
    await expect(response.json()).resolves.toEqual({
      error: 'Too many reports submitted. Please wait before reporting again.',
    });
  });

  it('returns 400 for malformed JSON payloads', async () => {
    const { POST } = await loadRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON body',
    });
  });

  it('returns 400 when request validation fails', async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          serviceId: 'not-a-uuid',
          issueType: 'not-valid',
          comment: 'x'.repeat(2001),
        },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('stores reports and returns 201', async () => {
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          serviceId: '11111111-1111-4111-8111-111111111111',
          issueType: 'wrong_hours',
        },
      }),
    );

    expect(rateLimitMock).toHaveBeenCalledWith(
      'report:ip:unknown',
      expect.objectContaining({ maxRequests: 5 }),
    );
    // Now uses withTransaction — verify it was called
    expect(dbMocks.withTransaction).toHaveBeenCalledOnce();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.message).toBe('Thank you for your report. Our team will review it.');
    expect(body.submissionId).toBe('new-sub-id');
  });

  it('returns 500 and captures telemetry when persistence fails', async () => {
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('db failed'));
    const { POST } = await loadRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          serviceId: '11111111-1111-4111-8111-111111111111',
          issueType: 'other',
          comment: 'Needs review',
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to submit report. Please try again.',
    });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
