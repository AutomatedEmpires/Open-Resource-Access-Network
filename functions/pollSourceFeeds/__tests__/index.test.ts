import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimerInfo } from '../index';

function makeTimer(isPastDue = false): TimerInfo {
  return { schedule: { isRunning: false }, isPastDue };
}

describe('pollSourceFeeds', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('ORAN_APP_URL', 'https://oran.test');
    vi.stubEnv('INTERNAL_API_KEY', 'secret-key');
    vi.stubEnv('SOURCE_FEED_POLLING_ENABLED', 'true');
  });

  it('skips when source feed polling is disabled', async () => {
    vi.stubEnv('SOURCE_FEED_POLLING_ENABLED', 'false');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { pollSourceFeeds } = await import('../index');

    await pollSourceFeeds(makeTimer());

    expect(logSpy).toHaveBeenCalledWith('[pollSourceFeeds] SOURCE_FEED_POLLING_ENABLED disabled — skipping');
  });

  it('logs an error when required env is missing', async () => {
    vi.stubEnv('ORAN_APP_URL', '');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { pollSourceFeeds } = await import('../index');

    await pollSourceFeeds(makeTimer());

    expect(errorSpy).toHaveBeenCalledWith('[pollSourceFeeds] Missing ORAN_APP_URL or INTERNAL_API_KEY');
  });

  it('calls the internal feed poll endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, feedsPolled: 2, newUrls: 30, errors: 0, checkedAt: '2026-03-13T00:00:00Z' }),
    });
    vi.stubGlobal('fetch', fetchMock as typeof fetch);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { pollSourceFeeds } = await import('../index');

    await pollSourceFeeds(makeTimer(true));

    expect(fetchMock).toHaveBeenCalledWith('https://oran.test/api/internal/ingestion/feed-poll', expect.objectContaining({ method: 'POST' }));
    expect(logSpy).toHaveBeenCalledWith('[pollSourceFeeds] Completed — polled 2 feeds, created 30 records, errors 0 at 2026-03-13T00:00:00Z');
  });
});
