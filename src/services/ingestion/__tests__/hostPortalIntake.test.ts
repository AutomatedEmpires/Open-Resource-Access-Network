import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createHostPortalSourceAssertion } from '../hostPortalIntake';

describe('host portal source assertions', () => {
  it('writes only enum-aligned manual source, feed, and normalized record values', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('INSERT INTO source_systems')) {
        return { rows: [{ id: 'system-1' }] };
      }
      if (sql.includes('FROM source_feeds')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO source_feeds')) {
        return { rows: [{ id: 'feed-1' }] };
      }
      if (sql.includes('FROM source_records')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO source_records')) {
        return { rows: [{ id: 'record-1' }] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as PoolClient;

    const result = await createHostPortalSourceAssertion(client, {
      actorUserId: 'host-user-1',
      actorRole: 'host_admin',
      recordType: 'host_service_update',
      recordId: 'service-1',
      canonicalSourceUrl: 'oran://host/services/service-1',
      payload: { serviceId: 'service-1', name: 'Updated service' },
    });

    expect(result).toEqual({
      sourceSystemId: 'system-1',
      sourceFeedId: 'feed-1',
      sourceRecordId: 'record-1',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'trusted_partner', 'service_catalog'"),
      expect.arrayContaining(['ORAN Host Portal', 'manual', 'oran://host-portal']),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'custom'"),
      [
        'system-1',
        'Host Portal Intake',
        'manual_entry',
        'oran://host-portal',
        'oran:reserved-feed:host-portal:system-1',
      ],
    );
    const authoritySql = query.mock.calls
      .filter(([sql]) => sql.includes('INSERT INTO source_systems') || sql.includes('INSERT INTO source_feeds'))
      .map(([sql]) => sql)
      .join('\n');
    expect(authoritySql).not.toContain('DO UPDATE');
    expect(authoritySql).toContain('configuration_matches');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'normalized'"),
      expect.arrayContaining([
        'feed-1',
        'mixed_bundle',
        'service-1',
        'oran://host/services/service-1',
      ]),
    );
    const sourceRecordParams = query.mock.calls.find(
      ([sql]) => sql.includes('INSERT INTO source_records'),
    )?.[1] as unknown[];
    expect(sourceRecordParams.at(-1)).toContain('"assertionType":"host_service_update"');
  });
});
