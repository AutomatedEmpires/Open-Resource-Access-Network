/**
 * GET /api/chat/quota
 *
 * Returns the current 24-hour quota state for the calling identity.
 * Reads the `oran-did` HttpOnly cookie (device fingerprint) and the
 * authenticated user session (if present).
 *
 * Response: { remaining: number; resetAt: string | null }
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthContext } from '@/services/auth/session';
import { checkQuotaByIdentity } from '@/services/chat/quota';
import { MAX_CHAT_QUOTA, CHAT_DEVICE_COOKIE } from '@/domain/constants';

export async function GET() {
  const cookieStore = await cookies();
  const deviceId = cookieStore.get(CHAT_DEVICE_COOKIE)?.value;

  const authCtx = await getAuthContext();
  const userId = authCtx?.userId;

  if (!deviceId && !userId) {
    // No identity established yet — return full quota (first visit)
    return NextResponse.json(
      { remaining: MAX_CHAT_QUOTA, resetAt: null },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const quota = await checkQuotaByIdentity(deviceId, userId);

  return NextResponse.json(
    {
      remaining: quota.remaining,
      resetAt: quota.resetAt?.toISOString() ?? null,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
