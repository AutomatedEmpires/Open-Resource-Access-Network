/**
 * alertCoverageGaps — Timer-triggered Azure Function (daily at 8 AM UTC).
 *
 * Identifies geographic areas with unrouted candidates (no admin assignment
 * after 24+ hours) and sends system alerts to ORAN admins.
 *
 * This addresses Phase 3 gap "Geographic gap alerting scheduled function".
 *
 * Azure Function binding:
 *   trigger: timer  schedule: "0 0 8 * * *" (daily at 08:00 UTC)
 *
 * Environment variables required:
 *   ORAN_APP_URL       — Base URL of the ORAN web app
 *   INTERNAL_API_KEY   — Shared secret for internal API authentication
 *
 * @module functions/alertCoverageGaps
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimerInfo {
  schedule: { isRunning: boolean };
  isPastDue: boolean;
}

export interface CoverageGapResult {
  success: boolean;
  unroutedCount: number;
  gapStates: string[];
  alertsSent: number;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Timer-triggered function that detects unrouted candidates and coverage gaps.
 * Runs daily at 8 AM UTC to give ORAN admins a daily digest of problem areas.
 */
export async function alertCoverageGaps(timer: TimerInfo): Promise<void> {
  const appUrl = process.env.ORAN_APP_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!appUrl || !apiKey) {
    console.error('[alertCoverageGaps] Missing ORAN_APP_URL or INTERNAL_API_KEY');
    return;
  }

  if (timer.isPastDue) {
    console.warn('[alertCoverageGaps] Timer is past due — running catch-up');
  }

  try {
    const response = await fetch(`${appUrl}/api/internal/coverage-gaps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ thresholdHours: 24 }),
    });

    if (!response.ok) {
      console.error(
        `[alertCoverageGaps] API returned ${response.status}: ${await response.text()}`
      );
      return;
    }

    const result: CoverageGapResult = await response.json();

    console.log(
      `[alertCoverageGaps] Checked coverage gaps: ` +
        `${result.unroutedCount} unrouted candidates, ` +
        `${result.gapStates.length} gap states, ` +
        `${result.alertsSent} alerts sent`
    );
  } catch (error) {
    console.error('[alertCoverageGaps] Failed to check coverage gaps:', error);
  }
}
