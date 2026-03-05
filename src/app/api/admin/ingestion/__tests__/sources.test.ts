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
const sourceRegistryStore = vi.hoisted(() => ({
  listActive: vi.fn(),
  upsert: vi.fn(),
  getById: vi.fn(),
  deactivate: vi.fn(),
}));

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

function createRequest(options: {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
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

function createRouteContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as never;
}

async function loadSourcesRoute() {
  return import('../sources/route');
}

async function loadSourceDetailRoute() {
  return import('../sources/[id]/route');
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
  storeFactoryMocks.createIngestionStores.mockReturnValue({
    sourceRegistry: sourceRegistryStore,
  });

  sourceRegistryStore.listActive.mockResolvedValue([]);
  sourceRegistryStore.upsert.mockResolvedValue(undefined);
  sourceRegistryStore.getById.mockResolvedValue(null);
  sourceRegistryStore.deactivate.mockResolvedValue(undefined);
});

describe('admin ingestion source routes', () => {
  it('requires authentication before listing sources', async () => {
    const { GET } = await loadSourcesRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
  });

  it('returns 429 when listing sources exceeds the read rate limit', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 12,
    });
    const { GET } = await loadSourcesRoute();

    const response = await GET(createRequest({ ip: '203.0.113.12' }));

    expect(rateLimitMock).toHaveBeenCalledWith('203.0.113.12', expect.any(Object));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded.',
    });
  });

  it('lists active sources for ORAN admins', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    sourceRegistryStore.listActive.mockResolvedValueOnce([
      { id: 'source-1', displayName: 'Example Source' },
    ]);
    const { GET } = await loadSourcesRoute();

    const response = await GET(createRequest({ ip: '198.51.100.21' }));

    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(sourceRegistryStore.listActive).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sources: [{ id: 'source-1', displayName: 'Example Source' }],
    });
  });

  it('validates source creation input before persisting', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { POST } = await loadSourcesRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          displayName: '',
          trustLevel: 'allowlisted',
          domainRules: [],
        },
      })
    );

    expect(response.status).toBe(400);
    expect(sourceRegistryStore.upsert).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe('Invalid input.');
  });

  it('creates a source with generated id and default crawl settings', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('generated-source-id');
    const { POST } = await loadSourcesRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          displayName: 'Community Feed',
          trustLevel: 'allowlisted',
          domainRules: [{ type: 'suffix', value: 'example.org' }],
        },
        ip: '203.0.113.50',
      })
    );

    expect(rateLimitMock).toHaveBeenCalledWith('203.0.113.50', expect.any(Object));
    expect(sourceRegistryStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-source-id',
        displayName: 'Community Feed',
        trustLevel: 'allowlisted',
        discovery: [{ type: 'seeded_only' }],
        coverage: [],
        crawl: expect.objectContaining({
          obeyRobotsTxt: true,
          maxRequestsPerMinute: 60,
        }),
      })
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'generated-source-id',
      created: true,
    });

    randomUuidSpy.mockRestore();
  });

  it('returns source detail for an existing source id', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    sourceRegistryStore.getById.mockResolvedValueOnce({
      id: 'source-1',
      displayName: 'Example Source',
    });
    const { GET } = await loadSourceDetailRoute();

    const response = await GET(createRequest(), createRouteContext('source-1'));

    expect(sourceRegistryStore.getById).toHaveBeenCalledWith('source-1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      source: { id: 'source-1', displayName: 'Example Source' },
    });
  });

  it('returns 404 when source detail is missing', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { GET } = await loadSourceDetailRoute();

    const response = await GET(createRequest(), createRouteContext('missing-source'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Source not found.',
    });
  });

  it('validates source updates before merging', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { PUT } = await loadSourceDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          trustLevel: 'not-real',
        },
      }),
      createRouteContext('source-1')
    );

    expect(response.status).toBe(400);
    expect(sourceRegistryStore.getById).not.toHaveBeenCalled();
    expect(sourceRegistryStore.upsert).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe('Invalid input.');
  });

  it('merges updates into the existing source record', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    sourceRegistryStore.getById.mockResolvedValueOnce({
      id: 'source-1',
      displayName: 'Old Name',
      trustLevel: 'quarantine',
      domainRules: [{ type: 'suffix', value: 'old.example.org' }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const { PUT } = await loadSourceDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          displayName: 'New Name',
          trustLevel: 'allowlisted',
        },
      }),
      createRouteContext('source-1')
    );

    expect(sourceRegistryStore.getById).toHaveBeenCalledWith('source-1');
    expect(sourceRegistryStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'source-1',
        displayName: 'New Name',
        trustLevel: 'allowlisted',
        domainRules: [{ type: 'suffix', value: 'old.example.org' }],
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updated: true,
    });
  });

  it('deactivates a source through the detail route', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { DELETE } = await loadSourceDetailRoute();

    const response = await DELETE(createRequest(), createRouteContext('source-1'));

    expect(sourceRegistryStore.deactivate).toHaveBeenCalledWith('source-1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deactivated: true,
    });
  });
});
