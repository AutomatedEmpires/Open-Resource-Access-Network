import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));
const workflowMocks = vi.hoisted(() => ({
  advanceInTransaction: vi.fn(),
  sendTerminalStatusEmail: vi.fn(),
}));
const publicationMocks = vi.hoisted(() => ({
  acquireLivePublicationMergeLock: vi.fn(),
}));
const protectionMocks = vi.hoisted(() => ({
  acquireProtectedMaintenanceGatesShared: vi.fn(),
  assertAuthoritativeEntitiesMutable: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/workflow/engine', () => workflowMocks);
vi.mock('@/services/publication/liveEntityMerge', () => publicationMocks);
vi.mock('@/services/publication/protectedAuthoritativeMutation', () => protectionMocks);

import {
  computeIngestionControlProposalHash,
  decideIngestionControlChange,
  isHighRiskSourceSystemUpdate,
  isHighRiskSourceUpdate,
} from '../controlChanges';

const clientQuery = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  clientQuery.mockReset();
  dbMocks.withTransaction.mockImplementation(
    async (callback: (client: { query: typeof clientQuery }) => unknown) => (
      callback({ query: clientQuery })
    ),
  );
  workflowMocks.advanceInTransaction.mockImplementation(async (
    _client: unknown,
    _request: unknown,
    hooks?: { applyIngestionControlChange?: () => Promise<void> },
  ) => {
    await hooks?.applyIngestionControlChange?.();
    return {
      success: true,
      submissionId: 'control-1',
      fromStatus: 'pending_second_approval',
      toStatus: 'approved',
      transitionId: 'transition-1',
      gateResults: [],
    };
  });
  workflowMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
});

describe('ingestion control changes', () => {
  it('treats source purpose changes as high-risk authority changes', () => {
    expect(isHighRiskSourceUpdate(
      { trustLevel: 'allowlisted', resourcePurpose: 'service_catalog' },
      { resourcePurpose: 'supporting_reference' },
    )).toBe(true);

    expect(isHighRiskSourceSystemUpdate(
      { trustTier: 'curated', resourcePurpose: 'program_navigation' },
      { resourcePurpose: 'excluded' },
    )).toBe(true);
  });

  it('does not queue unchanged source authority', () => {
    expect(isHighRiskSourceUpdate(
      { trustLevel: 'allowlisted', resourcePurpose: 'service_catalog' },
      { resourcePurpose: 'service_catalog' },
    )).toBe(false);
  });

  it('claims, decides, and applies an approved authority patch in one transaction', async () => {
    const payload = {
      entityType: 'source_system' as const,
      action: 'update' as const,
      entityId: '11111111-1111-4111-8111-111111111111',
      entityLabel: 'Source',
      summary: 'Trust change',
      beforeState: {
        trustTier: 'quarantine',
        updatedAt: '2026-07-14T20:00:00.000Z',
      },
      patch: { trustTier: 'curated' },
    };
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) {
        return { rows: [{ role: 'oran_admin', account_status: 'active' }] };
      }
      if (sql.includes('FROM submissions') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            status: 'pending_second_approval',
            payload,
            proposal_sha256: computeIngestionControlProposalHash(payload),
            submitted_by_user_id: 'admin-a',
            assigned_to_user_id: null,
            is_locked: false,
            locked_by_user_id: null,
          }],
        };
      }
      if (sql.includes('UPDATE submissions') && sql.includes('RETURNING id')) {
        return { rows: [{ id: 'control-1' }] };
      }
      if (sql.includes('UPDATE public.source_systems')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await decideIngestionControlChange({
      submissionId: 'control-1',
      actorUserId: 'admin-b',
      actorRole: 'oran_admin',
      decision: 'approved',
      notes: 'Reviewed evidence',
    });

    expect(result).toEqual({ success: true });
    expect(publicationMocks.acquireLivePublicationMergeLock).toHaveBeenCalledOnce();
    expect(protectionMocks.acquireProtectedMaintenanceGatesShared).toHaveBeenCalledOnce();
    expect(protectionMocks.assertAuthoritativeEntitiesMutable).toHaveBeenCalledWith(
      expect.objectContaining({ query: clientQuery }),
      { sourceSystemIds: ['11111111-1111-4111-8111-111111111111'] },
    );
    expect(workflowMocks.advanceInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ query: clientQuery }),
      expect.objectContaining({
        submissionId: 'control-1',
        actorUserId: 'admin-b',
        toStatus: 'approved',
      }),
      expect.objectContaining({
        applyIngestionControlChange: expect.any(Function),
      }),
    );
    expect(clientQuery.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE public.source_systems')
      && String(sql).includes('resource_purpose')
    ))).toBe(true);
    expect(workflowMocks.sendTerminalStatusEmail).toHaveBeenCalledWith('control-1', 'approved');
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('does not change notes or workflow when another reviewer owns the control', async () => {
    const payload = {
      entityType: 'source_system' as const,
      action: 'deactivate' as const,
      entityId: '11111111-1111-4111-8111-111111111111',
      entityLabel: 'Source',
      summary: 'Deactivate',
      beforeState: { updatedAt: '2026-07-14T20:00:00.000Z' },
    };
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) {
        return { rows: [{ role: 'oran_admin', account_status: 'active' }] };
      }
      if (sql.includes('FROM submissions') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            status: 'pending_second_approval',
            payload,
            proposal_sha256: computeIngestionControlProposalHash(payload),
            submitted_by_user_id: 'admin-a',
            assigned_to_user_id: 'admin-c',
            is_locked: true,
            locked_by_user_id: 'admin-c',
          }],
        };
      }
      return { rows: [] };
    });

    const result = await decideIngestionControlChange({
      submissionId: 'control-1',
      actorUserId: 'admin-b',
      actorRole: 'oran_admin',
      decision: 'denied',
      notes: 'Should not persist',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Another administrator owns');
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE submissions'))).toBe(false);
    expect(workflowMocks.advanceInTransaction).not.toHaveBeenCalled();
    expect(workflowMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it('does not send completion when the approved authority projection fails', async () => {
    const payload = {
      entityType: 'source_system' as const,
      action: 'deactivate' as const,
      entityId: '11111111-1111-4111-8111-111111111111',
      entityLabel: 'Deleted source',
      summary: 'Deactivate',
      beforeState: { updatedAt: '2026-07-14T20:00:00.000Z' },
    };
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) {
        return { rows: [{ role: 'oran_admin', account_status: 'active' }] };
      }
      if (sql.includes('FROM submissions') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            status: 'pending_second_approval',
            payload,
            proposal_sha256: computeIngestionControlProposalHash(payload),
            submitted_by_user_id: 'admin-a',
            assigned_to_user_id: null,
            is_locked: false,
            locked_by_user_id: null,
          }],
        };
      }
      if (sql.includes('UPDATE submissions') && sql.includes('RETURNING id')) {
        return { rows: [{ id: 'control-1' }] };
      }
      if (sql.includes('UPDATE public.source_systems')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });

    await expect(decideIngestionControlChange({
      submissionId: 'control-1',
      actorUserId: 'admin-b',
      actorRole: 'oran_admin',
      decision: 'approved',
    })).rejects.toThrow('no longer exists');

    expect(workflowMocks.advanceInTransaction).toHaveBeenCalledOnce();
    expect(workflowMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it('rejects a changed proposal before claiming or applying it', async () => {
    const payload = {
      entityType: 'source_system' as const,
      action: 'update' as const,
      entityId: '11111111-1111-4111-8111-111111111111',
      entityLabel: 'Source',
      summary: 'Trust change',
      beforeState: { updatedAt: '2026-07-14T20:00:00.000Z' },
      patch: { trustTier: 'verified_publisher' },
    };
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) {
        return { rows: [{ role: 'oran_admin', account_status: 'active' }] };
      }
      if (sql.includes('FROM submissions') && sql.includes('FOR UPDATE')) {
        return { rows: [{
          status: 'pending_second_approval',
          payload,
          proposal_sha256: '0'.repeat(64),
          submitted_by_user_id: 'admin-a',
          assigned_to_user_id: null,
          is_locked: false,
          locked_by_user_id: null,
        }] };
      }
      return { rows: [] };
    });

    const result = await decideIngestionControlChange({
      submissionId: 'control-1',
      actorUserId: 'admin-b',
      actorRole: 'oran_admin',
      decision: 'approved',
    });

    expect(result).toEqual({
      success: false,
      error: 'The reviewed ingestion control proposal changed after submission.',
    });
    expect(workflowMocks.advanceInTransaction).not.toHaveBeenCalled();
    expect(protectionMocks.assertAuthoritativeEntitiesMutable).not.toHaveBeenCalled();
  });
});
