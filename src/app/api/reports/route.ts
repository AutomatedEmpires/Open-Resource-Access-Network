/**
 * POST /api/reports
 *
 * @deprecated Use POST /api/submissions/report instead.
 * This legacy endpoint is retained for backward compatibility but is
 * no longer called by any UI component as of 2026-03-05.
 * Archived copy: docs/_archive/2026-03/legacy-api/reports_route.ts
 *
 * Seeker-facing endpoint to report a problem with a service listing.
 * Creates a submission (community_report) in the universal pipeline
 * AND stores an audit_logs entry for backward compatibility.
 * No PII collected — anonymous reporting by default.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';
import { applySla } from '@/services/workflow/engine';

// ============================================================
// REQUEST SCHEMA
// ============================================================

const ISSUE_TYPES = [
  'wrong_info',
  'closed_permanently',
  'wrong_hours',
  'wrong_address',
  'wrong_phone',
  'not_free',
  'safety_concern',
  'duplicate',
  'other',
] as const;

const ReportRequestSchema = z.object({
  serviceId: z.string().uuid('serviceId must be a valid UUID'),
  issueType: z.enum(ISSUE_TYPES, { message: 'Invalid issue type' }),
  comment:   z.string().max(2000, 'Comment must be 2000 characters or fewer').optional(),
});

// ============================================================
// RATE LIMIT
// ============================================================

const REPORT_RATE_LIMIT_MAX = 5;

// ============================================================
// HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Reporting is temporarily unavailable.' },
      { status: 503 },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = await checkRateLimitShared(`report:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: REPORT_RATE_LIMIT_MAX,
  });
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Too many reports submitted. Please wait before reporting again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ReportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { serviceId, issueType, comment } = parsed.data;

  try {
    const submissionId = await withTransaction(async (client) => {
      // 1. Create submission in the universal pipeline
      const submissionResult = await client.query<{ id: string }>(
        `INSERT INTO submissions
           (submission_type, status, service_id, target_type, target_id,
            payload, submitted_by_user_id)
         VALUES ('community_report', 'submitted', $1, 'service', $1, $2, $3)
         RETURNING id`,
        [
          serviceId,
          JSON.stringify({ issueType, comment: comment ?? null }),
          `anon_${ip}`,
        ],
      );

      const newId = submissionResult.rows[0]?.id;

      // 2. Record initial transition
      if (newId) {
        await client.query(
          `INSERT INTO submission_transitions
             (submission_id, from_status, to_status, actor_user_id, actor_role,
              reason, gates_checked, gates_passed)
           VALUES ($1, 'draft', 'submitted', NULL, 'anonymous', $2, '[]', true)`,
          [newId, `Report: ${issueType}`],
        );
      }

      // 3. Backward-compatible audit trail entry
      await client.query(
        `INSERT INTO audit_logs (action, resource_type, resource_id, after, actor_user_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          'service_reported',
          'service',
          serviceId,
          JSON.stringify({ issueType, comment: comment ?? null, submissionId: newId }),
          null,
        ],
      );

      return newId;
    });

    // 4. Apply SLA deadline (outside transaction — non-critical)
    if (submissionId) {
      try {
        await applySla(submissionId, 'community_report');
      } catch {
        // SLA application is best-effort; don't fail the report
      }
    }

    return NextResponse.json(
      { message: 'Thank you for your report. Our team will review it.', submissionId },
      { status: 201 },
    );
  } catch (err) {
    captureException(err);
    return NextResponse.json(
      { error: 'Failed to submit report. Please try again.' },
      { status: 500 },
    );
  }
}
