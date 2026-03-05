/**
 * scanConfidenceRegressions — Timer-triggered Azure Function (every 6 hours).
 *
 * Calls the ORAN web app's internal confidence regression scan endpoint.
 * This creates deduped `confidence_regression` submissions for verified
 * services that have changed since their last confidence computation.
 *
 * Environment variables required:
 *   ORAN_APP_URL       — Base URL of the ORAN web app
 *   INTERNAL_API_KEY   — Shared secret for internal API authentication
 */

export interface TimerInfo {
  schedule: { isRunning: boolean };
  isPastDue: boolean;
}

export interface RegressionScanResult {
  success: boolean;
  createdCount: number;
  checkedAt: string;
}

export async function scanConfidenceRegressions(timer: TimerInfo): Promise<void> {
  const appUrl = process.env.ORAN_APP_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!appUrl || !apiKey) {
    console.error('[scanConfidenceRegressions] Missing ORAN_APP_URL or INTERNAL_API_KEY');
    return;
  }

  if (timer.isPastDue) {
    console.warn('[scanConfidenceRegressions] Timer is past due — running catch-up');
  }

  const url = `${appUrl}/api/internal/confidence-regression-scan`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 100 }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[scanConfidenceRegressions] HTTP ${response.status}: ${body}`);
      return;
    }

    const result = (await response.json()) as RegressionScanResult;
    console.log(
      `[scanConfidenceRegressions] Completed — created ${result.createdCount} regression submissions at ${result.checkedAt}`,
    );
  } catch (error) {
    console.error(
      '[scanConfidenceRegressions] Failed to call regression scan endpoint:',
      error instanceof Error ? error.message : error,
    );
  }
}
