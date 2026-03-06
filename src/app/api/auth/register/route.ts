/**
 * POST /api/auth/register
 *
 * Creates a new user account with email + password (credentials provider).
 * Also stores optional phone and display name.
 *
 * After registration, the user signs in via the NextAuth credentials provider.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getPgPool, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// REQUEST SCHEMA
// ============================================================

const RegisterSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .max(255)
    .transform((e) => e.trim().toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100)
    .transform((n) => n.trim()),
  phone: z
    .string()
    .max(20)
    .optional()
    .transform((p) => p?.trim() || null),
});

// ============================================================
// RATE LIMIT: 5 registrations per IP per window
// ============================================================

const REGISTER_RATE_LIMIT_MAX = 5;

function checkRegisterRateLimit(ip: string) {
  return checkRateLimit(`register:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: REGISTER_RATE_LIMIT_MAX,
  });
}

// ============================================================
// BCRYPT COST FACTOR
// ============================================================

const BCRYPT_ROUNDS = 12;

// ============================================================
// POST /api/auth/register
// ============================================================

export async function POST(request: NextRequest) {
  try {
    // Require database
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { error: 'Registration is not available' },
        { status: 503 },
      );
    }

    // Rate limit
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    const rateLimit = checkRegisterRateLimit(ip);
    if (rateLimit.exceeded) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429 },
      );
    }

    // Parse and validate body
    const body: unknown = await request.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { email, password, displayName, phone } = parsed.data;

    const pool = getPgPool();

    // Check if email already exists
    const existing = await pool.query(
      `SELECT 1 FROM user_profiles WHERE email = $1`,
      [email],
    );
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 },
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Generate a stable user ID for credentials users
    const userId = crypto.randomUUID();

    // Create user profile
    await pool.query(
      `INSERT INTO user_profiles (user_id, display_name, email, password_hash, phone, auth_provider, role)
       VALUES ($1, $2, $3, $4, $5, 'credentials', 'seeker')`,
      [userId, displayName, email, passwordHash, phone],
    );

    return NextResponse.json(
      { success: true, message: 'Account created. You can now sign in.' },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_auth_register' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
