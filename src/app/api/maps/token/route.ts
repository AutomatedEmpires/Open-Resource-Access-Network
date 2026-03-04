/**
 * GET /api/maps/token
 *
 * Server-side token broker for Azure Maps.
 * Returns the subscription key so it never needs to live in client-side
 * environment variables (NEXT_PUBLIC_*). Rate-limited per IP.
 *
 * Future: swap to Azure AD token exchange for time-limited, scoped tokens.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/services/security/rateLimit';

/** 60 requests per 5 minutes per IP — generous but bounded */
const WINDOW_MS = 5 * 60 * 1_000;
const MAX_REQUESTS = 60;

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const rl = checkRateLimit(`maps-token:ip:${ip}`, {
    windowMs: WINDOW_MS,
    maxRequests: MAX_REQUESTS,
  });

  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before retrying.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  const subscriptionKey = process.env.AZURE_MAPS_KEY;

  if (!subscriptionKey) {
    return NextResponse.json(
      { error: 'Azure Maps is not configured on the server.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { subscriptionKey },
    {
      headers: {
        'Cache-Control': 'private, max-age=300', // cache 5 min in browser
      },
    },
  );
}
