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
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';
import { isCredentialsAuthEnabled } from '@/lib/auth';

// ============================================================
// REQUEST SCHEMA
// ============================================================

const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username must be 32 characters or fewer')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username may only use letters, numbers, dots, dashes, or underscores')
    .transform((value) => value.trim().toLowerCase()),
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
    .max(32)
    .optional()
    .transform((phone) => {
      const trimmed = phone?.trim();
      if (!trimmed) {
        return null;
      }

      const hasLeadingPlus = trimmed.startsWith('+');
      const digits = trimmed.replace(/\D/g, '');
      if (!digits) {
        return null;
      }

      return hasLeadingPlus ? `+${digits}` : digits;
    })
    .refine((phone) => phone === null || phone.length >= 7, 'Invalid phone number'),
});

// ============================================================
// RATE LIMIT: 5 registrations per IP per window
// ============================================================

const REGISTER_RATE_LIMIT_MAX = 5;

function checkRegisterRateLimit(ip: string) {
  return checkRateLimitShared(`register:ip:${ip}`, {
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
    if (!isCredentialsAuthEnabled()) {
      return NextResponse.json(
        { error: 'Registration is not available.' },
        { status: 403 },
      );
    }

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
    const rateLimit = await checkRegisterRateLimit(ip);
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

    const { username, email, password, displayName, phone } = parsed.data;

    const pool = getPgPool();

    const existing = await pool.query<{
      email_exists: boolean;
      username_exists: boolean;
      phone_exists: boolean;
    }>(
      `SELECT
         EXISTS(SELECT 1 FROM user_profiles WHERE LOWER(COALESCE(email, '')) = $1) AS email_exists,
         EXISTS(SELECT 1 FROM user_profiles WHERE LOWER(COALESCE(username, '')) = $2) AS username_exists,
         EXISTS(
           SELECT 1
           FROM user_profiles
           WHERE $3 IS NOT NULL
             AND regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $3
         ) AS phone_exists`,
      [email, username, phone],
    );
    const duplicate = existing.rows[0];
    if (duplicate?.email_exists) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 },
      );
    }
    if (duplicate?.username_exists) {
      return NextResponse.json(
        { error: 'That username is already taken' },
        { status: 409 },
      );
    }
    if (duplicate?.phone_exists) {
      return NextResponse.json(
        { error: 'An account with this phone number already exists' },
        { status: 409 },
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Generate a stable user ID for credentials users
    const userId = crypto.randomUUID();

    // Create user profile
    await pool.query(
      `INSERT INTO user_profiles (user_id, display_name, username, email, password_hash, phone, auth_provider, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'credentials', 'seeker')`,
      [userId, displayName, username, email, passwordHash, phone],
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
