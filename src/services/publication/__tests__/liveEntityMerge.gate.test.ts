import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  acquireLivePublicationGateShared,
  acquireLivePublicationMergeLock,
} from '@/services/publication/liveEntityMerge';

function captureClient() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { client: { query } as unknown as PoolClient, query };
}

function extractAdvisoryKey(sql: string): string {
  const match = /hashtextextended\('([^']+)'/.exec(sql);
  if (!match) throw new Error(`no advisory key in: ${sql}`);
  return match[1];
}

describe('live publication gate pair', () => {
  it('takes shared and exclusive locks over the same advisory key', async () => {
    const shared = captureClient();
    const exclusive = captureClient();

    await acquireLivePublicationGateShared(shared.client);
    await acquireLivePublicationMergeLock(exclusive.client);

    const sharedSql = shared.query.mock.calls[0][0] as string;
    const exclusiveSql = exclusive.query.mock.calls[0][0] as string;

    expect(sharedSql).toContain('pg_advisory_xact_lock_shared');
    expect(exclusiveSql).toContain('pg_advisory_xact_lock(');
    expect(exclusiveSql).not.toContain('pg_advisory_xact_lock_shared');
    expect(extractAdvisoryKey(sharedSql)).toBe(extractAdvisoryKey(exclusiveSql));
  });
});
