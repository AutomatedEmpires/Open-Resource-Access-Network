import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const validateRuntimeEnvMock = vi.hoisted(() => vi.fn());
const getDrizzleMock = vi.hoisted(() => vi.fn());
const storeFactoryMocks = vi.hoisted(() => ({ createIngestionStores: vi.fn() }));
const createIngestionServiceMock = vi.hoisted(() => vi.fn());

const sourceSystemsStore = vi.hoisted(() => ({ listActive: vi.fn() }));
const sourceFeedsStore = vi.hoisted(() => ({ listBySystem: vi.fn() }));

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: dbConfigMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/runtime/envContract', () => ({
  validateRuntimeEnv: validateRuntimeEnvMock,
}));
vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: getDrizzleMock,
}));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => storeFactoryMocks);
vi.mock('@/agents/ingestion/service', () => ({
  createIngestionService: createIngestionServiceMock,
}));

function makeRequest(apiKey?: string) {
  const headers = new Headers();
  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
  }
  return { headers } as never;
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  vi.stubEnv('INTERNAL_API_KEY', 'secret-key');
  vi.stubEnv('SOURCE_FEED_POLLING_ENABLED', 'true');
  vi.stubEnv('NDP_211_POLLING_ENABLED', 'true');

  dbConfigMock.mockReturnValue(true);
  validateRuntimeEnvMock.mockReturnValue({ ok: true, missingCritical: [] });
  getDrizzleMock.mockReturnValue({ kind: 'db' });
  storeFactoryMocks.createIngestionStores.mockReturnValue({
    sourceSystems: sourceSystemsStore,
    sourceFeeds: sourceFeedsStore,
  });
  sourceSystemsStore.listActive.mockResolvedValue([{ id: 'sys-1', name: '211 National' }]);
  sourceFeedsStore.listBySystem.mockResolvedValue([
    { id: 'feed-1', sourceSystemId: 'sys-1', feedHandler: 'ndp_211', isActive: true },
  ]);
  createIngestionServiceMock.mockReturnValue({
    pollFeeds: vi.fn().mockResolvedValue({ feedsPolled: 1, newUrls: 20, errors: 0 }),
  });
});

describe('POST /api/internal/ingestion/feed-poll', () => {
  it('returns 503 when INTERNAL_API_KEY is not configured', async () => {
    vi.stubEnv('INTERNAL_API_KEY', '');
    const { POST } = await loadRoute();

    const response = await POST(makeRequest('secret-key'));

    expect(response.status).toBe(503);
  });

  it('returns 401 for missing authorization', async () => {
    const { POST } = await loadRoute();

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
  });

  it('skips when source feed polling is disabled', async () => {
    vi.stubEnv('SOURCE_FEED_POLLING_ENABLED', 'false');
    const { POST } = await loadRoute();

    const response = await POST(makeRequest('secret-key'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ skipped: true });
  });

  it('fails closed when active ndp_211 feeds exist but the feature flag is disabled', async () => {
    vi.stubEnv('NDP_211_POLLING_ENABLED', 'false');
    const { POST } = await loadRoute();

    const response = await POST(makeRequest('secret-key'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Active ndp_211 feeds require NDP_211_POLLING_ENABLED=true',
      missingCritical: ['NDP_211_POLLING_ENABLED'],
    });
  });

  it('polls feeds when configured and enabled', async () => {
    const { POST } = await loadRoute();

    const response = await POST(makeRequest('secret-key'));

    expect(sourceSystemsStore.listActive).toHaveBeenCalledOnce();
    expect(sourceFeedsStore.listBySystem).toHaveBeenCalledWith('sys-1');
    expect(createIngestionServiceMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      feedsPolled: 1,
      newUrls: 20,
      errors: 0,
    });
  });
});
