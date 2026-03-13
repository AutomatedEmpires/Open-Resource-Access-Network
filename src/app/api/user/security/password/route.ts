import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { getPgPool, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isCredentialsAuthEnabled } from '@/lib/auth';

const UpdatePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const PASSWORD_RATE_LIMIT_MAX = 10;
const BCRYPT_ROUNDS = 12;

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  if (!isCredentialsAuthEnabled()) {
    return NextResponse.json(
      { error: 'Password changes are not available.' },
      { status: 403 },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Security settings are temporarily unavailable.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(`user:password:${getIp(req)}`, {
    windowMs: 600_000,
    maxRequests: PASSWORD_RATE_LIMIT_MAX,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Too many password change attempts. Please wait before trying again.' },
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

  const parsed = UpdatePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: 'New password must be different from your current password.' }, { status: 400 });
  }

  try {
    const pool = getPgPool();
    const result = await pool.query<{
      auth_provider: string | null;
      password_hash: string | null;
    }>(
      `SELECT auth_provider, password_hash
         FROM user_profiles
        WHERE user_id = $1`,
      [authCtx.userId],
    );

    const user = result.rows[0];
    if (!user) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (user.auth_provider !== 'credentials' || !user.password_hash) {
      return NextResponse.json(
        { error: 'Password changes are only available for email/password accounts.' },
        { status: 400 },
      );
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }

    const nextHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query(
      `UPDATE user_profiles
          SET password_hash = $2,
              updated_at = now(),
              updated_by_user_id = $1
        WHERE user_id = $1`,
      [authCtx.userId, nextHash],
    );

    return NextResponse.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    await captureException(error, { feature: 'api_user_security_password', userId: authCtx.userId });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
