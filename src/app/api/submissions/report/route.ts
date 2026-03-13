/**
 * POST /api/submissions/report — Report incorrect or fraudulent listing info.
 * GET  /api/submissions/report — List current user's reports.
 *
 * Any authenticated user (or anonymous seeker with rate limiting) may report
 * a service listing that appears incorrect, closed, or fraudulent.
 * Creates a 'community_report' submission in the universal pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured, executeQuery, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { applySla } from '@/services/workflow/engine';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const REPORT_REASONS = [
  'incorrect_info',
  'permanently_closed',
  'temporarily_closed',
  'wrong_location',
  'wrong_phone',
  'wrong_hours',
  'wrong_eligibility',
  'suspected_fraud',
  'duplicate_listing',
  'other',
] as const;

const ReportSchema = z.object({
  serviceId: z.string().uuid('serviceId must be a valid UUID'),
  reason: z.enum(REPORT_REASONS),
  details: z.string().min(5, 'Details must be at least 5 characters').max(2000, 'Details must be at most 2000 characters'),
  contactEmail: z.string().email().optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// POST — Submit a listing report
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`report:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: 10, // Restrictive to prevent abuse
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  // Auth is optional — anonymous users can report, but authenticated reports are prioritized
  const authCtx = await getAuthContext();
  const userId = authCtx?.userId ?? `anon_${ip}`;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { serviceId, reason, details, contactEmail } = parsed.data;

  try {
    const result = await withTransaction(async (client) => {
      // Verify the service exists
      const service = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM services WHERE id = $1`,
        [serviceId],
      );

      if (service.rows.length === 0) {
        return { error: 'Service not found', status: 404 };
      }

      const serviceName = service.rows[0].name;

      // Check for duplicate recent report by same user on same service
      const duplicate = await client.query<{ id: string }>(
        `SELECT id FROM submissions
         WHERE submission_type = 'community_report'
           AND submitted_by_user_id = $1
           AND service_id = $2
           AND status NOT IN ('denied', 'withdrawn', 'archived')
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [userId, serviceId],
      );

      if (duplicate.rows.length > 0) {
        return { error: 'You have already reported this listing recently', status: 409 };
      }

      // Create the report submission
      const report = await client.query<{ id: string }>(
        `INSERT INTO submissions
           (submission_type, status, target_type, target_id, service_id,
            submitted_by_user_id, title, notes, payload, priority)
         VALUES ('community_report', 'submitted', 'service', $1, $1, $2, $3, $4, $5,
                 CASE WHEN $6 = 'suspected_fraud' THEN 2 ELSE 0 END)
         RETURNING id`,
        [
          serviceId,
          userId,
          `Report: ${reason.replace(/_/g, ' ')} — ${serviceName}`,
          details,
          JSON.stringify({
            reason,
            details,
            contact_email: contactEmail ?? null,
            reported_service_name: serviceName,
            reporter_authenticated: authCtx !== null,
          }),
          reason,
        ],
      );

      const reportId = report.rows[0].id;

      // Record the transition
      await client.query(
        `INSERT INTO submission_transitions
           (submission_id, from_status, to_status, actor_user_id, actor_role,
            reason, gates_checked, gates_passed, metadata)
         VALUES ($1, 'draft', 'submitted', $2, $3, $4, '[]', true, $5)`,
        [
          reportId,
          userId,
          authCtx?.role ?? 'seeker',
          `Community report: ${reason}`,
          JSON.stringify({ service_id: serviceId, reason }),
        ],
      );

      // Notify admin pool of new report
      await client.query(
        `INSERT INTO notification_events
           (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
         SELECT up.user_id,
                'submission_status_changed',
                'New community report submitted',
                $2,
                'submission',
                $1,
            '/verify?id=' || $1,
                'new_report_' || $1 || '_' || up.user_id
         FROM user_profiles up
         WHERE up.role IN ('community_admin', 'oran_admin')
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          reportId,
          `Report: ${reason.replace(/_/g, ' ')} — ${serviceName}`,
        ],
      );

      return { reportId, status: 201 };
    });

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    // Apply SLA deadline for the new report
    try {
      await applySla(result.reportId, 'community_report');
    } catch {
      // SLA is best-effort — don't fail the submission
    }

    return NextResponse.json(
      { reportId: result.reportId, message: 'Report submitted. Thank you for helping keep listings accurate.' },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_submissions_report' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// GET — List reports by the current user
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`report:read:${ip}`, {
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
    const reports = await executeQuery<{
      id: string;
      status: string;
      title: string | null;
      notes: string | null;
      reviewer_notes: string | null;
      created_at: string;
      updated_at: string;
      service_id: string | null;
      reason: string | null;
    }>(
      `SELECT s.id, s.status, s.title, s.notes, s.reviewer_notes,
              s.created_at, s.updated_at, s.service_id,
              s.payload->>'reason' AS reason
       FROM submissions s
       WHERE s.submission_type = 'community_report'
         AND s.submitted_by_user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [authCtx.userId],
    );

    return NextResponse.json(
      { reports },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_submissions_report_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
