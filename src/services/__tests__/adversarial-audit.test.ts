/**
 * Adversarial Systems Audit — Test Suite
 *
 * Tests codifying the attack surfaces identified in docs/audit/ADVERSARIAL_SYSTEMS_AUDIT.md.
 * Covers: merge authorization (LB1), granular skipGates (LB2), ownership transfer
 * workflow routing (LB3), notification idempotency (LB4), auto-publish default tier (LB5).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ============================================================
// Shared mocks (hoisted before any imports)
// ============================================================
const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const emailMocks = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(false),
}));

const clientQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/email/azureEmail', () => emailMocks);
vi.mock('@/agents/ingestion/promoteToLive', () => ({
  promoteToLive: vi.fn().mockResolvedValue({
    organizationId: 'o',
    serviceId: 's',
    locationIds: [],
    isUpdate: false,
  }),
}));

import {
  mergeOrganizations,
  mergeServices,
} from '@/services/merge/service';
import {
  advance,
  assignSubmission,
} from '@/services/workflow/engine';
import {
  evaluatePolicy,
  type AutoPublishPolicy,
} from '@/agents/ingestion/autoPublish';
import { TWO_PERSON_REQUIRED_TYPES } from '@/domain/constants';
import type { CanonicalServiceRow, SourceSystemRow } from '@/db/schema';

// ============================================================
// Helpers
// ============================================================

function resetMocks() {
  vi.clearAllMocks();
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(
    async (fn: (client: { query: typeof clientQueryMock }) => unknown) =>
      fn({ query: clientQueryMock }),
  );
  clientQueryMock.mockReset();
  emailMocks.isEmailConfigured.mockReturnValue(false);
}

function mockSubmission(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    submission_type: 'service_verification',
    status: 'submitted',
    is_locked: false,
    locked_by_user_id: null,
    assigned_to_user_id: null,
    service_id: null,
    submitted_by_user_id: 'user-a',
    target_type: 'service',
    target_id: null,
    ...overrides,
  };
}

function makeSvc(overrides: Partial<CanonicalServiceRow> = {}): CanonicalServiceRow {
  return {
    id: 'svc-1',
    canonicalOrganizationId: 'org-1',
    name: 'Test',
    alternateName: null,
    description: null,
    url: null,
    email: null,
    status: 'active',
    interpretationServices: null,
    fees: null,
    accreditations: null,
    licenses: null,
    lifecycleStatus: 'active',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'src-1',
    sourceCount: 1,
    sourceConfidenceSummary: { overall: 50 },
    publishedServiceId: null,
    firstSeenAt: new Date(),
    lastRefreshedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as CanonicalServiceRow;
}

function makeSrcSys(overrides: Partial<SourceSystemRow> = {}): SourceSystemRow {
  return {
    id: 'src-1',
    name: 'Test System',
    type: 'api',
    trustTier: 'curated',
    baseUrl: null,
    apiType: null,
    contactEmail: null,
    description: null,
    isActive: true,
    lastSyncAt: null,
    syncFrequencyHours: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as SourceSystemRow;
}

const defaultPolicy: AutoPublishPolicy = {
  eligibleTiers: ['trusted_partner', 'curated', 'verified_publisher', 'new_unknown_tier'],
  trustedPartnerMinConfidence: 90,
  curatedMinConfidence: 70,
  verifiedPublisherMinConfidence: 60,
  allowRepublish: true,
};

// ============================================================
// Section 1: Merge Authorization (LB1)
// ============================================================
describe('LB1 — merge authorization', () => {
  beforeEach(resetMocks);

  it('blocks merge when actor has no user profile', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]); // no user_profiles row
    const result = await mergeOrganizations('org-1', 'org-2', 'unknown-user');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Actor user not found');
  });

  it('blocks merge for host_admin role', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ role: 'host_admin' }]);
    const result = await mergeOrganizations('org-1', 'org-2', 'host-admin-user');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
  });

  it('blocks merge for community_admin role', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ role: 'community_admin' }]);
    const result = await mergeServices('svc-1', 'svc-2', 'comm-admin');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
  });

  it('blocks merge for seeker role', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ role: 'seeker' }]);
    const result = await mergeOrganizations('org-1', 'org-2', 'seeker-user');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
  });

  it('allows merge for oran_admin role', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ role: 'oran_admin' }]);
    // Transaction: first inner query verifies orgs exist
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        { id: 'org-1', status: 'active' },
        { id: 'org-2', status: 'active' },
      ],
    });
    // Remaining merge operations (services, members, delete members, submissions, confidence, delete confidence, archive, audit)
    for (let i = 0; i < 7; i++) {
      clientQueryMock.mockResolvedValueOnce({ rowCount: 0 });
    }

    const result = await mergeOrganizations('org-1', 'org-2', 'oran-admin-user');
    expect(result.success).toBe(true);
  });
});

// ============================================================
// Section 2: Granular skipGates (LB2)
// ============================================================
describe('LB2 — granular skipGates', () => {
  beforeEach(resetMocks);

  it('skipGates=true cannot bypass transition validity', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [mockSubmission({ status: 'draft' })] })
      // Failed transition record
      .mockResolvedValueOnce({ rows: [{ id: 'tx-fail' }] });

    const result = await advance({
      submissionId: 'sub-1',
      toStatus: 'approved', // draft → approved is invalid
      actorUserId: 'admin-1',
      actorRole: 'oran_admin',
      skipGates: true,
    });

    expect(result.success).toBe(false);
    expect(result.gateResults.some(g => g.gate === 'transition_valid' && !g.passed)).toBe(true);
  });

  it('skipGates with lockCheck=true skips lock but still checks two-person', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [mockSubmission({
          status: 'under_review',
          submission_type: 'ingestion_control_change',
          is_locked: true,
          locked_by_user_id: 'other-user',
        })],
      })
      // feature_flags check for two_person_approval
      .mockResolvedValueOnce({ rows: [{ enabled: true }] })
      // prior reviewers — actor IS a prior reviewer → should fail two-person
      .mockResolvedValueOnce({ rows: [{ actor_user_id: 'admin-1' }] })
      // Failed transition record
      .mockResolvedValueOnce({ rows: [{ id: 'tx-fail' }] });

    const result = await advance({
      submissionId: 'sub-1',
      toStatus: 'approved',
      actorUserId: 'admin-1',
      actorRole: 'community_admin',
      skipGates: { lockCheck: true },
    });

    expect(result.success).toBe(false);
    // Lock gate should NOT appear (skipped)
    expect(result.gateResults.some(g => g.gate === 'lock_check')).toBe(false);
    // Two-person should fail
    expect(result.gateResults.some(g => g.gate === 'two_person_approval' && !g.passed)).toBe(true);
  });

  it('skipGates with twoPersonApproval=true skips two-person but checks lock', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [mockSubmission({
          status: 'under_review',
          submission_type: 'ingestion_control_change',
          is_locked: true,
          locked_by_user_id: 'other-user',
        })],
      })
      // Failed transition record
      .mockResolvedValueOnce({ rows: [{ id: 'tx-fail' }] });

    const result = await advance({
      submissionId: 'sub-1',
      toStatus: 'approved',
      actorUserId: 'admin-1',
      actorRole: 'community_admin',
      skipGates: { twoPersonApproval: true },
    });

    expect(result.success).toBe(false);
    // Lock gate should appear and fail
    expect(result.gateResults.some(g => g.gate === 'lock_check' && !g.passed)).toBe(true);
    // Two-person gate should NOT appear (skipped)
    expect(result.gateResults.some(g => g.gate === 'two_person_approval')).toBe(false);
  });
});

// ============================================================
// Section 3: Auto-publish default tier fallback (LB5)
// ============================================================
describe('LB5 — autoPublish default tier handler', () => {
  it('rejects unknown tier when confidence below strictest threshold', () => {
    const svc = makeSvc({ sourceConfidenceSummary: { overall: 85 } });
    const src = makeSrcSys({ trustTier: 'new_unknown_tier' });

    const decision = evaluatePolicy(svc, src, defaultPolicy);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('new_unknown_tier');
  });

  it('approves unknown tier when confidence meets strictest threshold', () => {
    const svc = makeSvc({ sourceConfidenceSummary: { overall: 95 } });
    const src = makeSrcSys({ trustTier: 'new_unknown_tier' });

    const decision = evaluatePolicy(svc, src, defaultPolicy);
    expect(decision.eligible).toBe(true);
  });

  it('still correctly handles known tiers (curated at boundary)', () => {
    const svc = makeSvc({ sourceConfidenceSummary: { overall: 69 } });
    const src = makeSrcSys({ trustTier: 'curated' });

    const decision = evaluatePolicy(svc, src, defaultPolicy);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('curated');
  });

  it('rejects negative confidence scores via clamping', () => {
    const svc = makeSvc({ sourceConfidenceSummary: { overall: -50 } });
    const src = makeSrcSys({ trustTier: 'curated' });

    const decision = evaluatePolicy(svc, src, defaultPolicy);
    expect(decision.eligible).toBe(false);
  });
});

// ============================================================
// Section 4: Notification idempotency (LB4)
// ============================================================
describe('LB4 — notification idempotency keys', () => {
  beforeEach(resetMocks);

  it('assignSubmission uses deterministic idempotency key (no timestamp)', async () => {
    clientQueryMock
      // profile check
      .mockResolvedValueOnce({ rows: [{ pending_count: 0, max_capacity: 10 }] })
      // update submission
      .mockResolvedValueOnce({ rowCount: 1 })
      // notification insert
      .mockResolvedValueOnce({ rows: [] });

    await assignSubmission('sub-1', 'assignee-1', 'admin-1', 'community_admin');

    const notifCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('notification_events'),
    );
    expect(notifCall).toBeDefined();
    const params = notifCall![1] as unknown[];
    const idempotencyKey = params[params.length - 1] as string;

    expect(idempotencyKey).toBe('assign_sub-1_assignee-1');
    expect(idempotencyKey).not.toMatch(/\d{13}/);
  });

  it('advance uses deterministic idempotency key for status notifications', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [mockSubmission({
          id: 'sub-1',
          status: 'under_review',
          submitted_by_user_id: 'user-submitter',
          service_id: 'svc-1',
          target_id: 'svc-1',
        })],
      })
      // update submission status
      .mockResolvedValueOnce({ rowCount: 1 })
      // release lock (terminal status)
      .mockResolvedValueOnce({ rowCount: 0 })
      // insert transition record RETURNING id
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] })
      // status notification insert
      .mockResolvedValueOnce({ rows: [] });

    await advance({
      submissionId: 'sub-1',
      toStatus: 'approved',
      actorUserId: 'admin-1',
      actorRole: 'community_admin',
    });

    const notifCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('notification_events') &&
        (call[0] as string).includes('VALUES') &&
        !(call[0] as string).includes('SELECT'),
    );

    for (const call of notifCalls) {
      const params = call[1] as unknown[];
      const key = params[params.length - 1] as string;
      expect(key).not.toMatch(/\d{13}/);
    }
  });
});

// ============================================================
// Section 5: TWO_PERSON_REQUIRED_TYPES includes ownership_transfer
// ============================================================
describe('LB3 — ownership_transfer in TWO_PERSON_REQUIRED_TYPES', () => {
  it('ownership_transfer is listed in TWO_PERSON_REQUIRED_TYPES', () => {
    expect(TWO_PERSON_REQUIRED_TYPES).toContain('ownership_transfer');
  });
});
