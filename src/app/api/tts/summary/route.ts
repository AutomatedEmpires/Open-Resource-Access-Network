/**
 * POST /api/tts/summary
 *
 * Synthesize a short text summary to MP3 speech using Azure Cognitive Services Speech.
 * Returns binary audio bytes with Content-Type: audio/mpeg.
 *
 * Gated by:
 * - Authentication (any authenticated user)
 * - Feature flag: tts_summaries
 * - Azure Speech env vars: AZURE_SPEECH_KEY + AZURE_SPEECH_REGION
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { flagService } from '@/services/flags/flags';
import { FEATURE_FLAGS, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { checkRateLimit } from '@/services/security/rateLimit';
import { synthesizeSpeech, isConfigured } from '@/services/tts/azureSpeech';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// VALIDATION
// ============================================================

const BodySchema = z.object({
  /** Text to synthesize. Max 2000 characters (hard-capped in the TTS service). */
  text: z.string().min(1).max(2000),
  /** BCP-47 locale code (e.g. 'en', 'es', 'zh'). Defaults to 'en'. */
  locale: z.string().default('en'),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  // Rate-limit per user (falls back to IP for anonymous edge cases).
  const rlKey = `tts:${authCtx.userId ?? getIp(req)}`;
  const rl = checkRateLimit(rlKey, {
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  // Feature flag gate.
  const ttsEnabled = await flagService.isEnabled(FEATURE_FLAGS.TTS_SUMMARIES);
  if (!ttsEnabled) {
    return NextResponse.json({ error: 'TTS feature not enabled.' }, { status: 403 });
  }

  // Service-level config check.
  if (!isConfigured()) {
    return NextResponse.json({ error: 'TTS service not configured.' }, { status: 503 });
  }

  // Body validation.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { text, locale } = parsed.data;

  try {
    const audio = await synthesizeSpeech(text, { locale });
    if (!audio) {
      return NextResponse.json({ error: 'Speech synthesis failed.' }, { status: 502 });
    }
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    await captureException(err, { feature: 'api_tts_summary', userId: authCtx.userId });
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// Only POST is supported.
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed.' }, { status: 405 });
}
