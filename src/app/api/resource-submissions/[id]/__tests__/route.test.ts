import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const workflowMocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  advance: vi.fn(),
  applySla: vi.fn(),
  assignSubmission: vi.fn(),
}));
const resourceSubmissionMocks = vi.hoisted(() => ({
  getResourceSubmissionDetailForActor: vi.fn(),
  getResourceSubmissionDetailForPublic: vi.fn(),
  isResourceSubmissionStatusEditable: vi.fn(),
  projectApprovedResourceSubmission: vi.fn(),
  saveResourceSubmissionDraft: vi.fn(),
  setResourceSubmissionReviewerNotes: vi.fn(),
  submitResourceSubmission: vi.fn(),
}));

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/workflow/engine', () => workflowMocks);
vi.mock('@/services/resourceSubmissions/service', () => resourceSubmissionMocks);

function createRequest(options: {
  method?: string;
  jsonBody?: unknown;
  ip?: string;
  token?: string;
} = {}) {
  const url = new URL('https://oran.test/api/resource-submissions/form-1');
  const headers = new Headers();
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  if (options.token) headers.set('x-resource-submission-token', options.token);

  return {
    method: options.method ?? 'GET',
    nextUrl: url,
    headers,
    json: vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function createContext(id = '11111111-1111-4111-8111-111111111111') {
  return {
    params: Promise.resolve({ id }),
  } as never;
}

function makeDetail(status: string) {
  return {
    instance: {
      id: 'form-1',
      submission_id: 'submission-1',
      submission_type: 'new_service',
      status,
      submitted_by_user_id: 'submitter-1',
      assigned_to_user_id: null,
      reviewed_at: null,
      resolved_at: null,
      submitted_at: null,
      sla_deadline: null,
      reviewer_notes: null,
      template_slug: 'resource-listing-host',
      form_data: {},
    },
    draft: {
      variant: 'listing',
      channel: 'host',
      organization: { name: 'Helping Hands', description: 'desc', url: '', email: '', phone: '', taxStatus: '', taxId: '', yearIncorporated: '', legalStatus: '' },
      service: { name: 'Food pantry', description: 'desc', url: '', email: '', applicationProcess: '', fees: '', waitTime: '', interpretationServices: '', accreditations: '', licenses: '', phones: [] },
      locations: [],
      taxonomy: { categories: ['food'], customTerms: [] },
      access: { eligibilityDescription: 'Open to all', minimumAge: '', maximumAge: '', serviceAreas: ['Travis County'], languages: [], requiredDocuments: [] },
      evidence: { sourceUrl: '', sourceName: '', contactEmail: '', submitterRelationship: 'staff', notes: 'ready' },
    },
    cards: [],
    reviewMeta: {},
    transitions: [],
  };
}

async function loadItemRoute() {
  return import('../route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'reviewer-1',
    role: 'community_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValue(makeDetail('submitted'));
  resourceSubmissionMocks.getResourceSubmissionDetailForPublic.mockResolvedValue(null);
  resourceSubmissionMocks.isResourceSubmissionStatusEditable.mockReturnValue(true);
  workflowMocks.acquireLock.mockResolvedValue(true);
  workflowMocks.assignSubmission.mockResolvedValue(true);
  workflowMocks.advance.mockResolvedValue({ success: true, transitionId: 'transition-1' });
  workflowMocks.applySla.mockResolvedValue(undefined);
  resourceSubmissionMocks.projectApprovedResourceSubmission.mockResolvedValue({ organizationId: 'org-1', serviceId: 'svc-1' });
});

describe('resource submissions item route', () => {
  it('submits a public resource draft using the shared submit path', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    resourceSubmissionMocks.getResourceSubmissionDetailForPublic
      .mockResolvedValueOnce(makeDetail('draft'))
      .mockResolvedValueOnce(makeDetail('needs_review'));

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({
        method: 'PUT',
        token: 'public-token',
        jsonBody: { action: 'submit', draft: makeDetail('draft').draft },
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(resourceSubmissionMocks.submitResourceSubmission).toHaveBeenCalledWith('form-1', 'submitter-1', 'seeker');
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(1, expect.objectContaining({ toStatus: 'submitted' }));
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(2, expect.objectContaining({ toStatus: 'needs_review' }));
  });

  it('approves a reviewed resource and projects it into live tables', async () => {
    resourceSubmissionMocks.getResourceSubmissionDetailForActor
      .mockResolvedValueOnce(makeDetail('submitted'))
      .mockResolvedValueOnce(makeDetail('approved'));

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({
        method: 'PUT',
        jsonBody: {
          action: 'approve',
          reviewerNotes: 'All required evidence verified.',
        },
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(workflowMocks.assignSubmission).toHaveBeenCalledWith('submission-1', 'reviewer-1', 'reviewer-1', 'community_admin');
    expect(workflowMocks.acquireLock).toHaveBeenCalledWith('submission-1', 'reviewer-1');
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(1, expect.objectContaining({ toStatus: 'under_review' }));
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(2, expect.objectContaining({ toStatus: 'approved' }));
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'reviewer-1');
  });
});
