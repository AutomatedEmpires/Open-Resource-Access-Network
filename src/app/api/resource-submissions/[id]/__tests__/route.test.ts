import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const workflowMocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  advance: vi.fn(),
  advanceInTransaction: vi.fn(),
  applySla: vi.fn(),
  assignSubmission: vi.fn(),
  sendTerminalStatusEmail: vi.fn(),
}));
const resourceSubmissionMocks = vi.hoisted(() => ({
  getResourceSubmissionDetailForActor: vi.fn(),
  getResourceSubmissionDetailForPublic: vi.fn(),
  isResourceSubmissionStatusEditable: vi.fn(),
  projectApprovedResourceSubmission: vi.fn(),
  projectApprovedResourceSubmissionInTransaction: vi.fn(),
  saveResourceSubmissionDraft: vi.fn(),
  saveResourceSubmissionDraftInTransaction: vi.fn(),
  setResourceSubmissionReviewerNotes: vi.fn(),
  setResourceSubmissionReviewerNotesInTransaction: vi.fn(),
  submitResourceSubmission: vi.fn(),
}));
const communityScopeMocks = vi.hoisted(() => ({
  buildCommunitySubmissionScope: vi.fn(() => ''),
  getCommunityAdminScope: vi.fn(),
}));
const conflictClasses = vi.hoisted(() => ({
  ResourceProjectionRefreshConflict: class ResourceProjectionRefreshConflict extends Error {},
  ProtectedAuthoritativeMutationConflict: class ProtectedAuthoritativeMutationConflict extends Error {},
}));
const protectedMutationMocks = vi.hoisted(() => ({
  acquireFreshnessSensitiveAuthoritativeMutationGates: vi.fn(),
}));

vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/workflow/engine', () => workflowMocks);
vi.mock('@/services/resourceSubmissions/service', () => ({
  ...resourceSubmissionMocks,
  ResourceProjectionRefreshConflict: conflictClasses.ResourceProjectionRefreshConflict,
}));
vi.mock('@/services/community/scope', () => communityScopeMocks);
vi.mock('@/services/publication/protectedAuthoritativeMutation', () => ({
  ...protectedMutationMocks,
  ProtectedAuthoritativeMutationConflict: conflictClasses.ProtectedAuthoritativeMutationConflict,
}));

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
      assigned_to_user_id: null as string | null,
      is_locked: false,
      locked_by_user_id: null as string | null,
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
  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => (
    callback({ query: vi.fn().mockResolvedValue({ rows: [] }) })
  ));
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
  workflowMocks.advanceInTransaction.mockImplementation(
    async (_client: unknown, input: { submissionId: string; toStatus: string }) => ({
      success: true,
      submissionId: input.submissionId,
      fromStatus: 'under_review',
      toStatus: input.toStatus,
      transitionId: 'transition-1',
    }),
  );
  workflowMocks.applySla.mockResolvedValue(undefined);
  workflowMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
  resourceSubmissionMocks.projectApprovedResourceSubmission.mockResolvedValue({ organizationId: 'org-1', serviceId: 'svc-1' });
  resourceSubmissionMocks.projectApprovedResourceSubmissionInTransaction.mockResolvedValue({ organizationId: 'org-1', serviceId: 'svc-1' });
  protectedMutationMocks.acquireFreshnessSensitiveAuthoritativeMutationGates.mockResolvedValue(undefined);
  communityScopeMocks.getCommunityAdminScope.mockResolvedValue({
    profileExists: true,
    isActive: true,
    isAcceptingNew: true,
    coverageZoneIds: [],
    coverageStates: [],
    coverageCounties: [],
  });
});

describe('resource submissions item route', () => {
  it('routes host listing submissions to independent review instead of self-publishing', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'host-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    resourceSubmissionMocks.getResourceSubmissionDetailForActor
      .mockResolvedValueOnce(makeDetail('draft'))
      .mockResolvedValueOnce(makeDetail('needs_review'));

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({
        method: 'PUT',
        jsonBody: { action: 'submit', draft: makeDetail('draft').draft },
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(resourceSubmissionMocks.submitResourceSubmission).toHaveBeenCalledWith('form-1', 'host-1', 'host_admin');
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(1, expect.objectContaining({ toStatus: 'submitted' }));
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(2, expect.objectContaining({
      toStatus: 'needs_review',
      actorUserId: 'host-1',
      actorRole: 'host_admin',
    }));
    expect(workflowMocks.advance).toHaveBeenCalledTimes(2);
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).not.toHaveBeenCalled();
  });

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
    const reviewing = makeDetail('under_review');
    reviewing.instance.assigned_to_user_id = 'reviewer-1';
    reviewing.instance.is_locked = true;
    reviewing.instance.locked_by_user_id = 'reviewer-1';
    resourceSubmissionMocks.getResourceSubmissionDetailForActor
      .mockResolvedValueOnce(reviewing)
      .mockResolvedValueOnce(makeDetail('approved'));
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE OF fi, sub')) {
          return {
            rows: [{
              form_instance_id: 'form-1',
              submission_id: 'submission-1',
              status: 'under_review',
              assigned_to_user_id: 'reviewer-1',
              is_locked: true,
              locked_by_user_id: 'reviewer-1',
            }],
          };
        }
        return { rows: [] };
      }),
    };
    dbMocks.withTransaction.mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => Promise<unknown>) => callback(client),
    );

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
    expect(workflowMocks.advanceInTransaction).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ toStatus: 'approved' }),
    );
    expect(resourceSubmissionMocks.setResourceSubmissionReviewerNotesInTransaction).toHaveBeenCalledWith(
      client,
      'submission-1',
      'All required evidence verified.',
    );
    expect(resourceSubmissionMocks.projectApprovedResourceSubmissionInTransaction).toHaveBeenCalledWith(
      client,
      '11111111-1111-4111-8111-111111111111',
      'reviewer-1',
    );
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).not.toHaveBeenCalled();
    expect(protectedMutationMocks.acquireFreshnessSensitiveAuthoritativeMutationGates).toHaveBeenCalledWith(client);
    expect(
      protectedMutationMocks.acquireFreshnessSensitiveAuthoritativeMutationGates.mock.invocationCallOrder[0],
    ).toBeLessThan(client.query.mock.invocationCallOrder[0]!);
  });

  it('returns a conflict when projection targets a protected authoritative entity', async () => {
    const reviewing = makeDetail('under_review');
    reviewing.instance.assigned_to_user_id = 'reviewer-1';
    reviewing.instance.is_locked = true;
    reviewing.instance.locked_by_user_id = 'reviewer-1';
    resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValueOnce(reviewing);
    const client = {
      query: vi.fn(async (sql: string) => (
        sql.includes('FOR UPDATE OF fi, sub')
          ? {
              rows: [{
                form_instance_id: 'form-1',
                submission_id: 'submission-1',
                status: 'under_review',
                assigned_to_user_id: 'reviewer-1',
                is_locked: true,
                locked_by_user_id: 'reviewer-1',
              }],
            }
          : { rows: [] }
      )),
    };
    dbMocks.withTransaction.mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => Promise<unknown>) => callback(client),
    );
    resourceSubmissionMocks.projectApprovedResourceSubmissionInTransaction.mockRejectedValueOnce(
      new conflictClasses.ProtectedAuthoritativeMutationConflict('protected'),
    );

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({ method: 'PUT', jsonBody: { action: 'approve' } }),
      createContext(),
    );

    expect(response.status).toBe(409);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(workflowMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it('repairs an approved resource projection without replaying workflow transitions', async () => {
    resourceSubmissionMocks.getResourceSubmissionDetailForActor
      .mockResolvedValueOnce(makeDetail('approved'))
      .mockResolvedValueOnce(makeDetail('approved'));

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({
        method: 'PUT',
        jsonBody: {
          action: 'approve',
          reviewerNotes: 'Retry the failed projection.',
        },
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      transition: null,
      projectionRepair: true,
      projection: { organizationId: 'org-1', serviceId: 'svc-1' },
    }));
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'reviewer-1',
    );
    expect(workflowMocks.advance).not.toHaveBeenCalled();
    expect(workflowMocks.assignSubmission).not.toHaveBeenCalled();
    expect(workflowMocks.acquireLock).not.toHaveBeenCalled();
    expect(resourceSubmissionMocks.setResourceSubmissionReviewerNotes).not.toHaveBeenCalled();
  });

  it('does not allow approved submission content to change during projection repair', async () => {
    resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValueOnce(makeDetail('approved'));

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({
        method: 'PUT',
        jsonBody: {
          action: 'approve',
          draft: makeDetail('approved').draft,
        },
      }),
      createContext(),
    );

    expect(response.status).toBe(409);
    expect(resourceSubmissionMocks.saveResourceSubmissionDraft).not.toHaveBeenCalled();
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).not.toHaveBeenCalled();
    expect(workflowMocks.advance).not.toHaveBeenCalled();
  });
});
