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
  listAccessibleFormInstances: vi.fn(),
}));
const formDomainMock = vi.hoisted(() => ({
  generateFormReference: vi.fn(),
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
vi.mock('@/domain/forms', () => formDomainMock);

const USER_ID = 'user-ca-1';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    submission_id: SUBMISSION_ID,
    template_id: '11111111-1111-4111-8111-111111111111',
    template_slug: 'host-intake',
    template_title: 'Host intake',
    template_description: 'Collect host intake details.',
    template_category: 'operations',
    status: 'submitted',
    priority: 1,
    storage_scope: 'organization',
    submitted_by_user_id: 'user-1',
    assigned_to_user_id: null,
    title: 'Test Form',
    submitted_at: '2026-03-08T01:00:00.000Z',
    updated_at: '2026-03-08T02:00:00.000Z',
    sla_deadline: '2026-03-10T00:00:00.000Z',
    sla_breached: false,
    recipient_role: 'community_admin',
    ...overrides,
  };
}

async function loadRoute() {
  return import('../route');
}

function createGetRequest(
  url = 'http://localhost/api/forms/instances/export?format=json',
) {
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: USER_ID,
    role: 'community_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.listAccessibleFormInstances.mockResolvedValue({
    instances: [makeInstance()],
    total: 1,
  });
  formDomainMock.generateFormReference.mockReturnValue('ORAN-F-333333');
});

describe('GET /api/forms/instances/export', () => {
  it('exports instances as JSON with content-disposition', async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      createGetRequest('http://localhost/api/forms/instances/export?format=json'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Content-Disposition')).toContain('form-instances-');
  });

  it('exports instances as CSV by default', async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      createGetRequest('http://localhost/api/forms/instances/export'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');

    const text = await res.text();
    // Should have header row
    expect(text).toContain('reference,title,template,status,priority');
    // Should have data row
    expect(text).toContain('ORAN-F-333333');
  });

  it('passes status and templateId filters to vault', async () => {
    const templateId = '11111111-1111-4111-8111-111111111111';
    const { GET } = await loadRoute();
    await GET(
      createGetRequest(
        `http://localhost/api/forms/instances/export?format=json&status=submitted&templateId=${templateId}`,
      ),
    );

    expect(vaultMocks.listAccessibleFormInstances).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      expect.objectContaining({
        status: 'submitted',
        templateId,
        limit: 500,
        offset: 0,
      }),
    );
  });

  it('caps limit at 500', async () => {
    const { GET } = await loadRoute();
    await GET(
      createGetRequest(
        'http://localhost/api/forms/instances/export?format=json&limit=9999',
      ),
    );

    expect(vaultMocks.listAccessibleFormInstances).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 500 }),
    );
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 45 });
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(429);
  });

  it('returns 500 on internal errors', async () => {
    vaultMocks.listAccessibleFormInstances.mockRejectedValueOnce(
      new Error('DB error'),
    );
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('escapes CSV values with commas and quotes', async () => {
    vaultMocks.listAccessibleFormInstances.mockResolvedValueOnce({
      instances: [
        makeInstance({ title: 'Test, with "quotes"' }),
      ],
      total: 1,
    });

    const { GET } = await loadRoute();
    const res = await GET(
      createGetRequest('http://localhost/api/forms/instances/export'),
    );

    const text = await res.text();
    // CSV-escaped value should contain double-quoted field
    expect(text).toContain('"Test, with ""quotes"""');
  });
});
