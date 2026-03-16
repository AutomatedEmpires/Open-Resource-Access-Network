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
  getResourceSubmissionDetailForActor: vi.fn(),
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
  resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValue(null);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('resource submissions collection route', () => {
  it('returns persisted review metadata when listing submissions', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'host-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    resourceSubmissionMocks.listAccessibleResourceSubmissions.mockResolvedValue([
      {
        id: 'form-1',
        status: 'approved',
      },
    ]);
    resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValue({
      instance: {
        id: 'form-1',
        submission_id: 'submission-1',
        status: 'approved',
        submission_type: 'new_service',
        title: 'Host listing',
        updated_at: '2026-03-16T00:00:00.000Z',
        submitted_at: '2026-03-16T00:00:00.000Z',
        owner_organization_id: 'org-1',
      },
      draft: {
        variant: 'listing',
        channel: 'host',
        organization: { name: 'Org Name' },
        service: { name: 'Service Name' },
        evidence: { sourceName: 'Host source' },
      },
      cards: [],
      reviewMeta: {
        submissionId: 'submission-1',
        reverifyAt: '2026-06-14T00:00:00.000Z',
      },
      transitions: [],
    });

    const { GET } = await loadCollectionRoute();
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        expect.objectContaining({
          id: 'form-1',
          submissionId: 'submission-1',
          reviewMeta: expect.objectContaining({
            reverifyAt: '2026-06-14T00:00:00.000Z',
          }),
        }),
      ],
    });
  });

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
