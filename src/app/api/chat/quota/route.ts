/**
 * GET /api/chat/quota
 *
 * Returns the current 24-hour quota state for the calling identity.
 * Reads the `oran-did` HttpOnly cookie (device fingerprint) and the
 * authenticated user session (if present).
 *
 * Response: { remaining: number; resetAt: string | null }
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthContext } from '@/services/auth/session';
import { checkQuotaByIdentity } from '@/services/chat/quota';
import { MAX_CHAT_QUOTA, CHAT_DEVICE_COOKIE, RATE_LIMIT_WINDOW_MS, SEARCH_RATE_LIMIT_MAX_REQUESTS } from '@/domain/constants';
import { checkRateLimit } from '@/services/security/rateLimit';
import { getIp } from '@/services/security/ip';

export async function GET(req: NextRequest) {
  const ip = getIp(req);
  const rl = checkRateLimit(`chat:quota:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: SEARCH_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

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
