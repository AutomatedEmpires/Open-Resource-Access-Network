/**
 * POST /api/feedback
 *
 * Seeker feedback submission endpoint.
 * Stores feedback to inform confidence scoring.
 * No PII collected — comment is optional free text, no identifying info required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import {
  FEATURE_FLAGS,
  FEEDBACK_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';
import { flagService } from '@/services/flags/flags';
import { triageFeedback } from '@/services/feedback/triage';
import { getIp } from '@/services/security/ip';

// ============================================================
// REQUEST SCHEMA
// ============================================================

const FeedbackRequestSchema = z.object({
  serviceId:      z.string().uuid('serviceId must be a valid UUID'),
  sessionId:      z.string().uuid('sessionId must be a valid UUID'),
  rating:         z.number().int().min(1).max(5, 'rating must be between 1 and 5'),
  comment:        z.string().max(1000).optional(),
  contactSuccess: z.boolean().optional(),
}).strict();

type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

// ============================================================
// HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Feedback is temporarily unavailable (database not configured).' },
      { status: 503 },
    );
  }

  const ip = getIp(req);
  const rateLimit = await checkRateLimitShared(`feedback:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: FEEDBACK_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before submitting more feedback.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = FeedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const feedback: FeedbackRequest = parsed.data;

  try {
    const insertResult = await executeQuery<{ id: string }>(
      `INSERT INTO seeker_feedback (service_id, session_id, rating, comment, contact_success)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        feedback.serviceId,
        feedback.sessionId,
        feedback.rating,
        feedback.comment ?? null,
        feedback.contactSuccess ?? null,
      ],
    );

    // Idea 14: fire-and-forget triage — does not delay seeker response
    const rowId = insertResult[0]?.id;
    if (rowId && feedback.comment) {
      flagService.isEnabled(FEATURE_FLAGS.LLM_FEEDBACK_TRIAGE).then((enabled) => {
        if (!enabled) return;
        return triageFeedback(feedback.comment!)
          .then((result) => {
            if (!result) return;
            return executeQuery(
              `UPDATE seeker_feedback SET triage_category = $1, triage_result = $2 WHERE id = $3`,
              [result.category, JSON.stringify(result), rowId],
            );
          });
      }).catch(() => void 0);
    }

    return NextResponse.json({ success: true }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, {
      feature: 'api_feedback',
      sessionId: feedback.sessionId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
