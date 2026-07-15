import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);

function createRequest(ip = '127.0.0.1') {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    headers,
    nextUrl: new URL('https://oran.test/api/user/data-export'),
    url: 'https://oran.test/api/user/data-export',
    json: vi.fn().mockResolvedValue({}),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'seeker',
    orgIds: [],
    orgRoles: new Map(),
  });
});

describe('POST /api/user/data-export', () => {
  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns export data for authenticated user', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        archive: {
          subjectSubmissions: [{ id: 'sub-1', submission_type: 'new_service' }],
          workflowTransitions: [],
          exportMetadata: { bounded: true },
        },
      }])                                                                    // safe governance export
      .mockResolvedValueOnce([{ id: 'mem-1', role: 'host_member' }])            // memberships
      .mockResolvedValueOnce([{ id: 'notif-1', event_type: 'status_change' }])  // notifications
      .mockResolvedValueOnce([{ id: 'pref-1', event_type: 'sla_breach' }])      // preferences
      .mockResolvedValueOnce([{ id: 'audit-1', action: 'login' }]);             // audit entries

    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.userId).toBe('user-1');
    expect(body.submissions).toHaveLength(1);
    expect(body.memberships).toHaveLength(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.preferences).toHaveLength(1);
    expect(body.auditEntries).toHaveLength(1);
    expect(body.governance).not.toHaveProperty('subjectSubmissions');
    expect(body.governance.exportMetadata).toEqual({ bounded: true });
    expect(body.exportMetadata.sections).toMatchObject({
      memberships: {
        limit: 1000, returned: 1, hasMore: false, truncated: false,
      },
      notifications: {
        limit: 5000, returned: 1, hasMore: false, truncated: false,
      },
      savedCollections: {
        collections: {
          limit: 200, returned: 0, hasMore: false, truncated: false,
        },
        memberships: {
          limit: 1000, returned: 0, hasMore: false, truncated: false,
        },
      },
    });
    expect(body.savedCollections).toEqual([]);
    expect(body.exportedAt).toBeDefined();
    expect(dbMocks.executeQuery.mock.calls[0]).toEqual([
      'SELECT oran_internal.export_user_governance_data($1::text) AS archive',
      ['user-1'],
    ]);
    expect(dbMocks.executeQuery.mock.calls.every(([sql]) => (
      !/SELECT[\s\S]*\bpayload\b[\s\S]*FROM submissions/i.test(String(sql))
    ))).toBe(true);
    expect(dbMocks.executeQuery.mock.calls.some(([sql]) => (
      String(sql).includes('FROM saved_collections')
      && String(sql).includes('LIMIT 201')
    ))).toBe(true);

    // Content-Disposition header for download
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="oran-data-export-/);
  });

  it('reports when a bounded export section has more records', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ archive: { subjectSubmissions: [] } }])
      .mockResolvedValueOnce(Array.from({ length: 1001 }, (_, index) => ({
        id: `membership-${index}`,
      })));

    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.memberships).toHaveLength(1000);
    expect(body.exportMetadata.sections.memberships).toMatchObject({
      limit: 1000,
      returned: 1000,
      hasMore: true,
      truncated: true,
    });
  });

  it('enforces one global budget across all saved-collection memberships', async () => {
    const collectionId = '11111111-1111-4111-8111-111111111111';
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ archive: {} }])
      .mockResolvedValueOnce([]) // organization memberships
      .mockResolvedValueOnce([]) // notifications
      .mockResolvedValueOnce([]) // preferences
      .mockResolvedValueOnce([]) // audit
      .mockResolvedValueOnce([]) // saved services
      .mockResolvedValueOnce([{ id: collectionId, name: 'Needs' }])
      .mockResolvedValueOnce(Array.from({ length: 1001 }, (_, index) => ({
        id: `saved-${index}`,
        collection_id: collectionId,
        service_id: `service-${index}`,
        saved_at: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      })));

    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.savedCollections[0].services).toHaveLength(1000);
    expect(body.exportMetadata.sections.savedCollections.memberships).toMatchObject({
      limit: 1000,
      returned: 1000,
      hasMore: true,
      truncated: true,
    });
    expect(dbMocks.executeQuery.mock.calls.some(([sql]) => (
      String(sql).includes('FROM saved_collection_services')
      && String(sql).includes('array_position')
      && String(sql).includes('LIMIT 1001')
    ))).toBe(true);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 600 });
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(429);
  });

  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(503);
  });

  it('returns 500 when database query fails', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('connection error'));
    const { POST } = await import('../route');
    const res = await POST(createRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
