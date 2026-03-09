import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
  requireOrgAccess: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const resourceSubmissionMocks = vi.hoisted(() => ({
  createResourceSubmission: vi.fn(),
  listAccessibleResourceSubmissions: vi.fn(),
  setResourceSubmissionPublicAccessToken: vi.fn(),
}));

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/resourceSubmissions/service', () => resourceSubmissionMocks);

function createRequest(options: {
  method?: string;
  search?: string;
  jsonBody?: unknown;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
  const headers = new Headers();
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  if (options.jsonBody !== undefined) headers.set('Content-Type', 'application/json');

  return {
    method: options.method ?? 'GET',
    nextUrl: url,
    headers,
    json: vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

async function loadCollectionRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue(null);
  guardMocks.requireMinRole.mockReturnValue(true);
  guardMocks.requireOrgAccess.mockReturnValue(true);
  resourceSubmissionMocks.listAccessibleResourceSubmissions.mockResolvedValue([]);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('resource submissions collection route', () => {
  it('creates an anonymous public draft and returns a public access token', async () => {
    resourceSubmissionMocks.createResourceSubmission.mockResolvedValue({
      instance: { id: 'form-1', submission_id: 'submission-1' },
      draft: { variant: 'listing', channel: 'public' },
      cards: [],
      reviewMeta: {},
      transitions: [],
    });

    const { POST } = await loadCollectionRoute();
    const response = await POST(createRequest({
      method: 'POST',
      ip: '203.0.113.10',
      jsonBody: {
        variant: 'listing',
        channel: 'public',
      },
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.detail.instance.id).toBe('form-1');
    expect(typeof body.publicAccessToken).toBe('string');
    expect(resourceSubmissionMocks.createResourceSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'listing',
        channel: 'public',
        actorRole: 'seeker',
        submittedByUserId: expect.stringMatching(/^anon_/),
      }),
    );
    expect(resourceSubmissionMocks.setResourceSubmissionPublicAccessToken).toHaveBeenCalledWith(
      'submission-1',
      body.publicAccessToken,
    );
  });

  it('requires host auth for host-channel submissions', async () => {
    const { POST } = await loadCollectionRoute();
    const response = await POST(createRequest({
      method: 'POST',
      jsonBody: {
        variant: 'listing',
        channel: 'host',
        ownerOrganizationId: '11111111-1111-4111-8111-111111111111',
      },
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Host authentication required.' });
    expect(resourceSubmissionMocks.createResourceSubmission).not.toHaveBeenCalled();
  });
});
