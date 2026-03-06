/**
 * Confidence Regression Detector
 *
 * Pure read-only detection functions that identify services with degraded
 * trust signals. Each function queries the database for one signal type and
 * returns an array of RegressionCandidate objects.
 *
 * The detection layer is intentionally separated from persistence so it can
 * be unit-tested independently of the write path.
 *
 * Four signals are detected:
 *   1. service_updated_after_verification — data changed after score computed
 *   2. feedback_severity — 3+ negative user feedback items in 30 days
 *   3. score_staleness — score not recomputed in 90+ days
 *   4. score_degraded — active service in RED tier (score < 40)
 */

import { getConfidenceBand } from '@/domain/confidence';
import type { ConfidenceBand } from '@/domain/confidence';

/**
 * Minimal query interface satisfied by both Pool and PoolClient from pg.
 * Detectors accept this duck type so the route can pass a Pool for the
 * read phase (real parallelism via multiple connections) and a PoolClient
 * for the write phase (single transaction).
 */
interface Queryable {
  query<T extends object = object>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

// ============================================================
// TYPES
// ============================================================

export type RegressionSignalType =
  | 'service_updated_after_verification'
  | 'feedback_severity'
  | 'score_staleness'
  | 'score_degraded';

export interface RegressionCandidate {
  serviceId: string;
  serviceName: string;
  signalType: RegressionSignalType;
  currentScore: number;
  currentBand: ConfidenceBand;
  reasons: string[];
  /** Time-windowed dedup key; same key = same (service, signal) within 72 hours. */
  dedupeKey: string;
  /** Human-readable notes for the admin submission record. */
  notesText: string;
}

// ============================================================
// CONSTANTS
// ============================================================

/** Number of distinct signal detectors. Used to split the processing budget. */
const SIGNAL_COUNT = 4;

/** Days after which a confidence score is considered stale. */
const STALENESS_DAYS = 90;

/** Minimum negative feedback count (in 30 days) to trigger a regression. */
const FEEDBACK_SEVERITY_THRESHOLD = 3;

/** Rolling window (days) for the feedback severity signal. */
const FEEDBACK_WINDOW_DAYS = 30;

/** Dedup window in milliseconds (72 hours). */
const DEDUPE_WINDOW_MS = 72 * 60 * 60 * 1_000;

// ============================================================
// HELPERS
// ============================================================

/**
 * Generate a time-windowed deduplication key.
 *
 * Returns the same string for any detection of the same (serviceId, signalType)
 * pair within the same 72-hour window, preventing duplicate regression records.
 */
export function makeDedupeKey(serviceId: string, signalType: RegressionSignalType): string {
  const windowId = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  return `${serviceId}:${signalType}:${windowId}`;
}

/**
 * Calculate per-signal query limit from a total processing budget.
 * Divides evenly across all signal detectors, rounding up.
 */
export function perSignalLimit(totalLimit: number): number {
  return Math.ceil(totalLimit / SIGNAL_COUNT);
}

// ============================================================
// SIGNAL DETECTORS
// ============================================================

/**
 * Signal 1: service data was updated after the trust score was computed.
 *
 * Indicates the score may no longer reflect current service state.
 * Only flags services currently in LIKELY (≥60) or HIGH (≥80) bands —
 * services already in POSSIBLE should be caught by `detectScoreDegraded`.
 */
export async function detectServiceUpdated(
  client: Queryable,
  limit: number,
): Promise<RegressionCandidate[]> {
  const result = await client.query<{
    service_id: string;
    service_name: string;
    score: string;
  }>(
    `SELECT s.id AS service_id, s.name AS service_name, cs.score::text
     FROM services s
     JOIN confidence_scores cs ON cs.service_id = s.id
     WHERE s.updated_at > cs.computed_at
       AND cs.score >= 60
       AND s.status = 'active'
     ORDER BY s.updated_at DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => {
    const score = Number(row.score);
    return {
      serviceId: row.service_id,
      serviceName: row.service_name,
      signalType: 'service_updated_after_verification',
      currentScore: score,
      currentBand: getConfidenceBand(score),
      reasons: ['Service record was updated after the confidence score was last computed'],
      dedupeKey: makeDedupeKey(row.service_id, 'service_updated_after_verification'),
      notesText:
        'Auto-flagged: service record changed after last confidence computation; re-review suggested.',
    };
  });
}

/**
 * Signal 2: 3+ verified negative feedback signals in the last 30 days.
 *
 * Actionable triage categories: service_closed, incorrect_phone,
 * incorrect_address, incorrect_hours.
 */
export async function detectFeedbackSeverity(
  client: Queryable,
  limit: number,
): Promise<RegressionCandidate[]> {
  const result = await client.query<{
    service_id: string;
    service_name: string;
    score: string;
    neg_count: string;
    categories: string;
  }>(
    `SELECT
       sf.service_id,
       s.name AS service_name,
       COALESCE(cs.score, 0)::text AS score,
       COUNT(sf.id)::text AS neg_count,
       array_to_string(array_agg(DISTINCT sf.triage_category), ', ') AS categories
     FROM seeker_feedback sf
     JOIN services s ON s.id = sf.service_id
     LEFT JOIN confidence_scores cs ON cs.service_id = sf.service_id
     WHERE sf.triage_category IN ('service_closed', 'incorrect_phone', 'incorrect_address', 'incorrect_hours')
       AND sf.created_at > NOW() - INTERVAL '30 days'
       AND s.status = 'active'
     GROUP BY sf.service_id, s.name, cs.score
     HAVING COUNT(sf.id) >= $2
     ORDER BY COUNT(sf.id) DESC
     LIMIT $1`,
    [limit, FEEDBACK_SEVERITY_THRESHOLD],
  );

  return result.rows.map((row) => {
    const score = Number(row.score);
    return {
      serviceId: row.service_id,
      serviceName: row.service_name,
      signalType: 'feedback_severity',
      currentScore: score,
      currentBand: getConfidenceBand(score),
      reasons: [
        `${row.neg_count} negative feedback reports in the last ${FEEDBACK_WINDOW_DAYS} days`,
        `Issue categories: ${row.categories}`,
      ],
      dedupeKey: makeDedupeKey(row.service_id, 'feedback_severity'),
      notesText: `Auto-flagged: ${row.neg_count} negative feedback items in last ${FEEDBACK_WINDOW_DAYS} days (${row.categories}).`,
    };
  });
}

/**
 * Signal 3: confidence score not recomputed in 90+ days.
 *
 * Indicates the trust score may be stale and should be re-evaluated.
 * Only flags active services in ORANGE (≥40) or higher tier — RED-tier
 * services are caught by `detectScoreDegraded`.
 */
export async function detectStaleness(
  client: Queryable,
  limit: number,
): Promise<RegressionCandidate[]> {
  const result = await client.query<{
    service_id: string;
    service_name: string;
    score: string;
    days_stale: string;
  }>(
    `SELECT
       s.id AS service_id,
       s.name AS service_name,
       cs.score::text,
       EXTRACT(DAY FROM (NOW() - cs.computed_at))::int::text AS days_stale
     FROM services s
     JOIN confidence_scores cs ON cs.service_id = s.id
     WHERE cs.computed_at < NOW() - INTERVAL '90 days'
       AND s.status = 'active'
       AND cs.score >= 40
       AND NOT EXISTS (
         SELECT 1 FROM confidence_regressions cr
         WHERE cr.entity_id = s.id
           AND cr.signal_type = 'score_staleness'
           AND cr.status NOT IN ('resolved', 'suppressed')
       )
     ORDER BY cs.computed_at ASC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => {
    const score = Number(row.score);
    const days = Number(row.days_stale);
    return {
      serviceId: row.service_id,
      serviceName: row.service_name,
      signalType: 'score_staleness',
      currentScore: score,
      currentBand: getConfidenceBand(score),
      reasons: [
        `Confidence score not recomputed in ${days} days (threshold: ${STALENESS_DAYS} days)`,
      ],
      dedupeKey: makeDedupeKey(row.service_id, 'score_staleness'),
      notesText: `Auto-flagged: confidence score is ${days} days stale; re-scoring recommended.`,
    };
  });
}

/**
 * Signal 4: active service has a critically low confidence score (< 40, RED tier).
 *
 * These services are failing minimum trust thresholds and need immediate
 * verification to continue being responsibly surfaced to seekers.
 */
export async function detectScoreDegraded(
  client: Queryable,
  limit: number,
): Promise<RegressionCandidate[]> {
  const result = await client.query<{
    service_id: string;
    service_name: string;
    score: string;
  }>(
    `SELECT s.id AS service_id, s.name AS service_name, cs.score::text
     FROM services s
     JOIN confidence_scores cs ON cs.service_id = s.id
     WHERE cs.score < 40
       AND s.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM confidence_regressions cr
         WHERE cr.entity_id = s.id
           AND cr.signal_type = 'score_degraded'
           AND cr.status NOT IN ('resolved', 'suppressed')
       )
     ORDER BY cs.score ASC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => {
    const score = Number(row.score);
    return {
      serviceId: row.service_id,
      serviceName: row.service_name,
      signalType: 'score_degraded',
      currentScore: score,
      currentBand: getConfidenceBand(score),
      reasons: [
        `Score ${score} is below RED tier threshold (40); active service needs verification`,
      ],
      dedupeKey: makeDedupeKey(row.service_id, 'score_degraded'),
      notesText: `Auto-flagged: active service has critically low confidence score (${score}/100); verification required.`,
    };
  });
}

// ============================================================
// ORCHESTRATOR
// ============================================================

/**
 * Run all four regression detectors and return a deduplicated list of candidates.
 *
 * Each detector receives an equal share of the total processing budget.
 * Results are deduplicated by dedupeKey — same (service, signal) in the same
 * 72-hour window appears at most once.
 */
export async function detectRegressions(
  client: Queryable,
  totalLimit: number,
): Promise<RegressionCandidate[]> {
  const limit = perSignalLimit(totalLimit);

  const [updated, feedback, stale, degraded] = await Promise.all([
    detectServiceUpdated(client, limit),
    detectFeedbackSeverity(client, limit),
    detectStaleness(client, limit),
    detectScoreDegraded(client, limit),
  ]);

  // Deduplicate: same dedupeKey = same (service_id, signal_type) in same 72h window
  const seen = new Set<string>();
  return [...updated, ...feedback, ...stale, ...degraded].filter((c) => {
    if (seen.has(c.dedupeKey)) return false;
    seen.add(c.dedupeKey);
    return true;
  });
}
