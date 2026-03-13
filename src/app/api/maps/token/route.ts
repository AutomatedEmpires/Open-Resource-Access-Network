/**
 * GET /api/maps/token
 *
 * Server-side token broker for Azure Maps.
 * Returns a scoped SAS token for the web SDK and never exposes the raw
 * Azure Maps shared subscription key to the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitShared } from '@/services/security/rateLimit';

/** 60 requests per 5 minutes per IP — generous but bounded */
const WINDOW_MS = 5 * 60 * 1_000;
const MAX_REQUESTS = 60;

interface MapsClientAuthResponse {
  authType: 'sas';
  sasToken: string;
}

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const rl = await checkRateLimitShared(`maps-token:ip:${ip}`, {
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

  const sasToken = process.env.AZURE_MAPS_SAS_TOKEN?.trim();

  if (!sasToken) {
    return NextResponse.json(
      { error: 'Azure Maps client auth is not configured on the server.' },
      { status: 503 },
    );
  }

  const body: MapsClientAuthResponse = {
    authType: 'sas',
    sasToken,
  };

  return NextResponse.json(
    body,
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
