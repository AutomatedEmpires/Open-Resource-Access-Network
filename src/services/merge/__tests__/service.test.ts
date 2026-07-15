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

  // Default: assertMergeAuthorized succeeds (oran_admin)
  dbMocks.executeQuery.mockResolvedValue([{ role: 'oran_admin' }]);
  dbMocks.withTransaction.mockImplementation(
    async (fn: (client: { query: typeof clientQueryMock }) => unknown) => {
      return fn({ query: clientQueryMock });
    },
  );
  clientQueryMock.mockReset();
  clientQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

const authorizedActorRows = {
  rows: [{ role: 'oran_admin', account_status: 'active' }],
  rowCount: 1,
};

describe('mergeOrganizations', () => {
  it('rejects merging an org into itself', async () => {
    const result = await mergeOrganizations('org-1', 'org-1', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot merge an organization into itself');
  });

  it('returns error when one org is not found', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // publication/merge gate
      .mockResolvedValueOnce({ rows: [] }) // hotline maintenance gate
      .mockResolvedValueOnce({ rows: [] }) // quarantine maintenance gate
      .mockResolvedValueOnce(authorizedActorRows) // actor auth row lock
      .mockResolvedValueOnce({ rows: [{ id: 'org-1', status: 'active' }] });

    const result = await mergeOrganizations('org-1', 'org-2', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('One or both organizations not found');
  });

  it('returns error when source is already defunct', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // publication/merge gate
      .mockResolvedValueOnce({ rows: [] }) // hotline maintenance gate
      .mockResolvedValueOnce({ rows: [] }) // quarantine maintenance gate
      .mockResolvedValueOnce(authorizedActorRows) // actor auth row lock
      .mockResolvedValueOnce({
        rows: [
          { id: 'org-1', status: 'active' },
          { id: 'org-2', status: 'defunct' },
        ],
      });

    const result = await mergeOrganizations('org-1', 'org-2', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Source organization is already archived');
  });

  it('locks and rechecks the active actor inside the gated merge transaction', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // publication/merge gate
      .mockResolvedValueOnce({ rows: [] }) // hotline maintenance gate
      .mockResolvedValueOnce({ rows: [] }) // quarantine maintenance gate
      .mockResolvedValueOnce({
        rows: [{ role: 'oran_admin', account_status: 'frozen' }],
        rowCount: 1,
      });

    const result = await mergeOrganizations('org-target', 'org-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized: merge actor account is not active');
    expect(String(clientQueryMock.mock.calls[0]?.[0])).toContain('oran:live-publication-merge');
    expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain('verified-national-hotlines');
    expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain('usda-fns-snap-retailer');
    expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain('FROM user_profiles');
    expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain('account_status');
    expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain('FOR SHARE');
    expect(clientQueryMock.mock.calls.some(([sql]) => String(sql).includes('FROM organizations'))).toBe(false);
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects an inactive target organization under the merge row locks', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // publication/merge gate
      .mockResolvedValueOnce({ rows: [] }) // hotline maintenance gate
      .mockResolvedValueOnce({ rows: [] }) // quarantine maintenance gate
      .mockResolvedValueOnce(authorizedActorRows) // actor auth row lock
      .mockResolvedValueOnce({
        rows: [
          { id: 'org-target', status: 'inactive' },
          { id: 'org-source', status: 'active' },
        ],
      });

    const result = await mergeOrganizations('org-target', 'org-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Target organization must be active');
    expect(clientQueryMock).toHaveBeenCalledTimes(5);
  });

  it('successfully merges and returns counts', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) return authorizedActorRows;
      if (sql.includes('FROM organizations') && sql.includes('id = ANY')) {
        return {
        rows: [
          { id: 'org-target', status: 'active' },
          { id: 'org-source', status: 'active' },
        ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_constraint')) return { rows: [] };
      if (sql.includes('UPDATE public."services"')) return { rows: [], rowCount: 3 };
      if (sql.includes('UPDATE organization_members')) return { rows: [], rowCount: 2 };
      if (sql.includes('UPDATE submissions') && sql.includes("target_type = 'organization'")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await mergeOrganizations('org-target', 'org-source', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.targetId).toBe('org-target');
    expect(result.sourceId).toBe('org-source');
    expect(result.mergedCounts.services).toBe(3);
    expect(result.mergedCounts.members).toBe(2);
    expect(result.mergedCounts.submissions).toBe(1);

    const calls = clientQueryMock.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => (
      sql.includes('FROM organizations')
      && sql.includes('ORDER BY id')
      && sql.includes('FOR UPDATE')
    ))).toBe(true);
    expect(calls.some((sql) => (
      sql.includes('UPDATE public."services"')
      && sql.includes('SET "organization_id" = $1')
    ))).toBe(true);
  });

  it('rejects a verified-hotline organization as the merge target', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) return authorizedActorRows;
      if (sql.includes('FROM organizations') && sql.includes('id = ANY')) {
        return {
          rows: [
            { id: 'org-target', status: 'active' },
            { id: 'org-source', status: 'active' },
          ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_constraint')) return { rows: [] };
      if (sql.includes(') protected_target')) {
        return { rows: [{ blocker: 'active verified-hotline authority' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await mergeOrganizations('org-target', 'org-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Target organization merge blocked by active verified-hotline authority');
    expect(result.error).toContain('deactivate or roll back');
    expect(clientQueryMock.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE public.') || String(sql).includes("SET status = 'defunct'")
    ))).toBe(false);
  });
});

describe('mergeServices', () => {
  it('rejects merging a service into itself', async () => {
    const result = await mergeServices('svc-1', 'svc-1', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot merge a service into itself');
  });

  it('returns error when services not found', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // publication/merge gate
      .mockResolvedValueOnce({ rows: [] }) // freshness advisory lock
      .mockResolvedValueOnce({ rows: [] }) // hotline maintenance gate
      .mockResolvedValueOnce({ rows: [] }) // quarantine maintenance gate
      .mockResolvedValueOnce(authorizedActorRows) // actor auth row lock
      .mockResolvedValueOnce({ rows: [{ id: 'svc-1', status: 'active' }] });

    const result = await mergeServices('svc-1', 'svc-2', 'admin-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('One or both services not found');
    expect(String(clientQueryMock.mock.calls[0]?.[0])).toContain('oran:live-publication-merge');
    expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain('oran:resource-freshness-scan');
    expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain('verified-national-hotlines');
    expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain('usda-fns-snap-retailer');
    expect(String(clientQueryMock.mock.calls[4]?.[0])).toContain('FROM user_profiles');
    expect(String(clientQueryMock.mock.calls[5]?.[0])).toContain('FROM services');
  });

  it('rejects an inactive target service under the merge row locks', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // publication/merge gate
      .mockResolvedValueOnce({ rows: [] }) // freshness advisory lock
      .mockResolvedValueOnce({ rows: [] }) // hotline maintenance gate
      .mockResolvedValueOnce({ rows: [] }) // quarantine maintenance gate
      .mockResolvedValueOnce(authorizedActorRows) // actor auth row lock
      .mockResolvedValueOnce({
        rows: [
          { id: 'svc-target', status: 'inactive' },
          { id: 'svc-source', status: 'active' },
        ],
      });

    const result = await mergeServices('svc-target', 'svc-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Target service must be active');
    expect(clientQueryMock).toHaveBeenCalledTimes(6);
  });

  it('rejects a defunct source service under the merge row locks', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // publication/merge gate
      .mockResolvedValueOnce({ rows: [] }) // freshness advisory lock
      .mockResolvedValueOnce({ rows: [] }) // hotline maintenance gate
      .mockResolvedValueOnce({ rows: [] }) // quarantine maintenance gate
      .mockResolvedValueOnce(authorizedActorRows) // actor auth row lock
      .mockResolvedValueOnce({
        rows: [
          { id: 'svc-target', status: 'active' },
          { id: 'svc-source', status: 'defunct' },
        ],
      });

    const result = await mergeServices('svc-target', 'svc-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Source service is defunct and cannot be merged');
    expect(clientQueryMock).toHaveBeenCalledTimes(6);
  });

  it('successfully merges services and returns counts', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) return authorizedActorRows;
      if (sql.includes('FROM services') && sql.includes('id = ANY')) {
        return {
          rows: [
            { id: 'svc-target', status: 'active' },
            { id: 'svc-source', status: 'active' },
          ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_constraint')) return { rows: [] };
      if (
        sql.includes('SELECT id, submission_id, hold_reason')
        && sql.includes('FROM oran_internal.resource_freshness_findings')
      ) return { rows: [] };
      if (sql.includes('UPDATE public."service_at_location"')) {
        return { rows: [], rowCount: 2 };
      }
      if (sql.includes('UPDATE public."phones"')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM public.ownership_transfers source_transfer')) return { rows: [] };
      if (sql.includes('UPDATE submissions sub SET service_id')) {
        return { rows: [], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await mergeServices('svc-target', 'svc-source', 'admin-1');
    expect(result.success).toBe(true);
    expect(result.mergedCounts.locations).toBe(2);
    expect(result.mergedCounts.phones).toBe(1);
    expect(result.mergedCounts.submissions).toBe(2);

    const calls = clientQueryMock.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => sql.includes('UPDATE public."service_taxonomy"'))).toBe(true);
    expect(calls.some((sql) => sql.includes('UPDATE public."canonical_services"'))).toBe(true);
    expect(calls.some((sql) => sql.includes('UPDATE public."verified_service_links"'))).toBe(true);
    expect(calls.some((sql) => sql.includes('service_locations'))).toBe(false);
    expect(calls.some((sql) => sql.includes('service_phones'))).toBe(false);
  });

  it('fails closed when the live schema gains an unsupported service child', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) return authorizedActorRows;
      if (sql.includes('FROM services') && sql.includes('id = ANY')) {
        return {
          rows: [
            { id: 'svc-target', status: 'active' },
            { id: 'svc-source', status: 'active' },
          ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_constraint')) {
        return {
          rows: [{
            schema_name: 'public',
            table_name: 'future_live_children',
            column_name: 'service_id',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await mergeServices('svc-target', 'svc-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('unsupported child references');
    expect(clientQueryMock.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'defunct'")
    ))).toBe(false);
  });

  it('rejects an active-quarantine service as the merge target', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) return authorizedActorRows;
      if (sql.includes('FROM services') && sql.includes('id = ANY')) {
        return {
          rows: [
            { id: 'svc-target', status: 'active' },
            { id: 'svc-source', status: 'active' },
          ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_constraint')) return { rows: [] };
      if (sql.includes(') protected_target')) {
        return { rows: [{ blocker: 'active resource quarantine workflow' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await mergeServices('svc-target', 'svc-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Target service merge blocked by active resource quarantine workflow');
    expect(result.error).toContain('reverify');
    expect(clientQueryMock.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE public.') || String(sql).includes("SET status = 'defunct'")
    ))).toBe(false);
  });

  it('fails closed when both services have active ownership transfers', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_profiles')) return authorizedActorRows;
      if (sql.includes('FROM services') && sql.includes('id = ANY')) {
        return {
          rows: [
            { id: 'svc-target', status: 'active' },
            { id: 'svc-source', status: 'active' },
          ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_constraint')) return { rows: [] };
      if (
        sql.includes('SELECT id, submission_id, hold_reason')
        && sql.includes('resource_freshness_findings')
      ) return { rows: [] };
      if (sql.includes('FROM public.ownership_transfers source_transfer')) {
        return { rows: [{ id: 'transfer-source' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await mergeServices('svc-target', 'svc-source', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('both have active ownership transfers');
    expect(clientQueryMock.mock.calls.some(([sql]) => (
      String(sql).includes("SET status = 'defunct'")
    ))).toBe(false);
  });

  it('retires source freshness work without rebinding it to the merged target', async () => {
    const findingId = '40000000-0000-4000-8000-000000000001';
    const submissionId = '30000000-0000-4000-8000-000000000001';
    const holdReason = `resource_freshness:stale_source:${findingId}`;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM user_profiles')) return authorizedActorRows;
      if (
        sql.includes('SELECT id, submission_id, hold_reason')
        && sql.includes('FROM oran_internal.resource_freshness_findings')
        && sql.includes("status = 'open'")
      ) {
        return { rows: [{ id: findingId, submission_id: submissionId, hold_reason: holdReason }] };
      }
      if (sql.includes('FROM submissions') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: submissionId, status: 'under_review' }] };
      }
      if (sql.includes('FROM services') && sql.includes('id = ANY')) {
        return {
          rows: [
            { id: 'svc-target', status: 'active' },
            { id: 'svc-source', status: 'active' },
          ],
        };
      }
      if (sql.includes('FROM pg_catalog.pg_constraint')) return { rows: [] };
      if (sql.includes('UPDATE public."service_at_location"')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE public."phones"')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM public.ownership_transfers source_transfer')) return { rows: [] };
      if (sql.includes('UPDATE submissions sub SET service_id')) return { rows: [], rowCount: 0 };
      if (sql.includes('UPDATE confidence_scores')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });

    const result = await mergeServices('svc-target', 'svc-source', 'oran-admin-1');

    expect(result.success).toBe(true);
    const calls = clientQueryMock.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => (
      sql.includes('UPDATE oran_internal.resource_freshness_findings')
      && sql.includes("status = 'resolved'")
    ))).toBe(true);
    expect(calls.some((sql) => (
      sql.includes('UPDATE services')
      && sql.includes("integrity_held_by_user_id = 'system:resource-freshness-scan'")
    ))).toBe(true);
    const submissionMove = calls.find((sql) => sql.includes('UPDATE submissions sub SET service_id'));
    expect(submissionMove).toContain('resource_freshness_findings');
    expect(calls.some((sql) => sql.includes("SET status = 'archived'"))).toBe(true);
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
