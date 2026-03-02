/**
 * GET/PUT /api/profile
 *
 * User profile management API. Requires authentication.
 * GET returns the user's profile (or null if none exists).
 * PUT creates/updates profile preferences (approximateCity, preferredLocale only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// CONSTANTS
// ============================================================

const PROFILE_RATE_LIMIT_MAX = 20;

// ============================================================
// TYPES
// ============================================================

interface UserProfileRow {
  user_id: string;
  preferred_locale: string | null;
  approximate_city: string | null;
}

interface ProfileResponse {
  userId: string;
  preferredLocale: string | null;
  approximateCity: string | null;
}

// ============================================================
// REQUEST SCHEMA
// ============================================================

const UpdateProfileSchema = z.object({
  approximateCity: z.string().max(100).optional(),
  preferredLocale: z.string().max(10).optional(),
});

// ============================================================
// RATE LIMIT HELPER
// ============================================================

function checkProfileRateLimit(ip: string): boolean {
  const rateLimit = checkRateLimit(`profile:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: PROFILE_RATE_LIMIT_MAX,
  });
  return rateLimit.exceeded;
}

// ============================================================
// GET HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Profile service is temporarily unavailable.' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (checkProfileRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      { status: 429 }
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
    const rows = await executeQuery<UserProfileRow>(
      `SELECT user_id, preferred_locale, approximate_city
       FROM user_profiles
       WHERE user_id = $1`,
      [authCtx.userId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ profile: null });
    }

    const row = rows[0];
    const profile: ProfileResponse = {
      userId: row.user_id,
      preferredLocale: row.preferred_locale,
      approximateCity: row.approximate_city,
    };

    return NextResponse.json({ profile });
  } catch (error) {
    await captureException(error, {
      feature: 'api_profile_get',
      userId: authCtx.userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================
// PUT HANDLER
// ============================================================

export async function PUT(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Profile service is temporarily unavailable.' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (checkProfileRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      { status: 429 }
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
  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { approximateCity, preferredLocale } = parsed.data;

  try {
    // Upsert profile (INSERT ON CONFLICT UPDATE)
    // Note: role and display_name are NOT settable via this endpoint
    const rows = await executeQuery<UserProfileRow>(
      `INSERT INTO user_profiles (user_id, preferred_locale, approximate_city)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         preferred_locale = COALESCE($2, user_profiles.preferred_locale),
         approximate_city = COALESCE($3, user_profiles.approximate_city),
         updated_at = now()
       RETURNING user_id, preferred_locale, approximate_city`,
      [authCtx.userId, preferredLocale ?? null, approximateCity ?? null]
    );

    const row = rows[0];
    const profile: ProfileResponse = {
      userId: row.user_id,
      preferredLocale: row.preferred_locale,
      approximateCity: row.approximate_city,
    };

    return NextResponse.json({ profile });
  } catch (error) {
    await captureException(error, {
      feature: 'api_profile_put',
      userId: authCtx.userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
