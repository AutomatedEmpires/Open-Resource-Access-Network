import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type CronConfig = {
  crons?: Array<{ path: string; schedule: string }>;
};

const expectedCrons = [
  { path: '/api/internal/ingestion/feed-poll', schedule: '0 6 * * *' },
  { path: '/api/internal/sla-check', schedule: '15 7 * * *' },
  { path: '/api/internal/coverage-gaps', schedule: '30 8 * * *' },
  { path: '/api/internal/confidence-regression-scan', schedule: '45 9 * * *' },
  { path: '/api/internal/resource-freshness-scan', schedule: '0 11 * * *' },
  { path: '/api/internal/account-erasure', schedule: '30 11 * * *' },
];

describe('Vercel Cron configuration', () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
  ) as CronConfig;

  it('registers only the reviewed ORAN internal routes', () => {
    expect(config.crons).toEqual(expectedCrons);
  });

  it('uses one invocation per day for every job', () => {
    for (const cron of config.crons ?? []) {
      const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.schedule.split(' ');

      expect(minute).toMatch(/^\d{1,2}$/);
      expect(hour).toMatch(/^\d{1,2}$/);
      expect(dayOfMonth).toBe('*');
      expect(month).toBe('*');
      expect(dayOfWeek).toBe('*');
    }
  });
});
