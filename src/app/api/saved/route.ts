/**
 * GET/POST/DELETE /api/saved
 *
 * Saved services management API. Requires authentication.
 * GET returns list of saved service IDs.
 * POST saves a service (idempotent).
 * DELETE removes a saved service (idempotent).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// CONSTANTS
// ============================================================

const SAVED_RATE_LIMIT_MAX = 30;

// ============================================================
// TYPES
// ============================================================

interface SavedServiceRow {
  service_id: string;
}

// ============================================================
// REQUEST SCHEMA
// ============================================================

const ServiceIdSchema = z.object({
  serviceId: z.string().uuid('serviceId must be a valid UUID'),
});

// ============================================================
// RATE LIMIT HELPER
// ============================================================

function checkSavedRateLimit(ip: string) {
  const rateLimit = checkRateLimitShared(`saved:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: SAVED_RATE_LIMIT_MAX,
  });
  return rateLimit;
}

// ============================================================
// GET HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Saved services unavailable.' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = await checkSavedRateLimit(ip);
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  // Authentication required
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const rows = await executeQuery<SavedServiceRow>(
      `SELECT service_id
       FROM saved_services
       WHERE user_id = $1
       ORDER BY saved_at DESC`,
      [authCtx.userId]
    );

    const savedIds = rows.map((row) => row.service_id);
    return NextResponse.json({ savedIds });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_get',
      userId: authCtx.userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Saved services unavailable.' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = await checkSavedRateLimit(ip);
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  // Authentication required
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate request
  const parsed = ServiceIdSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { serviceId } = parsed.data;

  try {
    // Idempotent insert: ON CONFLICT DO NOTHING
    await executeQuery(
      `INSERT INTO saved_services (user_id, service_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, service_id) DO NOTHING`,
      [authCtx.userId, serviceId]
    );

    return NextResponse.json({ saved: true, serviceId });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_post',
      userId: authCtx.userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE HANDLER
// ============================================================

export async function DELETE(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Saved services unavailable.' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = await checkSavedRateLimit(ip);
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  // Authentication required
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate request
  const parsed = ServiceIdSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { serviceId } = parsed.data;

  try {
    // Idempotent delete: no error if row doesn't exist
    await executeQuery(
      `DELETE FROM saved_services
       WHERE user_id = $1 AND service_id = $2`,
      [authCtx.userId, serviceId]
    );

    return NextResponse.json({ removed: true, serviceId });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_delete',
      userId: authCtx.userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
