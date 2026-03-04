/**
 * POST /api/feedback
 *
 * Seeker feedback submission endpoint.
 * Stores feedback to inform confidence scoring.
 * No PII collected — comment is optional free text, no identifying info required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/services/security/rateLimit';
import { FEEDBACK_RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// REQUEST SCHEMA
// ============================================================

const FeedbackRequestSchema = z.object({
  serviceId:      z.string().uuid('serviceId must be a valid UUID'),
  sessionId:      z.string().uuid('sessionId must be a valid UUID'),
  rating:         z.number().int().min(1).max(5, 'rating must be between 1 and 5'),
  comment:        z.string().max(1000).optional(),
  contactSuccess: z.boolean().optional(),
});

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

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = checkRateLimit(`feedback:ip:${ip}`, {
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
    await executeQuery(
      `INSERT INTO seeker_feedback (service_id, session_id, rating, comment, contact_success)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        feedback.serviceId,
        feedback.sessionId,
        feedback.rating,
        feedback.comment ?? null,
        feedback.contactSuccess ?? null,
      ],
    );

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
