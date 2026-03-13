/**
 * POST /api/submissions/appeal — Submit an appeal on a denied submission.
 *
 * Any authenticated user may appeal a submission they originally submitted,
 * provided the current status is 'denied'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured, executeQuery, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { applySla } from '@/services/workflow/engine';
import {
  RATE_LIMIT_WINDOW_MS,
  USER_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const AppealSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a valid UUID'),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(2000, 'Reason must be at most 2000 characters'),
  evidence: z.array(z.object({
    type: z.string(),
    description: z.string().optional(),
    fileUrl: z.string().url().optional(),
  })).max(10).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// POST — Submit an appeal
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`user:appeal:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: USER_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AppealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { submissionId, reason, evidence } = parsed.data;

  try {
    const result = await withTransaction(async (client) => {
      // Verify the original submission exists, is denied, and belongs to this user
      const original = await client.query<{
        id: string;
        status: string;
        submitted_by_user_id: string;
        submission_type: string;
        target_type: string;
        target_id: string | null;
        service_id: string | null;
        title: string | null;
      }>(
        `SELECT id, status, submitted_by_user_id, submission_type,
                target_type, target_id, service_id, title
         FROM submissions
         WHERE id = $1
         FOR SHARE`,
        [submissionId],
      );

      if (original.rows.length === 0) {
        return { error: 'Submission not found', status: 404 };
      }

      const sub = original.rows[0];

      if (sub.submitted_by_user_id !== authCtx.userId) {
        return { error: 'You may only appeal your own submissions', status: 403 };
      }

      if (sub.status !== 'denied') {
        return { error: 'Only denied submissions may be appealed', status: 409 };
      }

      // Check for existing pending appeal on the same submission
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM submissions
         WHERE submission_type = 'appeal'
           AND payload->>'original_submission_id' = $1
           AND status NOT IN ('denied', 'withdrawn', 'archived')
         LIMIT 1`,
        [submissionId],
      );

      if (existing.rows.length > 0) {
        return { error: 'An appeal is already pending for this submission', status: 409 };
      }

      // Create the appeal submission
      const appeal = await client.query<{ id: string }>(
        `INSERT INTO submissions
           (submission_type, status, target_type, target_id, service_id,
            submitted_by_user_id, title, notes, payload, evidence, priority)
         VALUES ('appeal', 'submitted', $1, $2, $3, $4, $5, $6, $7, $8, 1)
         RETURNING id`,
        [
          sub.target_type,
          sub.target_id,
          sub.service_id,
          authCtx.userId,
          `Appeal: ${sub.title ?? sub.submission_type}`,
          reason,
          JSON.stringify({
            original_submission_id: submissionId,
            original_submission_type: sub.submission_type,
          }),
          JSON.stringify(evidence ?? []),
        ],
      );

      const appealId = appeal.rows[0].id;

      // Record the transition
      await client.query(
        `INSERT INTO submission_transitions
           (submission_id, from_status, to_status, actor_user_id, actor_role,
            reason, gates_checked, gates_passed, metadata)
         VALUES ($1, 'draft', 'submitted', $2, $3, $4, '[]', true, $5)`,
        [
          appealId,
          authCtx.userId,
          authCtx.role,
          'Appeal submitted',
          JSON.stringify({ original_submission_id: submissionId }),
        ],
      );

      // Notify the original reviewer if the original submission had one assigned
      const assignee = await client.query<{ assigned_to_user_id: string }>(
        `SELECT assigned_to_user_id FROM submissions WHERE id = $1 AND assigned_to_user_id IS NOT NULL`,
        [submissionId],
      );

      if (assignee.rows.length > 0 && assignee.rows[0].assigned_to_user_id) {
        await client.query(
          `INSERT INTO notification_events
             (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
           VALUES ($1, 'submission_status_changed', $2, $3, 'submission', $4, $5, $6)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            assignee.rows[0].assigned_to_user_id,
            'Appeal filed on your decision',
            `User has appealed submission ${submissionId.slice(0, 8)}…`,
            appealId,
            `/appeals?id=${appealId}`,
            `appeal_filed_${appealId}`,
          ],
        );
      }

      // Notify admin pool so the appeal is not invisible
      await client.query(
        `INSERT INTO notification_events
           (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
         SELECT up.user_id,
                'submission_status_changed',
                'New appeal submitted',
                $2,
                'submission',
                $1,
                '/appeals',
                'new_appeal_' || $1 || '_' || up.user_id
         FROM user_profiles up
         WHERE up.role IN ('community_admin', 'oran_admin')
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          appealId,
          `Appeal filed on submission ${submissionId.slice(0, 8)}…`,
        ],
      );

      return { appealId, status: 201 };
    });

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    // Apply SLA deadline for the new appeal
    try {
      await applySla(result.appealId, 'appeal');
    } catch {
      // SLA is best-effort — don't fail the submission
    }

    return NextResponse.json(
      { appealId: result.appealId, message: 'Appeal submitted successfully' },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_submissions_appeal' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// GET — List appeals for the current user
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`user:appeal:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: 60,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const appeals = await executeQuery<{
      id: string;
      status: string;
      title: string | null;
      notes: string | null;
      reviewer_notes: string | null;
      created_at: string;
      updated_at: string;
      original_submission_id: string | null;
    }>(
      `SELECT s.id, s.status, s.title, s.notes, s.reviewer_notes,
              s.created_at, s.updated_at,
              s.payload->>'original_submission_id' AS original_submission_id
       FROM submissions s
       WHERE s.submission_type = 'appeal'
         AND s.submitted_by_user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [authCtx.userId],
    );

    return NextResponse.json(
      { appeals },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_submissions_appeal_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
