/**
 * Tests for merge service (src/services/merge/service.ts)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const clientQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  mergeOrganizations,
  mergeServices,
  previewOrganizationMerge,
} from '@/services/merge/service';

beforeEach(() => {
  vi.clearAllMocks();

  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(
    async (fn: (client: { query: typeof clientQueryMock }) => unknown) => {
      return fn({ query: clientQueryMock });
    },
  );
  clientQueryMock.mockReset();
});

describe('mergeOrganizations', () => {
  it('rejects merging an org into itself', async () => {
    const result = await mergeOrganizations('org-1', 'org-1', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot merge an organization into itself');
  });

  it('returns error when one org is not found', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [{ id: 'org-1', status: 'active' }] });

    const result = await mergeOrganizations('org-1', 'org-2', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('One or both organizations not found');
  });

  it('returns error when source is already defunct', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        { id: 'org-1', status: 'active' },
        { id: 'org-2', status: 'defunct' },
      ],
    });

    const result = await mergeOrganizations('org-1', 'org-2', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Source organization is already archived');
  });

  it('successfully merges and returns counts', async () => {
    clientQueryMock
      // Verify both exist
      .mockResolvedValueOnce({
        rows: [
          { id: 'org-target', status: 'active' },
          { id: 'org-source', status: 'active' },
        ],
      })
      // services reassigned
      .mockResolvedValueOnce({ rowCount: 3 })
      // members reassigned (non-duplicates)
      .mockResolvedValueOnce({ rowCount: 2 })
      // delete remaining source members
      .mockResolvedValueOnce({ rowCount: 0 })
      // submissions reassigned
      .mockResolvedValueOnce({ rowCount: 1 })
      // confidence scores moved
      .mockResolvedValueOnce({ rowCount: 1 })
      // delete remaining confidence scores
      .mockResolvedValueOnce({ rowCount: 0 })
      // archive source
      .mockResolvedValueOnce({ rowCount: 1 })
      // audit log
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await mergeOrganizations('org-target', 'org-source', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.targetId).toBe('org-target');
    expect(result.sourceId).toBe('org-source');
    expect(result.mergedCounts.services).toBe(3);
    expect(result.mergedCounts.members).toBe(2);
    expect(result.mergedCounts.submissions).toBe(1);
  });
});

describe('mergeServices', () => {
  it('rejects merging a service into itself', async () => {
    const result = await mergeServices('svc-1', 'svc-1', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot merge a service into itself');
  });

  it('returns error when services not found', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [{ id: 'svc-1', status: 'active' }] });

    const result = await mergeServices('svc-1', 'svc-2', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('One or both services not found');
  });

  it('successfully merges services and returns counts', async () => {
    clientQueryMock
      // both found
      .mockResolvedValueOnce({
        rows: [
          { id: 'svc-target', status: 'active' },
          { id: 'svc-source', status: 'active' },
        ],
      })
      // locations
      .mockResolvedValueOnce({ rowCount: 2 })
      // phones
      .mockResolvedValueOnce({ rowCount: 1 })
      // submissions (service_id)
      .mockResolvedValueOnce({ rowCount: 2 })
      // submissions (target_id)
      .mockResolvedValueOnce({ rowCount: 0 })
      // confidence scores
      .mockResolvedValueOnce({ rowCount: 0 })
      // delete remaining
      .mockResolvedValueOnce({ rowCount: 0 })
      // deactivate source
      .mockResolvedValueOnce({ rowCount: 1 })
      // audit log
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await mergeServices('svc-target', 'svc-source', 'admin-1');
    expect(result.success).toBe(true);
    expect(result.mergedCounts.locations).toBe(2);
    expect(result.mergedCounts.phones).toBe(1);
    expect(result.mergedCounts.submissions).toBe(2);
  });
});

describe('previewOrganizationMerge', () => {
  it('returns preview data for both orgs', async () => {
    dbMocks.executeQuery
      // target org
      .mockResolvedValueOnce([{ id: 'org-1', name: 'Org A', service_count: '5' }])
      // source org
      .mockResolvedValueOnce([{ id: 'org-2', name: 'Org B', service_count: '3' }])
      // member count
      .mockResolvedValueOnce([{ count: '2' }])
      // submission count
      .mockResolvedValueOnce([{ count: '1' }]);

    const preview = await previewOrganizationMerge('org-1', 'org-2');
    expect(preview.target.name).toBe('Org A');
    expect(preview.source.name).toBe('Org B');
    expect(preview.wouldMerge.services).toBe(3);
    expect(preview.wouldMerge.members).toBe(2);
    expect(preview.wouldMerge.submissions).toBe(1);
  });

  it('throws when an org is not found', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(previewOrganizationMerge('org-1', 'org-2')).rejects.toThrow(
      'One or both organizations not found',
    );
  });
});
