import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteQueueMessage } from '../index';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCandidate = {
  candidateId: 'cand-1',
  fields: { organizationName: 'Test Org', serviceName: 'Test Svc' },
  review: {
    status: 'pending',
    jurisdiction: { stateProvince: 'CO', countyOrRegion: 'Denver' },
  },
};

const candidatesMock = { getById: vi.fn() };
const routingMock = { findBestMatch: vi.fn() };
const adminProfilesMock = { getByUserId: vi.fn() };
const assignmentsMock = { create: vi.fn() };
const auditMock = { append: vi.fn() };

vi.mock('@/services/db/drizzle', () => ({
  getDrizzle: vi.fn(() => ({})),
}));

vi.mock('@/agents/ingestion/persistence/storeFactory', () => ({
  createIngestionStores: vi.fn(() => ({
    candidates: candidatesMock,
    routing: routingMock,
    adminProfiles: adminProfilesMock,
    assignments: assignmentsMock,
    audit: auditMock,
  })),
}));

const findOranAdminsMock = vi.fn();
vi.mock('@/services/escalation/engine', () => ({
  findOranAdmins: findOranAdminsMock,
}));

const executeQueryMock = vi.fn();
vi.mock('@/services/db/postgres', () => ({
  executeQuery: executeQueryMock,
}));

function baseMessage(overrides: Partial<RouteQueueMessage> = {}): RouteQueueMessage {
  return {
    candidateId: 'cand-1',
    correlationId: 'corr-1',
    confidenceScore: 85,
    confidenceTier: 'green',
    verificationsPassed: 5,
    verificationsTotal: 5,
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('routeToAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    candidatesMock.getById.mockResolvedValue(mockCandidate);
    routingMock.findBestMatch.mockResolvedValue(null);
    adminProfilesMock.getByUserId.mockResolvedValue(null);
    findOranAdminsMock.mockResolvedValue([]);
    executeQueryMock.mockResolvedValue({ rows: [] });
    auditMock.append.mockResolvedValue(undefined);
    assignmentsMock.create.mockResolvedValue(undefined);
  });

  async function loadAndRun(msg: RouteQueueMessage) {
    const { routeToAdmin } = await import('../index');
    return routeToAdmin(msg);
  }

  it('returns early when candidate is not found', async () => {
    candidatesMock.getById.mockResolvedValue(null);

    await loadAndRun(baseMessage());

    expect(assignmentsMock.create).not.toHaveBeenCalled();
    expect(auditMock.append).not.toHaveBeenCalled();
  });

  it('assigns to regional admin when routing rule matches', async () => {
    routingMock.findBestMatch.mockResolvedValue({ assignedUserId: 'user-1' });
    adminProfilesMock.getByUserId.mockResolvedValue({ id: 'profile-1' });

    await loadAndRun(baseMessage());

    expect(assignmentsMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-1',
        adminProfileId: 'profile-1',
        assignmentStatus: 'pending',
      }),
    );
    expect(auditMock.append).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { assignmentsCreated: 1, routingFallback: false },
      }),
    );
  });

  it('falls back to ORAN admin when no routing rule matches', async () => {
    findOranAdminsMock.mockResolvedValue([{ user_id: 'oran-1' }]);
    adminProfilesMock.getByUserId.mockResolvedValue({ id: 'oran-profile-1' });

    await loadAndRun(baseMessage());

    expect(assignmentsMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        adminProfileId: 'oran-profile-1',
        assignmentStatus: 'pending',
      }),
    );
    // Notification sent to ORAN admin
    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('submission_assigned'),
      expect.arrayContaining(['oran-1', 'cand-1']),
    );
    expect(auditMock.append).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { assignmentsCreated: 1, routingFallback: true },
      }),
    );
  });

  it('notifies submitter during fallback when submittedByUserId is present', async () => {
    findOranAdminsMock.mockResolvedValue([{ user_id: 'oran-1' }]);
    adminProfilesMock.getByUserId.mockResolvedValue({ id: 'oran-profile-1' });

    await loadAndRun(baseMessage({ submittedByUserId: 'submitter-1' }));

    // Two notifications: one to ORAN admin, one to submitter
    expect(executeQueryMock).toHaveBeenCalledTimes(2);
    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('submission_status_changed'),
      expect.arrayContaining(['submitter-1', 'cand-1']),
    );
  });

  it('does not notify submitter when submittedByUserId is absent', async () => {
    findOranAdminsMock.mockResolvedValue([{ user_id: 'oran-1' }]);
    adminProfilesMock.getByUserId.mockResolvedValue({ id: 'oran-profile-1' });

    await loadAndRun(baseMessage());

    // Only one notification: to ORAN admin
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).not.toHaveBeenCalledWith(
      expect.stringContaining('submission_status_changed'),
      expect.anything(),
    );
  });

  it('fires system alert when no ORAN admins are available', async () => {
    findOranAdminsMock.mockResolvedValue([]);

    await loadAndRun(baseMessage());

    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('system_alert'),
      expect.arrayContaining(['cand-1']),
    );
    expect(auditMock.append).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: { assignmentsCreated: 0, routingFallback: false },
      }),
    );
  });

  it('writes audit event with routingFallback flag', async () => {
    findOranAdminsMock.mockResolvedValue([{ user_id: 'oran-1' }]);
    adminProfilesMock.getByUserId.mockResolvedValue({ id: 'oran-profile-1' });

    await loadAndRun(baseMessage());

    expect(auditMock.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'review.assigned',
        actorId: 'route-to-admin-function',
        outputs: { assignmentsCreated: 1, routingFallback: true },
      }),
    );
  });
});
