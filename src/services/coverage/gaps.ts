/**
 * Coverage Gaps Service
 *
 * Identifies geographic areas with unrouted candidates and insufficient
 * admin coverage. Used by both the alertCoverageGaps Azure Function
 * and the ORAN admin coverage gap dashboard.
 *
 * @module services/coverage/gaps
 */

import { executeQuery } from '@/services/db/postgres';

// ============================================================
// TYPES
// ============================================================

export interface UnroutedCandidate {
  candidateId: string;
  stateProvince: string | null;
  countyOrRegion: string | null;
  enqueuedAt: string;
  hoursWaiting: number;
}

export interface CoverageGapSummary {
  state: string;
  county: string | null;
  unroutedCount: number;
  oldestHoursWaiting: number;
}

export interface CoverageGapReport {
  unroutedCandidates: UnroutedCandidate[];
  gapSummaries: CoverageGapSummary[];
  statesWithCoverage: string[];
  statesWithoutCoverage: string[];
}

// ============================================================
// QUERIES
// ============================================================

/**
 * Find candidates that have no admin assignment after `thresholdHours`.
 * These indicate geographic areas with no available admin coverage.
 */
export async function findUnroutedCandidates(
  thresholdHours: number = 24,
): Promise<UnroutedCandidate[]> {
  return executeQuery<UnroutedCandidate>(
    `SELECT
       ec.id AS "candidateId",
       ec.fields->>'stateProvince' AS "stateProvince",
       ec.fields->>'countyOrRegion' AS "countyOrRegion",
       ec.created_at AS "enqueuedAt",
       EXTRACT(EPOCH FROM (NOW() - ec.created_at)) / 3600 AS "hoursWaiting"
     FROM extracted_candidates ec
     WHERE ec.review_status IN ('pending', 'needs_review')
       AND ec.created_at < NOW() - INTERVAL '1 hour' * $1
       AND NOT EXISTS (
         SELECT 1 FROM candidate_admin_assignments caa
         WHERE caa.candidate_id = ec.id
           AND caa.assignment_status NOT IN ('expired', 'declined')
       )
     ORDER BY ec.created_at ASC
     LIMIT 200`,
    [thresholdHours],
  );
}

/**
 * Aggregate unrouted candidates by state/county for gap analysis.
 */
export async function getCoverageGapSummaries(
  thresholdHours: number = 24,
): Promise<CoverageGapSummary[]> {
  return executeQuery<CoverageGapSummary>(
    `SELECT
       COALESCE(ec.fields->>'stateProvince', 'Unknown') AS state,
       ec.fields->>'countyOrRegion' AS county,
       COUNT(*)::int AS "unroutedCount",
       MAX(EXTRACT(EPOCH FROM (NOW() - ec.created_at)) / 3600) AS "oldestHoursWaiting"
     FROM extracted_candidates ec
     WHERE ec.review_status IN ('pending', 'needs_review')
       AND ec.created_at < NOW() - INTERVAL '1 hour' * $1
       AND NOT EXISTS (
         SELECT 1 FROM candidate_admin_assignments caa
         WHERE caa.candidate_id = ec.id
           AND caa.assignment_status NOT IN ('expired', 'declined')
       )
     GROUP BY state, county
     ORDER BY "unroutedCount" DESC`,
    [thresholdHours],
  );
}

/**
 * Get full coverage gap report (combines unrouted candidates + summaries +
 * states with/without admin coverage).
 */
export async function getCoverageGapReport(
  thresholdHours: number = 24,
): Promise<CoverageGapReport> {
  const [unroutedCandidates, gapSummaries, coveredStates] = await Promise.all([
    findUnroutedCandidates(thresholdHours),
    getCoverageGapSummaries(thresholdHours),
    executeQuery<{ state: string }>(
      `SELECT DISTINCT unnest(coverage_states) AS state
       FROM admin_review_profiles
       WHERE is_active = true
       ORDER BY state`,
      [],
    ),
  ]);

  const statesWithCoverage = coveredStates.map((r) => r.state);
  const gapStates = [...new Set(
    gapSummaries
      .map((g) => g.state)
      .filter((s) => s !== 'Unknown' && !statesWithCoverage.includes(s)),
  )];

  return {
    unroutedCandidates,
    gapSummaries,
    statesWithCoverage,
    statesWithoutCoverage: gapStates,
  };
}

/**
 * Send system_alert notifications to ORAN admins about coverage gaps.
 * Idempotent: uses date-based idempotency keys (one alert per day per gap state).
 */
export async function alertOranAdminsAboutGaps(
  gapSummaries: CoverageGapSummary[],
): Promise<number> {
  if (gapSummaries.length === 0) return 0;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const summaryText = gapSummaries
    .slice(0, 10) // Cap to prevent huge notification bodies
    .map((g) => `${g.state}${g.county ? `/${g.county}` : ''}: ${g.unroutedCount} unrouted`)
    .join(', ');

  const rows = await executeQuery<{ id: string }>(
    `INSERT INTO notification_events
       (recipient_user_id, event_type, title, body,
        resource_type, resource_id, idempotency_key)
     SELECT up.user_id, 'system_alert',
            'Coverage gap report: ' || $1 || ' areas without admin coverage',
            'Unrouted candidates found: ' || $2,
            'coverage_gap', $3, 'coverage_gap_' || $3 || '_' || up.user_id
     FROM user_profiles up
     WHERE up.role = 'oran_admin'
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      String(gapSummaries.length),
      summaryText,
      today,
    ],
  );

  return rows.length;
}
