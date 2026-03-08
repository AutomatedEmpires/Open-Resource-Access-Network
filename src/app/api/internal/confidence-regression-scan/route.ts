/**
 * POST /api/internal/confidence-regression-scan
 *
 * Internal endpoint called by an Azure Functions timer trigger every 6 hours.
 * Detects trust-signal regressions across four signals:
 *   1. service_updated_after_verification — service data changed after score computed
 *   2. feedback_severity — repeated negative seeker feedback or community reports
 *   3. score_staleness — confidence score not recomputed in 90+ days
 *   4. score_degraded — active service has RED-tier score (< 40)
 *
 * For each newly detected (deduplicated) regression, creates:
 *   - A `confidence_regressions` audit row (72-hour dedup + open-submission guard)
 *   - A `confidence_regression` submission routed into the admin pipeline
 *   - In-app notifications for all community_admin / oran_admin users
 *   - Visibility suppression (`services.status = 'inactive'`) for candidates
 *     whose policy action is `suppress`
 *
 * Architecture:
 *   - Detection phase runs OUTSIDE the transaction against the pool directly.
 *     Each signal query runs on its own connection, enabling real parallelism.
 *   - Write phase opens a single short transaction for the inserts plus
 *     any required visibility suppression updates.
 *   - Insert writes use UNNEST batch inserts — O(1) queries regardless of
 *     candidate count.
 *
 * Protected by `INTERNAL_API_KEY` (shared secret). Not accessible to end users.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { isDatabaseConfigured, getPgPool, withTransaction } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';
import { detectRegressions } from '@/services/regression/detector';
import type { RegressionCandidate } from '@/services/regression/detector';
import { applyRegressionVisibilityPolicies } from '@/services/regression/policy';

type ScanResult = {
  createdCount: number;
  suppressedCount: number;
};

const DEFAULT_LIMIT = 100;

export async function POST(req: NextRequest) {
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Internal API not configured' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // body is optional; ignore parse errors
  }

  const limit = (() => {
    if (typeof body !== 'object' || body === null) return DEFAULT_LIMIT;
    const record = body as Record<string, unknown>;
    const rawLimit = record['limit'];
    if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) return DEFAULT_LIMIT;
    return Math.max(1, Math.min(DEFAULT_LIMIT, rawLimit));
  })();

  try {
    // Detection phase — read-only, runs outside the transaction so each signal
    // query uses its own pool connection (real parallelism via Promise.all).
    const pool = getPgPool();
    const candidates = await detectRegressions(pool, limit);

    // Write phase — short transaction only for the batch inserts.
    const result = await withTransaction(async (client) => {
      const createdCount = await persistRegressions(client, candidates);
      const policySummary = await applyRegressionVisibilityPolicies(client, candidates);
      const res: ScanResult = {
        createdCount,
        suppressedCount: policySummary.suppressedCount,
      };
      return res;
    });

    return NextResponse.json(
      {
        success: true,
        createdCount: result.createdCount,
        suppressedCount: result.suppressedCount,
        checkedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    await captureException(error, { feature: 'confidence_regression_scan' });
    return NextResponse.json({ error: 'Regression scan failed' }, { status: 500 });
  }
}

// ============================================================
// BATCH PERSISTENCE (private to this route)
// ============================================================

/**
 * Persist newly detected regression candidates in three batched steps.
 *
 * Query budget: exactly 5 insert/dedup queries regardless of candidate count.
 *   1. Dedup check — filter keys already in the 72-hour window
 *   2. Batch INSERT confidence_regressions (ON CONFLICT handles concurrent races)
 *   3. Batch INSERT submissions (admin tasks)
 *   4. Batch INSERT submission_transitions
 *   5. Batch INSERT notification_events (fan-out via CROSS JOIN)
 *
 * Pre-generated UUIDs eliminate the UPDATE round-trip that would otherwise
 * be needed to back-link regression ↔ submission.
 */
async function persistRegressions(
  client: PoolClient,
  candidates: RegressionCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;

  // 1. Filter out candidates already in the current 72-hour dedup window.
  const dedupeKeys = candidates.map((c) => c.dedupeKey);
  const existing = await client.query<{ dedupe_key: string }>(
    `SELECT dedupe_key FROM confidence_regressions WHERE dedupe_key = ANY($1::text[])`,
    [dedupeKeys],
  );
  const existingKeys = new Set(existing.rows.map((r) => r.dedupe_key));

  // Pre-generate UUIDs so regression and submission IDs are known before any INSERT.
  // This avoids a two-step INSERT+UPDATE back-link pattern.
  const pairs = candidates
    .filter((c) => !existingKeys.has(c.dedupeKey))
    .map((candidate) => ({
      candidate,
      regressionId: randomUUID(),
      submissionId: randomUUID(),
    }));

  if (pairs.length === 0) return 0;

  // 2. Batch INSERT confidence_regressions.
  //    ON CONFLICT DO NOTHING handles the rare concurrent-scan race where another
  //    worker inserted the same dedup key between steps 1 and 2.
  const regResult = await client.query<{ id: string }>(
    `INSERT INTO confidence_regressions
       (id, entity_type, entity_id, signal_type, current_score, current_band,
        reasons_json, status, dedupe_key, submission_id)
     SELECT
       t.regression_id, 'service', t.service_id, t.signal_type,
       t.score::numeric, t.band, t.reasons::jsonb, 'open', t.dedupe_key, t.submission_id
     FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::numeric[], $5::text[],
                 $6::text[], $7::text[], $8::uuid[])
       AS t(regression_id, service_id, signal_type, score, band,
            reasons, dedupe_key, submission_id)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      pairs.map((p) => p.regressionId),
      pairs.map((p) => p.candidate.serviceId),
      pairs.map((p) => p.candidate.signalType),
      pairs.map((p) => p.candidate.currentScore),
      pairs.map((p) => p.candidate.currentBand),
      pairs.map((p) => JSON.stringify(p.candidate.reasons)),
      pairs.map((p) => p.candidate.dedupeKey),
      pairs.map((p) => p.submissionId),
    ],
  );

  // Filter to only the pairs that were actually inserted (not blocked by conflict).
  const insertedIds = new Set(regResult.rows.map((r) => r.id));
  const actualPairs = pairs.filter((p) => insertedIds.has(p.regressionId));
  if (actualPairs.length === 0) return 0;

  // 3. Batch INSERT submissions (admin tasks, one per regression).
  await client.query(
    `INSERT INTO submissions
       (id, submission_type, status, service_id, target_type, target_id,
        payload, submitted_by_user_id, title, notes, submitted_at)
     SELECT
       t.submission_id, 'confidence_regression', 'submitted', t.service_id,
       'service', t.service_id, t.payload::jsonb, 'system', t.title, t.notes, NOW()
     FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[])
       AS t(submission_id, service_id, payload, title, notes)`,
    [
      actualPairs.map((p) => p.submissionId),
      actualPairs.map((p) => p.candidate.serviceId),
      actualPairs.map((p) =>
        JSON.stringify({
          regressionId: p.regressionId,
          signalType: p.candidate.signalType,
          reasons: p.candidate.reasons,
          currentScore: p.candidate.currentScore,
        }),
      ),
      actualPairs.map((p) => `Confidence regression: ${p.candidate.serviceName}`),
      actualPairs.map((p) => p.candidate.notesText),
    ],
  );

  // 4. Batch INSERT submission transitions.
  await client.query(
    `INSERT INTO submission_transitions
       (submission_id, from_status, to_status, actor_user_id, actor_role,
        reason, gates_checked, gates_passed)
     SELECT
       t.submission_id, 'draft', 'submitted', 'system', 'system',
       t.reason, '[]'::jsonb, true
     FROM unnest($1::uuid[], $2::text[]) AS t(submission_id, reason)`,
    [
      actualPairs.map((p) => p.submissionId),
      actualPairs.map((p) => `Auto-flagged: ${p.candidate.signalType}`),
    ],
  );

  // 5. Batch INSERT in-app notifications — fan-out to all admin users in one query.
  await client.query(
    `INSERT INTO notification_events
       (recipient_user_id, event_type, title, body, resource_type,
        resource_id, action_url, idempotency_key)
     SELECT
       up.user_id,
       'submission_status_changed',
       'Confidence regression flagged',
       t.notes_text,
       'submission',
       t.submission_id,
       '/verify?id=' || t.submission_id,
       'confidence_regression_' || t.submission_id || '_' || up.user_id
     FROM unnest($1::uuid[], $2::text[]) AS t(submission_id, notes_text)
     CROSS JOIN user_profiles up
     WHERE up.role IN ('community_admin', 'oran_admin')
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      actualPairs.map((p) => p.submissionId),
      actualPairs.map((p) => p.candidate.notesText),
    ],
  );

  return actualPairs.length;
}
