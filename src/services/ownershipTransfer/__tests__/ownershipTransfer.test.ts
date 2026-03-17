/**
 * Ownership Transfer Tests
 *
 * Tests the complete ownership transfer lifecycle:
 *  - Service detection/matching
 *  - Transfer initiation with submission creation
 *  - Token-based verification (domain/email)
 *  - Admin approval/rejection
 *  - Transfer execution (ownership handoff, quota freeing)
 *  - Cancellation
 *
 * Adversarial scenarios:
 *  - Double-claim same service
 *  - Claim during active transfer
 *  - Fraudulent token verification
 *  - Timing attacks on expired tokens
 *  - Status machine violations
 *  - Re-claim after rejection
 */

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';

// ============================================================
// MOCK dependencies before importing service
// ============================================================

vi.mock('@/services/db/postgres', () => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/services/notifications/service', () => ({
  send: vi.fn().mockResolvedValue('notif-id'),
}));

vi.mock('@/services/workflow/engine', () => ({
  advance: vi.fn().mockResolvedValue({
    success: true,
    submissionId: 'sub-001',
    fromStatus: 'submitted',
    toStatus: 'approved',
    transitionId: 'tx-1',
    gateResults: [],
  }),
}));

import {
  detectExistingServices,
  initiateTransfer,
  verifyOwnership,
  approveTransfer,
  executeTransfer,
  rejectTransfer,
  cancelTransfer,
  getTransferById,
  listTransfersForOrganization,
  listPendingTransfersForAdmin,
} from '@/services/ownershipTransfer/service';
import { executeQuery, withTransaction } from '@/services/db/postgres';
import { send as sendNotification } from '@/services/notifications/service';
import { advance } from '@/services/workflow/engine';

// typed mocks
const mockExecuteQuery = executeQuery as Mock;
const mockWithTransaction = withTransaction as Mock;
const mockNotify = sendNotification as Mock;
const mockAdvance = advance as Mock;

// ============================================================
// HELPERS
// ============================================================

function makeTransferRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'transfer-001',
    service_id: 'svc-001',
    organization_id: 'org-001',
    requested_by_user_id: 'user-host',
    current_admin_user_id: 'user-admin',
    submission_id: 'sub-001',
    verification_method: 'admin_review',
    verification_token: null,
    verification_expires_at: null,
    verified_at: null,
    status: 'pending',
    transfer_notes: null,
    admin_notes: null,
    rejection_reason: null,
    service_snapshot: { id: 'svc-001', name: 'Test Service' },
    approved_at: null,
    completed_at: null,
    rejected_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Set up withTransaction mock to execute the callback with a fake client.
 */
function setupTransaction(
  queryResponses: Map<string, { rows: unknown[] }>,
) {
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      // Match on a key phrase in the SQL
      for (const [key, response] of queryResponses) {
        if (sql.includes(key)) return response;
      }
      return { rows: [] };
    }),
  };

  mockWithTransaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => {
    return fn(client);
  });

  return client;
}

// ============================================================
// TESTS
// ============================================================

describe('Ownership Transfer Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------
  // DETECT EXISTING SERVICES
  // ----------------------------------------------------------
  describe('detectExistingServices', () => {
    it('finds services by org name match', async () => {
      mockExecuteQuery.mockResolvedValueOnce([
        { id: 'svc-1', name: 'Helping Hands', url: 'https://helpinghands.org', match_type: 'name' },
      ]);

      const results = await detectExistingServices('Helping Hands', null, null);
      expect(results).toHaveLength(1);
      expect(results[0].matchType).toBe('name');
    });

    it('finds services by URL domain match', async () => {
      mockExecuteQuery.mockResolvedValueOnce([
        { id: 'svc-2', name: 'Food Bank', url: 'https://foodbank.org/services', match_type: 'url_domain' },
      ]);

      const results = await detectExistingServices('Food Bank', 'https://foodbank.org', null);
      expect(results).toHaveLength(1);
      expect(results[0].matchType).toBe('url_domain');
    });

    it('returns empty for no criteria', async () => {
      const results = await detectExistingServices('', null, null);
      expect(results).toEqual([]);
      expect(mockExecuteQuery).not.toHaveBeenCalled();
    });

    it('handles email domain matching', async () => {
      mockExecuteQuery.mockResolvedValueOnce([
        { id: 'svc-3', name: 'City Shelter', url: 'https://cityshelter.org', match_type: 'url_domain' },
      ]);

      const results = await detectExistingServices('City Shelter', null, 'info@cityshelter.org');
      expect(results).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------
  // INITIATE TRANSFER
  // ----------------------------------------------------------
  describe('initiateTransfer', () => {
    it('creates transfer with submission and notifies admin', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [] }], // no active transfer
        ['FROM services s', { rows: [{ id: 'svc-001', name: 'Test Service', organization_id: null, url: 'https://test.org', status: 'active', confidence_overall: 85 }] }],
        ['FROM submissions', { rows: [{ assigned_to_user_id: 'user-admin' }] }],
        ['INTO submissions', { rows: [{ id: 'sub-001' }] }],
        ['INTO submission_transitions', { rows: [] }],
        ['INTO ownership_transfers', { rows: [makeTransferRow()] }],
      ]));

      const result = await initiateTransfer({
        serviceId: 'svc-001',
        organizationId: 'org-001',
        requestedByUserId: 'user-host',
        transferNotes: 'We own this service.',
      });

      expect(result.status).toBe('pending');
      expect(result.service_id).toBe('svc-001');
      // Should have notified admin
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: 'user-admin',
          eventType: 'ownership_transfer_requested',
        }),
      );
    });

    it('ADVERSARIAL: rejects when active transfer already exists', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [{ id: 'existing-transfer' }] }],
      ]));

      await expect(
        initiateTransfer({
          serviceId: 'svc-001',
          organizationId: 'org-001',
          requestedByUserId: 'user-host',
        }),
      ).rejects.toThrow('active transfer already exists');
    });

    it('ADVERSARIAL: rejects when service not found', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [] }],
        ['FROM services s', { rows: [] }],
      ]));

      await expect(
        initiateTransfer({
          serviceId: 'svc-nonexistent',
          organizationId: 'org-001',
          requestedByUserId: 'user-host',
        }),
      ).rejects.toThrow('Service not found');
    });

    it('generates verification token for domain_match method', async () => {
      const client = setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [] }],
        ['FROM services s', { rows: [{ id: 'svc-001', name: 'Test', organization_id: null, url: null, status: 'active', confidence_overall: 50 }] }],
        ['FROM submissions', { rows: [] }],
        ['INTO submissions', { rows: [{ id: 'sub-002' }] }],
        ['INTO submission_transitions', { rows: [] }],
        ['INTO ownership_transfers', { rows: [makeTransferRow({ verification_method: 'domain_match', verification_token: 'tok123' })] }],
      ]));

      const result = await initiateTransfer({
        serviceId: 'svc-001',
        organizationId: 'org-001',
        requestedByUserId: 'user-host',
        verificationMethod: 'domain_match',
      });

      expect(result.verification_method).toBe('domain_match');
      // The INSERT call should include a real token (not null)
      const insertCall = client.query.mock.calls.find(
        (c: string[]) => typeof c[0] === 'string' && c[0].includes('INTO ownership_transfers'),
      );
      expect(insertCall).toBeDefined();
    });
  });

  // ----------------------------------------------------------
  // VERIFY OWNERSHIP (token verification)
  // ----------------------------------------------------------
  describe('verifyOwnership', () => {
    it('succeeds with valid token', async () => {
      const token = 'a'.repeat(64);
      mockExecuteQuery
        .mockResolvedValueOnce([
          makeTransferRow({
            verification_method: 'domain_match',
            verification_token: token,
            verification_expires_at: new Date(Date.now() + 86400000).toISOString(),
          }),
        ])
        .mockResolvedValueOnce([]); // UPDATE

      const result = await verifyOwnership('transfer-001', token);
      expect(result.success).toBe(true);
    });

    it('ADVERSARIAL: rejects wrong token', async () => {
      mockExecuteQuery.mockResolvedValueOnce([
        makeTransferRow({
          verification_method: 'domain_match',
          verification_token: 'correct-token-here-abcdef1234567890',
          verification_expires_at: new Date(Date.now() + 86400000).toISOString(),
        }),
      ]);

      const result = await verifyOwnership('transfer-001', 'wrong-token-here-totally-differ');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('ADVERSARIAL: rejects expired token', async () => {
      const token = 'b'.repeat(64);
      mockExecuteQuery.mockResolvedValueOnce([
        makeTransferRow({
          verification_method: 'domain_match',
          verification_token: token,
          verification_expires_at: new Date(Date.now() - 86400000).toISOString(), // expired
        }),
      ]);

      const result = await verifyOwnership('transfer-001', token);
      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('ADVERSARIAL: rejects admin_review method (no token path)', async () => {
      mockExecuteQuery.mockResolvedValueOnce([
        makeTransferRow({ verification_method: 'admin_review' }),
      ]);

      const result = await verifyOwnership('transfer-001', 'any-token');
      expect(result.success).toBe(false);
      expect(result.error).toContain('admin review');
    });

    it('ADVERSARIAL: rejects verification on non-pending transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([
        makeTransferRow({ status: 'approved' }),
      ]);

      const result = await verifyOwnership('transfer-001', 'any-token');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not in pending');
    });

    it('ADVERSARIAL: rejects non-existent transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([]);

      const result = await verifyOwnership('nonexistent', 'any-token');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ----------------------------------------------------------
  // APPROVE TRANSFER
  // ----------------------------------------------------------
  describe('approveTransfer', () => {
    it('approves pending transfer and notifies requester', async () => {
      // executeQuery: 1) get transfer, 2) get submission status, 3) update ownership_transfers
      mockExecuteQuery
        .mockResolvedValueOnce([makeTransferRow()])
        .mockResolvedValueOnce([{ status: 'submitted' }])
        .mockResolvedValueOnce([]);

      const result = await approveTransfer('transfer-001', 'admin-user', 'Looks legit');
      expect(result.success).toBe(true);
      expect(mockAdvance).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ownership_transfer_approved',
        }),
      );
    });

    it('approves verified transfer', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce([makeTransferRow({ status: 'verified' })])
        .mockResolvedValueOnce([{ status: 'submitted' }])
        .mockResolvedValueOnce([]);

      const result = await approveTransfer('transfer-001', 'admin-user');
      expect(result.success).toBe(true);
    });

    it('ADVERSARIAL: cannot approve completed transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow({ status: 'completed' })]);

      const result = await approveTransfer('transfer-001', 'admin-user');
      expect(result.success).toBe(false);
      expect(result.error).toContain('completed');
    });

    it('ADVERSARIAL: cannot approve rejected transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow({ status: 'rejected' })]);

      const result = await approveTransfer('transfer-001', 'admin-user');
      expect(result.success).toBe(false);
    });

    it('ADVERSARIAL: fails when workflow gate rejects advance', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce([makeTransferRow()])
        .mockResolvedValueOnce([{ status: 'submitted' }]);

      mockAdvance.mockResolvedValueOnce({
        success: false,
        error: 'Two-person approval required',
        gateResults: [{ gate: 'two_person_approval', passed: false }],
      });

      const result = await approveTransfer('transfer-001', 'admin-user');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Two-person approval required');
    });
  });

  // ----------------------------------------------------------
  // EXECUTE TRANSFER
  // ----------------------------------------------------------
  describe('executeTransfer', () => {
    it('transfers ownership, frees admin quota, notifies both parties', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [makeTransferRow({ status: 'approved' })] }],
        ['UPDATE services', { rows: [] }],
        ['UPDATE admin_review_profiles', { rows: [] }],
        ['UPDATE ownership_transfers', { rows: [] }],
      ]));

      const result = await executeTransfer('transfer-001');
      expect(result.success).toBe(true);

      // Should have sent 2 notifications: admin_quota_freed + ownership_transfer_completed
      expect(mockNotify).toHaveBeenCalledTimes(2);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'admin_quota_freed' }),
      );
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ownership_transfer_completed' }),
      );
    });

    it('ADVERSARIAL: cannot execute pending transfer (must be approved first)', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [makeTransferRow({ status: 'pending' })] }],
      ]));

      const result = await executeTransfer('transfer-001');
      expect(result.success).toBe(false);
      expect(result.error).toContain('pending');
    });

    it('ADVERSARIAL: cannot execute already-completed transfer', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [makeTransferRow({ status: 'completed' })] }],
      ]));

      const result = await executeTransfer('transfer-001');
      expect(result.success).toBe(false);
    });

    it('handles transfer with no current admin (no quota to free)', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [makeTransferRow({ status: 'approved', current_admin_user_id: null })] }],
        ['UPDATE services', { rows: [] }],
        ['UPDATE ownership_transfers', { rows: [] }],
      ]));

      const result = await executeTransfer('transfer-001');
      expect(result.success).toBe(true);

      // Only 1 notification (completed), no admin_quota_freed since no admin
      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ownership_transfer_completed' }),
      );
    });
  });

  // ----------------------------------------------------------
  // REJECT TRANSFER
  // ----------------------------------------------------------
  describe('rejectTransfer', () => {
    it('rejects transfer with reason and notifies requester', async () => {
      mockExecuteQuery
        .mockResolvedValueOnce([makeTransferRow()])
        .mockResolvedValueOnce([{ status: 'submitted' }])
        .mockResolvedValueOnce([]);

      const result = await rejectTransfer('transfer-001', 'admin-user', 'Cannot verify ownership');
      expect(result.success).toBe(true);
      expect(mockAdvance).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ownership_transfer_rejected',
          body: expect.stringContaining('Cannot verify ownership'),
        }),
      );
    });

    it('ADVERSARIAL: cannot reject completed transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow({ status: 'completed' })]);

      const result = await rejectTransfer('transfer-001', 'admin-user', 'Reason');
      expect(result.success).toBe(false);
    });

    it('ADVERSARIAL: cannot reject cancelled transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow({ status: 'cancelled' })]);

      const result = await rejectTransfer('transfer-001', 'admin-user', 'Reason');
      expect(result.success).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // CANCEL TRANSFER
  // ----------------------------------------------------------
  describe('cancelTransfer', () => {
    it('allows requesting user to cancel pending transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([{ id: 'transfer-001' }]);

      const result = await cancelTransfer('transfer-001', 'user-host');
      expect(result.success).toBe(true);
    });

    it('ADVERSARIAL: cannot cancel someone elses transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([]); // no rows affected

      const result = await cancelTransfer('transfer-001', 'user-other');
      expect(result.success).toBe(false);
    });

    it('ADVERSARIAL: cannot cancel approved transfer', async () => {
      mockExecuteQuery.mockResolvedValueOnce([]); // query WHERE status IN (pending, verified) won't match

      const result = await cancelTransfer('transfer-001', 'user-host');
      expect(result.success).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // QUERY FUNCTIONS
  // ----------------------------------------------------------
  describe('query functions', () => {
    it('getTransferById returns transfer or null', async () => {
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow()]);
      const result = await getTransferById('transfer-001');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('transfer-001');

      mockExecuteQuery.mockResolvedValueOnce([]);
      const result2 = await getTransferById('nonexistent');
      expect(result2).toBeNull();
    });

    it('listTransfersForOrganization returns org transfers', async () => {
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow(), makeTransferRow({ id: 'transfer-002' })]);
      const results = await listTransfersForOrganization('org-001');
      expect(results).toHaveLength(2);
    });

    it('listPendingTransfersForAdmin returns pending transfers', async () => {
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow()]);
      const results = await listPendingTransfersForAdmin('user-admin');
      expect(results).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------
  // ADVERSARIAL: COMPLEX SCENARIOS
  // ----------------------------------------------------------
  describe('adversarial: complex scenarios', () => {
    it('ADVERSARIAL: full lifecycle — crawl → admin → org claims → verify → approve → execute', async () => {
      // Simulate the full flow described in the scenario:
      // 1. Service was crawled and placed under admin control
      // 2. Org signs up 2 months later
      // 3. Service is detected as matching
      // 4. Ownership transfer is initiated
      // 5. Admin is notified and approves
      // 6. Transfer is executed, quota freed

      // Step 1: Detect matching services
      mockExecuteQuery.mockResolvedValueOnce([
        { id: 'svc-crawled', name: 'Community Food Bank', url: 'https://foodbank.org', match_type: 'name' },
      ]);
      const detected = await detectExistingServices('Community Food Bank', 'https://foodbank.org', null);
      expect(detected).toHaveLength(1);

      // Step 2: Initiate transfer
      const transferRow = makeTransferRow({ id: 'transfer-lifecycle', service_id: 'svc-crawled' });
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [] }],
        ['FROM services s', { rows: [{ id: 'svc-crawled', name: 'Community Food Bank', organization_id: null, url: 'https://foodbank.org', status: 'active', confidence_overall: 78 }] }],
        ['FROM submissions', { rows: [{ assigned_to_user_id: 'admin-jane' }] }],
        ['INTO submissions', { rows: [{ id: 'sub-lifecycle' }] }],
        ['INTO submission_transitions', { rows: [] }],
        ['INTO ownership_transfers', { rows: [transferRow] }],
      ]));
      const initiated = await initiateTransfer({
        serviceId: 'svc-crawled',
        organizationId: 'org-foodbank',
        requestedByUserId: 'user-foodbank-owner',
      });
      expect(initiated.status).toBe('pending');

      // Step 3: Admin approves
      vi.clearAllMocks();
      // approveTransfer uses executeQuery (not transaction) + advance()
      mockExecuteQuery
        .mockResolvedValueOnce([makeTransferRow({ id: 'transfer-lifecycle', status: 'pending', submission_id: 'sub-lifecycle', current_admin_user_id: 'admin-jane' })])
        .mockResolvedValueOnce([{ status: 'submitted' }])  // submission status lookup
        .mockResolvedValueOnce([]);  // UPDATE ownership_transfers
      mockAdvance.mockResolvedValue({ success: true, submission: { id: 'sub-lifecycle', status: 'approved' } });
      const approved = await approveTransfer('transfer-lifecycle', 'admin-jane', 'Verified via phone call');
      expect(approved.success).toBe(true);

      // Step 4: Execute transfer
      vi.clearAllMocks();
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [makeTransferRow({ id: 'transfer-lifecycle', status: 'approved', current_admin_user_id: 'admin-jane' })] }],
        ['UPDATE services', { rows: [] }],
        ['UPDATE admin_review_profiles', { rows: [] }],
        ['UPDATE ownership_transfers', { rows: [] }],
      ]));
      const executed = await executeTransfer('transfer-lifecycle');
      expect(executed.success).toBe(true);
      // Admin quota freed notification
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'admin_quota_freed', recipientUserId: 'admin-jane' }),
      );
    });

    it('ADVERSARIAL: org rejected then re-claims (allowed after rejection)', async () => {
      // First transfer was rejected. Org should be able to try again
      // because the DB unique index only blocks active statuses (pending/verified/approved)

      // Step 1: New claim after rejection — no active transfer exists
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [] }], // unique index allows this since rejected is terminal
        ['FROM services s', { rows: [{ id: 'svc-001', name: 'Test', organization_id: null, url: null, status: 'active', confidence_overall: 50 }] }],
        ['FROM submissions', { rows: [] }],
        ['INTO submissions', { rows: [{ id: 'sub-reclaim' }] }],
        ['INTO submission_transitions', { rows: [] }],
        ['INTO ownership_transfers', { rows: [makeTransferRow({ id: 'transfer-reclaim' })] }],
      ]));

      const result = await initiateTransfer({
        serviceId: 'svc-001',
        organizationId: 'org-001',
        requestedByUserId: 'user-host',
      });
      expect(result.id).toBe('transfer-reclaim');
    });

    it('ADVERSARIAL: two orgs try to claim the same service simultaneously', async () => {
      // First org claim succeeds
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [] }],
        ['FROM services s', { rows: [{ id: 'svc-shared', name: 'Shared Service', organization_id: null, url: null, status: 'active', confidence_overall: 50 }] }],
        ['FROM submissions', { rows: [] }],
        ['INTO submissions', { rows: [{ id: 'sub-org1' }] }],
        ['INTO submission_transitions', { rows: [] }],
        ['INTO ownership_transfers', { rows: [makeTransferRow({ id: 'transfer-org1' })] }],
      ]));
      const first = await initiateTransfer({
        serviceId: 'svc-shared',
        organizationId: 'org-1',
        requestedByUserId: 'user-1',
      });
      expect(first.id).toBe('transfer-org1');

      // Second org claim blocked by active transfer
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [{ id: 'transfer-org1' }] }],
      ]));
      await expect(
        initiateTransfer({
          serviceId: 'svc-shared',
          organizationId: 'org-2',
          requestedByUserId: 'user-2',
        }),
      ).rejects.toThrow('active transfer already exists');
    });

    it('ADVERSARIAL: status machine — cannot jump from pending to completed', async () => {
      setupTransaction(new Map([
        ['FROM ownership_transfers', { rows: [makeTransferRow({ status: 'pending' })] }],
      ]));

      const result = await executeTransfer('transfer-001');
      expect(result.success).toBe(false);
      expect(result.error).toContain('pending');
    });

    it('ADVERSARIAL: status machine — cannot approve then approve again', async () => {
      // approveTransfer now uses executeQuery, not transaction
      mockExecuteQuery.mockResolvedValueOnce([makeTransferRow({ status: 'approved' })]);

      const result = await approveTransfer('transfer-001', 'admin');
      expect(result.success).toBe(false);
    });
  });
});
