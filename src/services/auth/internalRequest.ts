import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

type InternalRequest = {
  headers: Pick<Headers, 'get'>;
};

type InternalAuthMethod = 'vercel_cron' | 'internal_header';

type InternalAuthEnvironment = {
  CRON_SECRET?: string;
  INTERNAL_API_KEY?: string;
};

export type InternalRequestAuthorization =
  | { ok: true; method: InternalAuthMethod }
  | { ok: false; reason: 'not_configured' | 'unauthorized' };

function secretsMatch(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return candidateBuffer.length === expectedBuffer.length
    && timingSafeEqual(candidateBuffer, expectedBuffer);
}

/**
 * Authenticate an ORAN-only scheduled or internal worker request.
 *
 * Vercel Cron sends CRON_SECRET as a Bearer token. INTERNAL_API_KEY remains a
 * separate internal credential and is accepted only through
 * x-oran-internal-key. Bearer authentication is reserved for Vercel Cron.
 */
export function authorizeInternalRequest(
  request: InternalRequest,
  env: InternalAuthEnvironment = {
    CRON_SECRET: process.env.CRON_SECRET,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  },
): InternalRequestAuthorization {
  const cronSecret = env.CRON_SECRET;
  const internalApiKey = env.INTERNAL_API_KEY;

  if (!cronSecret && !internalApiKey) {
    return { ok: false, reason: 'not_configured' };
  }

  const authorization = request.headers.get('authorization') ?? '';
  const internalHeader = request.headers.get('x-oran-internal-key') ?? '';

  if (cronSecret && secretsMatch(authorization, `Bearer ${cronSecret}`)) {
    return { ok: true, method: 'vercel_cron' };
  }

  if (internalApiKey && secretsMatch(internalHeader, internalApiKey)) {
    return { ok: true, method: 'internal_header' };
  }

  return { ok: false, reason: 'unauthorized' };
}

export function rejectUnauthorizedInternalRequest(
  request: InternalRequest,
): NextResponse | null {
  const authorization = authorizeInternalRequest(request);
  if (authorization.ok) return null;

  if (authorization.reason === 'not_configured') {
    return NextResponse.json(
      { error: 'Internal API not configured' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 },
  );
}
