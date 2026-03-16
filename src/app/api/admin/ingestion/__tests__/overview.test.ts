import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const executeQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: dbConfigMock,
  executeQuery: executeQueryMock,
}));
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));

function createRequest(ip?: string) {
  const headers = new Headers();
  if (ip) {
    headers.set('x-forwarded-for', ip);
  }
  return { headers } as never;
}

async function loadRoute() {
  return import('../overview/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbConfigMock.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
});

describe('admin ingestion overview route', () => {
  it('requires authentication', async () => {
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns a cross-family operations summary for ORAN admins', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
    executeQueryMock
      .mockResolvedValueOnce([
        {
          active_systems: '2',
          active_feeds: '5',
          paused_feeds: '1',
          auto_publish_feeds: '2',
          failed_feeds: '1',
          running_feeds: '1',
          silent_feeds: '2',
          silent_auto_publish_feeds: '1',
        },
      ])
      .mockResolvedValueOnce([{ pending_source_records: '3', errored_source_records: '1' }])
      .mockResolvedValueOnce([{ queued_jobs: '4', running_jobs: '2', failed_jobs: '1', completed_jobs_24h: '7' }])
      .mockResolvedValueOnce([{ pending_candidates: '8', in_review_candidates: '5', published_candidates: '13' }])
      .mockResolvedValueOnce([{ ready_candidates: '6' }])
      .mockResolvedValueOnce([
        {
          submitted_submissions: '9',
          under_review_submissions: '4',
          pending_decision_submissions: '12',
          sla_breached_submissions: '2',
        },
      ])
      .mockResolvedValueOnce([
        {
          silent_reviewers: '2',
          stalled_reviewer_assignments: '4',
          silent_host_admins: '3',
          silent_owner_organizations: '2',
        },
      ])
      .mockResolvedValueOnce([
        {
          reclaimed_assignments_24h: '2',
          owner_outreach_alerts_24h: '1',
          integrity_held_services: '6',
          integrity_holds_24h: '3',
        },
      ])
      .mockResolvedValueOnce([
        {
          kind: 'silent_reassignment',
          title: 'Silent-reviewer reassignment marker',
          resource_type: 'submission',
          resource_id: 'sub-77',
          created_at: '2026-03-16T05:58:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          lifecycle_events_24h: '11',
          export_snapshots_24h: '15',
          approved_submissions_24h: '3',
        },
      ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest('198.51.100.7'));

    expect(rateLimitMock).toHaveBeenCalledWith('198.51.100.7', expect.any(Object));
    expect(requireMinRoleMock).toHaveBeenCalledWith({ userId: 'oran-1' }, 'oran_admin');
    expect(executeQueryMock).toHaveBeenCalledTimes(10);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      overview: {
        feeds: {
          activeSystems: 2,
          activeFeeds: 5,
          pausedFeeds: 1,
          autoPublishFeeds: 2,
          failedFeeds: 1,
          silentFeeds: 2,
          silentAutoPublishFeeds: 1,
          runningFeeds: 1,
          pendingSourceRecords: 3,
          erroredSourceRecords: 1,
        },
        jobs: {
          queued: 4,
          running: 2,
          failed: 1,
          completed24h: 7,
        },
        candidates: {
          pending: 8,
          inReview: 5,
          published: 13,
          ready: 6,
        },
        submissions: {
          submitted: 9,
          underReview: 4,
          pendingDecision: 12,
          slaBreached: 2,
          silentReviewers: 2,
          stalledReviewerAssignments: 4,
        },
        workforce: {
          silentHostAdmins: 3,
          silentOwnerOrganizations: 2,
        },
        incidents: {
          reclaimedAssignments24h: 2,
          ownerOutreachAlerts24h: 1,
          integrityHeldServices: 6,
          integrityHolds24h: 3,
          recentActions: [
            {
              kind: 'silent_reassignment',
              title: 'Silent-reviewer reassignment marker',
              resourceType: 'submission',
              resourceId: 'sub-77',
              createdAt: '2026-03-16T05:58:00Z',
            },
          ],
        },
        publication: {
          lifecycleEvents24h: 11,
          exportSnapshots24h: 15,
          approvedSubmissions24h: 3,
        },
        health: {
          degradedModeRecommended: true,
          degradedModeSeverity: 'degraded',
          degradedModeReasons: [
            '1 auto-publish feed are silent past the health window',
            '2 active feeds are silent and should be reviewed before further automation',
            '4 pending submissions are assigned to 2 silent reviewers',
            '2 owner organizations have no recently active host admin',
          ],
          freezeAutoPublish: true,
          requireReviewOnly: true,
          requireOwnerOutreach: true,
        },
      },
    });
  });
});
