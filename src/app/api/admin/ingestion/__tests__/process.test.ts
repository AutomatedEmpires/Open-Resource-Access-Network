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
const runPipelineMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: dbConfigMock,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
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
  const url = new URL('https://oran.test/api/admin/ingestion/process');
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

async function loadProcessRoute() {
  return import('../process/route');
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
    runPipeline: runPipelineMock,
  });
  runPipelineMock.mockResolvedValue({
    job: { id: 'job-1' },
    pipeline: {
      correlationId: 'corr-1',
      status: 'completed',
      candidateId: 'cand-1',
      confidenceScore: 82,
      confidenceTier: 'green',
      stages: [
        { stage: 'fetch', status: 'completed', durationMs: 50, details: {} },
      ],
    },
    publication: {
      published: true,
      reason: 'published',
      serviceId: 'svc-live-1',
      organizationId: 'org-live-1',
      locationId: 'loc-live-1',
    },
  });
});

describe('admin ingestion process route', () => {
  it('requires authentication before triggering a pipeline run', async () => {
    const { POST } = await loadProcessRoute();

    const response = await POST(
      createRequest({
        jsonBody: { sourceUrl: 'https://example.org/feed' },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
  });

  it('validates process input before invoking the service layer', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadProcessRoute();

    const response = await POST(
      createRequest({
        jsonBody: { sourceUrl: 'not-a-url' },
      })
    );

    expect(response.status).toBe(400);
    expect(createIngestionServiceMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe('Invalid input.');
  });

  it('triggers the pipeline and returns the summarized execution payload', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadProcessRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          sourceUrl: 'https://example.org/feed',
          forceReprocess: true,
        },
        ip: '203.0.113.99',
      })
    );

    expect(rateLimitMock).toHaveBeenCalledWith('203.0.113.99', expect.any(Object));
    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(createIngestionServiceMock).toHaveBeenCalledWith({ stores: true });
    expect(runPipelineMock).toHaveBeenCalledWith({
      sourceUrl: 'https://example.org/feed',
      forceReprocess: true,
      triggeredBy: 'oran-1',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: 'job-1',
      correlationId: 'corr-1',
      status: 'completed',
      candidateId: 'cand-1',
      confidenceScore: 82,
      confidenceTier: 'green',
      publication: {
        published: true,
        reason: 'published',
        serviceId: 'svc-live-1',
        organizationId: 'org-live-1',
        locationId: 'loc-live-1',
      },
      stages: [
        { stage: 'fetch', status: 'completed', durationMs: 50 },
      ],
    });
  });

  it('captures unexpected service errors and returns 500', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    runPipelineMock.mockRejectedValueOnce(new Error('pipeline failed'));
    const { POST } = await loadProcessRoute();

    const response = await POST(
      createRequest({
        jsonBody: { sourceUrl: 'https://example.org/feed' },
      })
    );

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error.',
    });
  });
});
