import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const resourceSubmissionMocks = vi.hoisted(() => ({
  getResourceSubmissionDetailForActor: vi.fn(),
  getResourceSubmissionDetailForPublic: vi.fn(),
}));
const assistMocks = vi.hoisted(() => ({
  assistResourceSubmissionFromSource: vi.fn(),
}));

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/resourceSubmissions/service', () => resourceSubmissionMocks);
vi.mock('@/services/resourceSubmissions/assist', () => {
  class MockResourceSubmissionAssistError extends Error {
    status: number;

    constructor(message: string, status = 422) {
      super(message);
      this.name = 'ResourceSubmissionAssistError';
      this.status = status;
    }
  }

  return {
    ResourceSubmissionAssistError: MockResourceSubmissionAssistError,
    assistResourceSubmissionFromSource: assistMocks.assistResourceSubmissionFromSource,
  };
});

function createRequest(options: { jsonBody?: unknown; token?: string; ip?: string } = {}) {
  const url = new URL('https://oran.test/api/resource-submissions/11111111-1111-4111-8111-111111111111/assist');
  const headers = new Headers();
  if (options.token) headers.set('x-resource-submission-token', options.token);
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  return {
    method: 'POST',
    nextUrl: url,
    headers,
    json: vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function createContext(id = '11111111-1111-4111-8111-111111111111') {
  return { params: Promise.resolve({ id }) } as never;
}

function makeDetail() {
  return {
    instance: { id: 'form-1', status: 'draft' },
    draft: {
      variant: 'listing',
      channel: 'public',
      ownerOrganizationId: null,
      existingServiceId: null,
      organization: { name: '', description: '', url: '', email: '', phone: '', taxStatus: '', taxId: '', yearIncorporated: '', legalStatus: '' },
      service: { name: '', description: '', url: '', email: '', applicationProcess: '', fees: '', waitTime: '', interpretationServices: '', accreditations: '', licenses: '', phones: [] },
      locations: [],
      taxonomy: { categories: [], customTerms: [] },
      access: { eligibilityDescription: '', minimumAge: '', maximumAge: '', serviceAreas: [], languages: [], requiredDocuments: [] },
      evidence: { sourceUrl: '', sourceName: '', contactEmail: '', submitterRelationship: '', notes: '' },
    },
    cards: [],
    reviewMeta: null,
    transitions: [],
  };
}

async function loadRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1', role: 'seeker', orgIds: [], orgRoles: new Map() });
  resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValue(makeDetail());
  resourceSubmissionMocks.getResourceSubmissionDetailForPublic.mockResolvedValue(null);
  assistMocks.assistResourceSubmissionFromSource.mockResolvedValue({
    patch: { evidence: { sourceUrl: 'https://example.org' } },
    changedFields: ['evidence.sourceUrl'],
    cardsBefore: [],
    cardsAfter: [],
    source: {
      requestedUrl: 'https://example.org',
      canonicalUrl: 'https://example.org',
      title: 'Helping Hands',
      metaDescription: null,
      wordCount: 120,
    },
    summary: {
      llmUsed: false,
      confidence: 62,
      categoriesSuggested: ['food'],
      warnings: [],
    },
  });
});

describe('resource submission assist route', () => {
  it('returns assist suggestions for an accessible submission', async () => {
    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { sourceUrl: 'https://example.org' } }), createContext());

    expect(response.status).toBe(200);
    expect(assistMocks.assistResourceSubmissionFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: 'https://example.org' }),
    );
    const body = await response.json();
    expect(body.assist.changedFields).toEqual(['evidence.sourceUrl']);
  });

  it('returns 404 when the submission is not accessible', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValue(null);
    resourceSubmissionMocks.getResourceSubmissionDetailForPublic.mockResolvedValue(null);

    const { POST } = await loadRoute();
    const response = await POST(createRequest({ jsonBody: { sourceUrl: 'https://example.org' } }), createContext());

    expect(response.status).toBe(404);
  });

  it('returns 429 with Retry-After when assist is rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });

    const { POST } = await loadRoute();
    const response = await POST(
      createRequest({ jsonBody: { sourceUrl: 'https://example.org' }, ip: '203.0.113.9' }),
      createContext(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('9');
  });
});
