/**
 * pollSourceFeeds — Timer-triggered Azure Function (hourly).
 *
 * Calls the ORAN web app internal source-feed polling endpoint so active HSDS
 * and 211 feeds are polled on schedule instead of relying on manual admin runs.
 */

export interface TimerInfo {
  schedule: { isRunning: boolean };
  isPastDue: boolean;
}

type PollResult = {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  feedsPolled?: number;
  newUrls?: number;
  errors?: number;
  checkedAt: string;
};

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

export async function pollSourceFeeds(timer: TimerInfo): Promise<void> {
  if (!isEnabled(process.env.SOURCE_FEED_POLLING_ENABLED)) {
    console.log('[pollSourceFeeds] SOURCE_FEED_POLLING_ENABLED disabled — skipping');
    return;
  }

  const appUrl = process.env.ORAN_APP_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!appUrl || !apiKey) {
    console.error('[pollSourceFeeds] Missing ORAN_APP_URL or INTERNAL_API_KEY');
    return;
  }

  if (timer.isPastDue) {
    console.warn('[pollSourceFeeds] Timer is past due — running catch-up');
  }

  try {
    const response = await fetch(`${appUrl}/api/internal/ingestion/feed-poll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[pollSourceFeeds] HTTP ${response.status}: ${body}`);
      return;
    }

    const result = await response.json() as PollResult;
    if (result.skipped) {
      console.log(`[pollSourceFeeds] Skipped — ${result.reason ?? 'no reason provided'}`);
      return;
    }

    console.log(
      `[pollSourceFeeds] Completed — polled ${result.feedsPolled ?? 0} feeds, created ${result.newUrls ?? 0} records, errors ${result.errors ?? 0} at ${result.checkedAt}`,
    );
  } catch (error) {
    console.error(
      '[pollSourceFeeds] Failed to call internal feed polling endpoint:',
      error instanceof Error ? error.message : error,
    );
  }
}
