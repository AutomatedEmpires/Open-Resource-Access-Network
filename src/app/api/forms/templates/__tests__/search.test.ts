import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const vaultMocks = vi.hoisted(() => ({
  listFormTemplates: vi.fn(),
  createFormTemplate: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/forms/vault', () => vaultMocks);

async function loadRoute() {
  return import('../route');
}

function createGetRequest(url = 'http://localhost/api/forms/templates?limit=10') {
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as never;
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'host-intake',
    title: 'Host intake',
    description: 'Collect host intake details.',
    category: 'operations',
    audience_scope: 'host_member',
    storage_scope: 'organization',
    default_target_role: 'community_admin',
    schema_json: {},
    ui_schema_json: {},
    instructions_markdown: null,
    version: 1,
    is_published: true,
    blob_storage_prefix: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: 'user-1',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'host_member',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.listFormTemplates.mockResolvedValue({
    templates: [makeTemplate()],
    total: 1,
  });
});

describe('GET /api/forms/templates — search parameter', () => {
  it('passes search term to vault when provided', async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      createGetRequest('http://localhost/api/forms/templates?search=intake&limit=10'),
    );

    expect(response.status).toBe(200);
    expect(vaultMocks.listFormTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'intake',
        limit: 10,
      }),
    );
  });

  it('omits search when not provided', async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      createGetRequest('http://localhost/api/forms/templates?limit=10'),
    );

    expect(response.status).toBe(200);
    expect(vaultMocks.listFormTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        search: undefined,
        limit: 10,
      }),
    );
  });

  it('combines search with category filter', async () => {
    const { GET } = await loadRoute();
    const response = await GET(
      createGetRequest('http://localhost/api/forms/templates?search=host&category=operations&limit=10'),
    );

    expect(response.status).toBe(200);
    expect(vaultMocks.listFormTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'host',
        category: 'operations',
      }),
    );
  });

  it('returns filtered results when search matches', async () => {
    vaultMocks.listFormTemplates.mockResolvedValueOnce({
      templates: [makeTemplate({ title: 'Host intake' })],
      total: 1,
    });

    const { GET } = await loadRoute();
    const response = await GET(
      createGetRequest('http://localhost/api/forms/templates?search=host'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.templates).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('returns empty results when search matches nothing', async () => {
    vaultMocks.listFormTemplates.mockResolvedValueOnce({
      templates: [],
      total: 0,
    });

    const { GET } = await loadRoute();
    const response = await GET(
      createGetRequest('http://localhost/api/forms/templates?search=nonexistent'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.templates).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
