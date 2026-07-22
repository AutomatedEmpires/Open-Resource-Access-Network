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
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
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

function makeDetail(status: string, submissionType = 'new_service') {
  return {
    instance: {
      id: 'form-1',
      submission_id: 'submission-1',
      submission_type: submissionType,
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

  it.each([
    ['approve', 'needs_review'],
    ['deny', 'under_review'],
    ['approve', 'approved'],
  ] as const)(
    'prevents a community administrator from using %s on an organization claim in %s',
    async (action, status) => {
      guardMocks.requireMinRole.mockImplementation((_authContext, minimumRole) => (
        minimumRole === 'community_admin'
      ));
      resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValueOnce(
        makeDetail(status, 'org_claim'),
      );

      const { PUT } = await loadItemRoute();
      const response = await PUT(
        createRequest({
          method: 'PUT',
          jsonBody: { action, reviewerNotes: 'Community review cannot decide this claim.' },
        }),
        createContext(),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'ORAN administrator permissions required for organization claim decisions.',
      });
      expect(guardMocks.requireMinRole).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'reviewer-1', role: 'community_admin' }),
        'oran_admin',
      );
      expect(workflowMocks.advance).not.toHaveBeenCalled();
      expect(workflowMocks.assignSubmission).not.toHaveBeenCalled();
      expect(workflowMocks.acquireLock).not.toHaveBeenCalled();
      expect(resourceSubmissionMocks.setResourceSubmissionReviewerNotes).not.toHaveBeenCalled();
      expect(resourceSubmissionMocks.projectApprovedResourceSubmission).not.toHaveBeenCalled();
    },
  );

  it('records the first organization-claim approval without projecting', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'oran-reviewer-1',
      role: 'oran_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    resourceSubmissionMocks.getResourceSubmissionDetailForActor
      .mockResolvedValueOnce(makeDetail('needs_review', 'org_claim'))
      .mockResolvedValueOnce(makeDetail('pending_second_approval', 'org_claim'));
    workflowMocks.advance
      .mockResolvedValueOnce({
        success: true,
        fromStatus: 'needs_review',
        toStatus: 'under_review',
        transitionId: 'transition-review',
      })
      .mockResolvedValueOnce({
        success: true,
        fromStatus: 'under_review',
        toStatus: 'pending_second_approval',
        transitionId: 'transition-pending',
      });

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({
        method: 'PUT',
        jsonBody: { action: 'approve', reviewerNotes: 'Ownership evidence verified.' },
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pendingSecondApproval: true,
      projection: null,
      transition: { toStatus: 'pending_second_approval' },
    });
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(1, expect.objectContaining({
      toStatus: 'under_review',
      actorUserId: 'oran-reviewer-1',
    }));
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(2, expect.objectContaining({
      toStatus: 'pending_second_approval',
      actorUserId: 'oran-reviewer-1',
    }));
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).not.toHaveBeenCalled();
  });

  it('finalizes and projects a pending organization claim without restarting review', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'oran-approver-2',
      role: 'oran_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    resourceSubmissionMocks.getResourceSubmissionDetailForActor
      .mockResolvedValueOnce(makeDetail('pending_second_approval', 'org_claim'))
      .mockResolvedValueOnce(makeDetail('approved', 'org_claim'));
    workflowMocks.advance.mockResolvedValueOnce({
      success: true,
      fromStatus: 'pending_second_approval',
      toStatus: 'approved',
      transitionId: 'transition-approved',
    });
    resourceSubmissionMocks.projectApprovedResourceSubmission.mockResolvedValueOnce({
      organizationId: 'projected-org-1',
      serviceId: null,
    });

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({
        method: 'PUT',
        jsonBody: { action: 'approve', reviewerNotes: 'Independent final review complete.' },
      }),
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pendingSecondApproval: false,
      transition: {
        fromStatus: 'pending_second_approval',
        toStatus: 'approved',
      },
      projection: {
        organizationId: 'projected-org-1',
        serviceId: null,
      },
    });
    expect(workflowMocks.advance).toHaveBeenCalledTimes(1);
    expect(workflowMocks.advance).toHaveBeenCalledWith(expect.objectContaining({
      toStatus: 'approved',
      actorUserId: 'oran-approver-2',
    }));
    expect(resourceSubmissionMocks.projectApprovedResourceSubmission).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'oran-approver-2',
    );
  });

  it('does not restart review for an organization claim awaiting second approval', async () => {
    resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValueOnce(
      makeDetail('pending_second_approval', 'org_claim'),
    );

    const { PUT } = await loadItemRoute();
    const response = await PUT(
      createRequest({ method: 'PUT', jsonBody: { action: 'start_review' } }),
      createContext(),
    );

    expect(response.status).toBe(409);
    expect(workflowMocks.advance).not.toHaveBeenCalled();
    expect(workflowMocks.assignSubmission).not.toHaveBeenCalled();
    expect(workflowMocks.acquireLock).not.toHaveBeenCalled();
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
