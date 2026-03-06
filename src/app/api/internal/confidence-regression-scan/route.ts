/**
 * POST /api/internal/confidence-regression-scan
 *
 * Internal endpoint intended to be called by an Azure Functions timer.
 * Scans for a simple regression signal:
 *  - service has a "verified" confidence score (score >= 80)
 *  - service.updated_at is newer than confidence_scores.computed_at
 *
 * For each match, creates a deduped `confidence_regression` submission in the
 * universal pipeline and notifies the admin pool.
 *
 * Protected by `INTERNAL_API_KEY` (shared secret). Not accessible to end users.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

type ScanResult = {
  createdCount: number;
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
    const result = await withTransaction(async (client) => {
      const createdRows = await client.query<{ created_count: number }>(
        `WITH candidates AS (
           SELECT s.id AS service_id,
                  s.name AS service_name,
                  cs.score AS previous_score,
                  cs.computed_at AS previous_computed_at,
                  s.updated_at AS service_updated_at
           FROM services s
           JOIN confidence_scores cs ON cs.service_id = s.id
           WHERE cs.score >= 80
             AND s.updated_at > cs.computed_at
             AND NOT EXISTS (
               SELECT 1
               FROM submissions sub
               WHERE sub.service_id = s.id
                 AND sub.submission_type = 'confidence_regression'
                 AND sub.status NOT IN ('approved', 'denied', 'withdrawn', 'archived')
             )
           ORDER BY s.updated_at DESC
           LIMIT $1
         ),
         inserted AS (
           INSERT INTO submissions
             (submission_type, status, service_id, target_type, target_id,
              payload, submitted_by_user_id, title, notes, submitted_at)
           SELECT
             'confidence_regression',
             'submitted',
             c.service_id,
             'service',
             c.service_id,
             jsonb_build_object(
               'reason', 'service_updated_after_verification',
               'previousScore', c.previous_score,
               'previousComputedAt', c.previous_computed_at,
               'serviceUpdatedAt', c.service_updated_at
             ),
             'system',
             'Confidence regression: ' || c.service_name,
             'Auto-flagged: service changed after last confidence computation; re-review suggested.',
             NOW()
           FROM candidates c
           RETURNING id, service_id
         ),
         transitioned AS (
           INSERT INTO submission_transitions
             (submission_id, from_status, to_status, actor_user_id, actor_role,
              reason, gates_checked, gates_passed)
           SELECT
             i.id,
             'draft',
             'submitted',
             'system',
             'system',
             'Auto-flagged: service updated after verification',
             '[]',
             true
           FROM inserted i
           RETURNING submission_id
         ),
         notified AS (
           INSERT INTO notification_events
             (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
           SELECT
             up.user_id,
             'submission_status_changed',
             'Confidence regression flagged',
             'A verified service changed and may need re-review.',
             'submission',
             i.id,
             '/verify?id=' || i.id,
             'confidence_regression_' || i.id || '_' || up.user_id
           FROM inserted i
           JOIN user_profiles up ON up.role IN ('community_admin', 'oran_admin')
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING 1
         )
         SELECT count(*)::int AS created_count FROM inserted;`,
        [limit],
      );

      const createdCount = createdRows.rows[0]?.created_count ?? 0;
      const res: ScanResult = { createdCount };
      return res;
    });

    return NextResponse.json(
      {
        success: true,
        createdCount: result.createdCount,
        checkedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    await captureException(error, { feature: 'confidence_regression_scan' });
    return NextResponse.json({ error: 'Regression scan failed' }, { status: 500 });
  }
}
