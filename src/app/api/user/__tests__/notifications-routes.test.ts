import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const notificationMocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  getUnread: vi.fn(),
  getUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/notifications/service', () => notificationMocks);

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

async function loadNotificationsRoute() {
  return import('../notifications/route');
}

async function loadMarkReadRoute() {
  return import('../notifications/[id]/read/route');
}

async function loadReadAllRoute() {
  return import('../notifications/read-all/route');
}

async function loadPreferencesRoute() {
  return import('../notifications/preferences/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  captureExceptionMock.mockResolvedValue(undefined);
  notificationMocks.listNotifications.mockResolvedValue({ notifications: [], total: 0 });
  notificationMocks.getUnread.mockResolvedValue([]);
  notificationMocks.getUnreadCount.mockResolvedValue(0);
  notificationMocks.markRead.mockResolvedValue(true);
  notificationMocks.markAllRead.mockResolvedValue(0);
  notificationMocks.getPreferences.mockResolvedValue([]);
  notificationMocks.setPreferences.mockResolvedValue(undefined);
});

// ============================================================
// GET /api/user/notifications
// ============================================================

describe('GET /api/user/notifications', () => {
  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadNotificationsRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadNotificationsRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 15 });
    const { GET } = await loadNotificationsRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(429);
  });

  it('lists all notifications with pagination', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    notificationMocks.listNotifications.mockResolvedValue({
      notifications: [
        { id: 'n-1', title: 'Test', event_type: 'submission_approved' },
      ],
      total: 1,
    });
    notificationMocks.getUnreadCount.mockResolvedValue(1);

    const { GET } = await loadNotificationsRoute();
    const response = await GET(createRequest({ search: '?page=1&limit=10' }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.unreadCount).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('filters unread only', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    notificationMocks.getUnread.mockResolvedValue([
      { id: 'n-1', title: 'Unread' },
    ]);
    notificationMocks.getUnreadCount.mockResolvedValue(1);

    const { GET } = await loadNotificationsRoute();
    const response = await GET(createRequest({ search: '?unread=true' }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.unreadCount).toBe(1);
  });

  it('rejects invalid page param', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    const { GET } = await loadNotificationsRoute();
    const response = await GET(createRequest({ search: '?page=0' }));
    expect(response.status).toBe(400);
  });
});

// ============================================================
// PUT /api/user/notifications/[id]/read
// ============================================================

describe('PUT /api/user/notifications/[id]/read', () => {
  it('marks notification as read', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    notificationMocks.markRead.mockResolvedValue(true);

    const { PUT } = await loadMarkReadRoute();
    const response = await PUT(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.read).toBe(true);
    expect(notificationMocks.markRead).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'user-1',
    );
  });

  it('returns 404 when notification not found', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    notificationMocks.markRead.mockResolvedValue(false);

    const { PUT } = await loadMarkReadRoute();
    const response = await PUT(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(404);
  });

  it('rejects invalid UUID', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    const { PUT } = await loadMarkReadRoute();
    const response = await PUT(
      createRequest(),
      createRouteContext('not-a-uuid'),
    );
    expect(response.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const { PUT } = await loadMarkReadRoute();
    const response = await PUT(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );
    expect(response.status).toBe(401);
  });
});

// ============================================================
// PUT /api/user/notifications/read-all
// ============================================================

describe('PUT /api/user/notifications/read-all', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { PUT } = await loadReadAllRoute();

    const response = await PUT(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('returns 429 when read-all is rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 14 });
    const { PUT } = await loadReadAllRoute();

    const response = await PUT(createRequest({ ip: '203.0.113.55, 10.0.0.2' }));

    expect(rateLimitMock).toHaveBeenCalledWith(
      'user:notifications:read-all:203.0.113.55',
      expect.any(Object),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('14');
  });

  it('marks all notifications as read', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    notificationMocks.markAllRead.mockResolvedValue(5);

    const { PUT } = await loadReadAllRoute();
    const response = await PUT(createRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.markedRead).toBe(5);
  });

  it('returns 401 when unauthenticated', async () => {
    const { PUT } = await loadReadAllRoute();
    const response = await PUT(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 500 and captures exceptions when mark-all fails', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    const serviceError = new Error('mark-all failed');
    notificationMocks.markAllRead.mockRejectedValueOnce(serviceError);
    const { PUT } = await loadReadAllRoute();

    const response = await PUT(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(serviceError, {
      feature: 'api_user_notifications_read_all',
    });
  });
});

// ============================================================
// GET /api/user/notifications/preferences
// ============================================================

describe('GET /api/user/notifications/preferences', () => {
  it('returns preferences', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    notificationMocks.getPreferences.mockResolvedValue([
      { id: 'p-1', user_id: 'user-1', event_type: 'submission_approved', channel: 'in_app', enabled: true },
    ]);

    const { GET } = await loadPreferencesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preferences).toHaveLength(1);
  });

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadPreferencesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });
});

// ============================================================
// PUT /api/user/notifications/preferences
// ============================================================

describe('PUT /api/user/notifications/preferences', () => {
  it('updates preferences', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });

    const { PUT } = await loadPreferencesRoute();
    const response = await PUT(createRequest({
      jsonBody: {
        preferences: [
          { eventType: 'submission_status_changed', channel: 'in_app', enabled: false },
        ],
      },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updated).toBe(1);
    expect(notificationMocks.setPreferences).toHaveBeenCalledWith(
      'user-1',
      [{ eventType: 'submission_status_changed', channel: 'in_app', enabled: false }],
    );
  });

  it('rejects invalid event type', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    const { PUT } = await loadPreferencesRoute();
    const response = await PUT(createRequest({
      jsonBody: {
        preferences: [
          { eventType: 'not_a_valid_event', channel: 'in_app', enabled: false },
        ],
      },
    }));
    expect(response.status).toBe(400);
  });

  it('rejects invalid channel', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    const { PUT } = await loadPreferencesRoute();
    const response = await PUT(createRequest({
      jsonBody: {
        preferences: [
          { eventType: 'submission_approved', channel: 'sms', enabled: false },
        ],
      },
    }));
    expect(response.status).toBe(400);
  });

  it('rejects empty preferences array', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    const { PUT } = await loadPreferencesRoute();
    const response = await PUT(createRequest({
      jsonBody: { preferences: [] },
    }));
    expect(response.status).toBe(400);
  });

  it('rejects invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    const { PUT } = await loadPreferencesRoute();
    const response = await PUT(createRequest({ jsonError: true }));
    expect(response.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const { PUT } = await loadPreferencesRoute();
    const response = await PUT(createRequest({
      jsonBody: {
        preferences: [
          { eventType: 'submission_approved', channel: 'in_app', enabled: true },
        ],
      },
    }));
    expect(response.status).toBe(401);
  });
});
