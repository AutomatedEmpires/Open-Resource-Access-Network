/**
 * Triage service — Queue Triage with Anomaly Prioritization (§3).
 *
 * Computes deterministic triage_priority scores for admin review queue entries.
 * All scoring is pure SQL aggregate queries — no LLM participation.
 *
 * Non-negotiables:
 *   - No PII stored in triage_scores or explanations.
 *   - Crisis signal uses service_attributes taxonomy only.
 *   - Scoring functions are deterministic and auditable.
 *   - getTriageQueue is retrieval-only from stored records.
 */

import { executeQuery } from '@/services/db/postgres';
import {
  computeTriagePriority,
  buildTriageExplanations,
  CRISIS_ADJACENT_SITUATION_TAGS,
  TRAFFIC_SATURATION_SAVES,
  TRUST_CONCERN_THRESHOLD,
  FEEDBACK_SATURATION_COUNT,
  STALENESS_DAYS_SATURATION,
  HIGH_PRIORITY_THRESHOLD,
  CRITICAL_PRIORITY_THRESHOLD,
  QUEUE_SUBMISSION_TYPES,
  QUEUE_TYPE_LABELS,
  ACTIONABLE_STATUSES,
  type QueueType,
  type TriageQueueEntry,
  type TriageScore,
  type TriageQueueSummary,
  type TriageSignals,
} from '@/domain/triage';

// ============================================================
// RAW SIGNAL QUERY
// ============================================================

interface RawSignalRow {
  submission_id:   string;
  service_id:      string | null;
  created_at:      string;
  sla_deadline:    string | null;
  sla_breached:    boolean;
  saves_count:     string; // BigInt from COUNT — coerce
  avg_confidence:  string | null; // NUMERIC
  neg_feedback:    string; // COUNT — coerce
  has_crisis_tag:  boolean;
}

/**
 * Fetch raw scoring signals for a single submission.
 * Returns null if the submission is not found.
 */
async function fetchRawSignals(submissionId: string): Promise<RawSignalRow | null> {
  const result = await executeQuery<RawSignalRow>(
    `
    SELECT
      s.id                AS submission_id,
      s.service_id,
      s.created_at,
      s.sla_deadline,
      s.sla_breached,

      -- Traffic signal: number of times this service has been saved
      COALESCE(saves.cnt, 0)              AS saves_count,

      -- Trust signal: confidence score for the related service
      cs.score                            AS avg_confidence,

      -- Feedback signal: negative feedback in last 90 days (rating ≤ 2)
      COALESCE(fb.neg_cnt, 0)            AS neg_feedback,

      -- Crisis signal: service has any crisis-adjacent situation tag
      EXISTS (
        SELECT 1
        FROM   service_attributes sa
        WHERE  sa.service_id = s.service_id
          AND  sa.taxonomy   = 'situation'
          AND  sa.tag        = ANY($2::text[])
      ) AS has_crisis_tag

    FROM submissions s

    -- Saves count (traffic proxy)
    LEFT JOIN (
      SELECT service_id, COUNT(*) AS cnt
      FROM   saved_services
      WHERE  service_id IS NOT NULL
      GROUP  BY service_id
    ) saves ON saves.service_id = s.service_id

    -- Confidence score (trust proxy)
    LEFT JOIN confidence_scores cs
      ON cs.service_id = s.service_id

    -- Negative feedback count (last 90 days)
    LEFT JOIN (
      SELECT service_id, COUNT(*) AS neg_cnt
      FROM   seeker_feedback
      WHERE  rating <= 2
        AND  created_at >= now() - INTERVAL '90 days'
        AND  service_id IS NOT NULL
      GROUP  BY service_id
    ) fb ON fb.service_id = s.service_id

    WHERE s.id = $1
    `,
    [submissionId, CRISIS_ADJACENT_SITUATION_TAGS],
  );

  return result.rows[0] ?? null;
}

// ============================================================
// SIGNAL NORMALIZATION
// ============================================================

function normalizeSignals(raw: RawSignalRow): TriageSignals {
  // Traffic: saves / saturation ceiling → [0, 1]
  const saves = Number(raw.saves_count);
  const signal_traffic = Math.min(1, saves / TRAFFIC_SATURATION_SAVES);

  // Trust: low confidence = high priority
  // If no confidence score exists, treat as maximum concern (1.0)
  const confidence = raw.avg_confidence != null ? Number(raw.avg_confidence) : 0;
  const signal_trust =
    raw.avg_confidence == null
      ? 1.0
      : confidence <= TRUST_CONCERN_THRESHOLD
        ? 1.0
        : Math.max(0, (75 - confidence) / (75 - TRUST_CONCERN_THRESHOLD));

  // Feedback: neg feedback count / saturation → [0, 1]
  const negFeedback = Number(raw.neg_feedback);
  const signal_feedback = Math.min(1, negFeedback / FEEDBACK_SATURATION_COUNT);

  // Staleness: days in queue / saturation ceiling → [0, 1]
  const ageMs = Date.now() - new Date(raw.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const signal_staleness = Math.min(1, ageDays / STALENESS_DAYS_SATURATION);

  // Crisis: binary — 0 or 1
  const signal_crisis = raw.has_crisis_tag ? 1 : 0;

  // SLA breach: binary (breached=1) or stepped (deadline within 24h = 0.7)
  let signal_sla_breach = 0;
  if (raw.sla_breached) {
    signal_sla_breach = 1;
  } else if (raw.sla_deadline) {
    const hoursUntilDeadline =
      (new Date(raw.sla_deadline).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilDeadline <= 24) {
      signal_sla_breach = 0.7;
    }
  }

  return {
    signal_traffic,
    signal_trust,
    signal_feedback,
    signal_staleness,
    signal_crisis,
    signal_sla_breach,
  };
}

// ============================================================
// SCORE A SINGLE SUBMISSION
// ============================================================

/**
 * Compute triage score for a submission and upsert into triage_scores.
 * Returns the saved TriageScore, or null if the submission was not found.
 */
export async function scoreSubmission(submissionId: string): Promise<TriageScore | null> {
  const raw = await fetchRawSignals(submissionId);
  if (!raw) return null;

  const signals = normalizeSignals(raw);
  const priority = computeTriagePriority(signals);
  const explanations = buildTriageExplanations(signals);

  const result = await executeQuery<TriageScore>(
    `
    INSERT INTO triage_scores (
      submission_id,
      triage_priority,
      signal_traffic,
      signal_trust,
      signal_feedback,
      signal_staleness,
      signal_crisis,
      signal_sla_breach,
      triage_explanations,
      scored_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
    ON CONFLICT (submission_id) DO UPDATE SET
      triage_priority     = EXCLUDED.triage_priority,
      signal_traffic      = EXCLUDED.signal_traffic,
      signal_trust        = EXCLUDED.signal_trust,
      signal_feedback     = EXCLUDED.signal_feedback,
      signal_staleness    = EXCLUDED.signal_staleness,
      signal_crisis       = EXCLUDED.signal_crisis,
      signal_sla_breach   = EXCLUDED.signal_sla_breach,
      triage_explanations = EXCLUDED.triage_explanations,
      scored_at           = now()
    RETURNING *
    `,
    [
      submissionId,
      priority,
      signals.signal_traffic,
      signals.signal_trust,
      signals.signal_feedback,
      signals.signal_staleness,
      signals.signal_crisis,
      signals.signal_sla_breach,
      explanations,
    ],
  );

  return result.rows[0] ?? null;
}

// ============================================================
// BULK SCORE PENDING SUBMISSIONS
// ============================================================

/**
 * Score all actionable submissions that have no score yet or were scored
 * more than 1 hour ago. Returns the count of submissions scored.
 *
 * Safe to call periodically (e.g. from an Azure Function timer trigger).
 * Processes in batches of 100 to limit DB round-trips.
 */
export async function scoreAllPendingSubmissions(): Promise<number> {
  const pending = await executeQuery<{ id: string }>(
    `
    SELECT s.id
    FROM   submissions s
    LEFT JOIN triage_scores ts ON ts.submission_id = s.id
    WHERE  s.status = ANY($1::text[])
      AND (ts.submission_id IS NULL OR ts.scored_at < now() - INTERVAL '1 hour')
    ORDER  BY s.created_at ASC
    LIMIT  100
    `,
    [ACTIONABLE_STATUSES as unknown as string[]],
  );

  let scored = 0;
  for (const { id } of pending.rows) {
    const result = await scoreSubmission(id);
    if (result) scored++;
  }
  return scored;
}

// ============================================================
// GET TRIAGE QUEUE
// ============================================================

interface GetTriageQueueOptions {
  queueType:    QueueType;
  limit?:       number;
  offset?:      number;
  minPriority?: number; // filter to >= this priority
  sortBy?:      'priority' | 'created_at';
}

/**
 * List queue entries for a given queue type, joined with triage scores.
 * Returns submissions ordered by triage_priority DESC, created_at ASC.
 *
 * Submissions without a triage score yet appear at the end (priority=0).
 */
export async function getTriageQueue(opts: GetTriageQueueOptions): Promise<{
  entries: TriageQueueEntry[];
  total: number;
}> {
  const {
    queueType,
    limit = 25,
    offset = 0,
    minPriority = 0,
    sortBy = 'priority',
  } = opts;

  const submissionTypes = QUEUE_SUBMISSION_TYPES[queueType];

  const orderClause =
    sortBy === 'created_at'
      ? 'ORDER BY s.created_at ASC'
      : 'ORDER BY COALESCE(ts.triage_priority, 0) DESC, s.created_at ASC';

  const [dataResult, countResult] = await Promise.all([
    executeQuery<TriageQueueEntry>(
      `
      SELECT
        s.id                                   AS submission_id,
        s.submission_type,
        s.status,
        s.title,
        s.service_id,
        svc.name                               AS service_name,
        s.created_at,
        s.sla_deadline,
        s.sla_breached,
        COALESCE(ts.triage_priority, 0)        AS triage_priority,
        COALESCE(ts.triage_explanations, '{}') AS triage_explanations,
        ts.scored_at
      FROM submissions s
      LEFT JOIN services svc ON svc.id = s.service_id
      LEFT JOIN triage_scores ts ON ts.submission_id = s.id
      WHERE s.submission_type = ANY($1::text[])
        AND s.status          = ANY($2::text[])
        AND COALESCE(ts.triage_priority, 0) >= $3
      ${orderClause}
      LIMIT  $4
      OFFSET $5
      `,
      [submissionTypes, ACTIONABLE_STATUSES as unknown as string[], minPriority, limit, offset],
    ),
    executeQuery<{ count: string }>(
      `
      SELECT COUNT(*) AS count
      FROM submissions s
      LEFT JOIN triage_scores ts ON ts.submission_id = s.id
      WHERE s.submission_type = ANY($1::text[])
        AND s.status          = ANY($2::text[])
        AND COALESCE(ts.triage_priority, 0) >= $3
      `,
      [submissionTypes, ACTIONABLE_STATUSES as unknown as string[], minPriority],
    ),
  ]);

  return {
    entries: dataResult.rows,
    total:   Number(countResult.rows[0]?.count ?? 0),
  };
}

// ============================================================
// TRIAGE SUMMARY (PER-QUEUE COUNTS)
// ============================================================

/**
 * Returns a summary of each queue: total items, high-priority count,
 * critical count, and average priority.
 *
 * Suitable for a dashboard overview panel.
 */
export async function getTriageSummary(): Promise<TriageQueueSummary[]> {
  const results: TriageQueueSummary[] = [];

  for (const queueType of Object.keys(QUEUE_SUBMISSION_TYPES) as QueueType[]) {
    const submissionTypes = QUEUE_SUBMISSION_TYPES[queueType];

    const row = await executeQuery<{
      total:         string;
      high_priority: string;
      critical:      string;
      avg_priority:  string | null;
    }>(
      `
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (
          WHERE COALESCE(ts.triage_priority, 0) >= $3
        )                                                AS high_priority,
        COUNT(*) FILTER (
          WHERE COALESCE(ts.triage_priority, 0) >= $4
        )                                                AS critical,
        AVG(ts.triage_priority)::NUMERIC(5,2)            AS avg_priority
      FROM submissions s
      LEFT JOIN triage_scores ts ON ts.submission_id = s.id
      WHERE s.submission_type = ANY($1::text[])
        AND s.status          = ANY($2::text[])
      `,
      [
        submissionTypes,
        ACTIONABLE_STATUSES as unknown as string[],
        HIGH_PRIORITY_THRESHOLD,
        CRITICAL_PRIORITY_THRESHOLD,
      ],
    );

    const r = row.rows[0];
    results.push({
      queue_type:    queueType,
      label:         QUEUE_TYPE_LABELS[queueType],
      total:         Number(r?.total ?? 0),
      high_priority: Number(r?.high_priority ?? 0),
      critical:      Number(r?.critical ?? 0),
      avg_priority:  r?.avg_priority != null ? Number(r.avg_priority) : null,
    });
  }

  return results;
}

// ============================================================
// GET TRIAGE SCORE FOR A SUBMISSION
// ============================================================

/**
 * Fetch the stored triage score for a single submission.
 * Returns null if no score exists yet.
 */
export async function getTriageScore(submissionId: string): Promise<TriageScore | null> {
  const result = await executeQuery<TriageScore>(
    `SELECT * FROM triage_scores WHERE submission_id = $1`,
    [submissionId],
  );
  return result.rows[0] ?? null;
}
