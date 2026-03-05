/**
 * checkSlaBreaches — Timer-triggered Azure Function (hourly).
 *
 * Calls the ORAN web app's internal SLA check endpoint to identify and
 * flag submissions that have exceeded their SLA deadlines.
 *
 * Azure Function binding:
 *   trigger: timer  schedule: "0 0 * * * *" (every hour, on the hour)
 *
 * Environment variables required:
 *   ORAN_APP_URL       — Base URL of the ORAN web app (e.g., https://oranhf57ir-prod-web.azurewebsites.net)
 *   INTERNAL_API_KEY   — Shared secret for internal API authentication
 *
 * @module functions/checkSlaBreaches
 */

// ---------------------------------------------------------------------------
// Types for Azure Functions v4 programming model
// ---------------------------------------------------------------------------

export interface TimerInfo {
  schedule: { isRunning: boolean };
  isPastDue: boolean;
}

export interface SlaCheckResult {
  success: boolean;
  breachedCount: number;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Timer-triggered function that calls the ORAN internal SLA check endpoint.
 * Runs every hour to catch SLA breaches in a timely manner.
 */
export async function checkSlaBreaches(timer: TimerInfo): Promise<void> {
  const appUrl = process.env.ORAN_APP_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!appUrl || !apiKey) {
    console.error('[checkSlaBreaches] Missing ORAN_APP_URL or INTERNAL_API_KEY');
    return;
  }

  if (timer.isPastDue) {
    console.warn('[checkSlaBreaches] Timer is past due — running catch-up');
  }

  const url = `${appUrl}/api/internal/sla-check`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[checkSlaBreaches] HTTP ${response.status}: ${body}`);
      return;
    }

    const result = (await response.json()) as SlaCheckResult;
    console.log(
      `[checkSlaBreaches] Completed — ${result.breachedCount} breaches flagged at ${result.checkedAt}`,
    );
  } catch (error) {
    console.error(
      '[checkSlaBreaches] Failed to call SLA check endpoint:',
      error instanceof Error ? error.message : error,
    );
  }
}
