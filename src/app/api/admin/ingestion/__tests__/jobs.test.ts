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
const jobsStore = vi.hoisted(() => ({
  listByStatus: vi.fn(),
  getById: vi.fn(),
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
  } as never;
}

function createRouteContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as never;
}

async function loadJobsRoute() {
  return import('../jobs/route');
}

async function loadJobDetailRoute() {
  return import('../jobs/[id]/route');
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
    jobs: jobsStore,
  });
  jobsStore.listByStatus.mockResolvedValue([]);
  jobsStore.getById.mockResolvedValue(null);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('admin ingestion job routes', () => {
  it('requires authentication before listing jobs', async () => {
    const { GET } = await loadJobsRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required',
    });
  });

  it('lists jobs by explicit status filter', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    jobsStore.listByStatus.mockResolvedValueOnce([
      { id: 'job-1', status: 'running', queuedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const { GET } = await loadJobsRoute();

    const response = await GET(
      createRequest({ search: '?status=running&limit=25', ip: '198.51.100.8' })
    );

    expect(rateLimitMock).toHaveBeenCalledWith('198.51.100.8', expect.any(Object));
    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(jobsStore.listByStatus).toHaveBeenCalledWith('running', 25);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [{ id: 'job-1', status: 'running', queuedAt: '2026-01-01T00:00:00.000Z' }],
      filter: { status: 'running' },
    });
  });

  it('falls back to merged recent jobs when status filter is absent or invalid', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    jobsStore.listByStatus
      .mockResolvedValueOnce([
        { id: 'job-queued', status: 'queued', queuedAt: '2026-01-01T02:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        { id: 'job-running', status: 'running', queuedAt: '2026-01-01T03:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        { id: 'job-completed', status: 'completed', queuedAt: '2026-01-01T01:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        { id: 'job-failed', status: 'failed', queuedAt: '2026-01-01T04:00:00.000Z' },
      ]);
    const { GET } = await loadJobsRoute();

    const response = await GET(createRequest({ search: '?status=not-real&limit=2' }));

    expect(jobsStore.listByStatus).toHaveBeenNthCalledWith(1, 'queued', 2);
    expect(jobsStore.listByStatus).toHaveBeenNthCalledWith(2, 'running', 2);
    expect(jobsStore.listByStatus).toHaveBeenNthCalledWith(3, 'completed', 2);
    expect(jobsStore.listByStatus).toHaveBeenNthCalledWith(4, 'failed', 2);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [
        { id: 'job-failed', status: 'failed', queuedAt: '2026-01-01T04:00:00.000Z' },
        { id: 'job-running', status: 'running', queuedAt: '2026-01-01T03:00:00.000Z' },
      ],
    });
  });

  it('validates job ids on the detail route', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    const { GET } = await loadJobDetailRoute();

    const response = await GET(createRequest(), createRouteContext('bad-id'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid job ID.',
    });
  });

  it('returns job details when a record exists', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    jobsStore.getById.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      queuedAt: '2026-01-01T00:00:00.000Z',
    });
    const { GET } = await loadJobDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111')
    );

    expect(jobsStore.getById).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      job: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
        queuedAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });
});
