/**
 * POST /api/chat
 *
 * Chat API handler implementing the retrieval-first pipeline.
 * Crisis detection takes priority over all other processing.
 * No LLM is used in retrieval. LLM summarization only if feature flag enabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ChatRequestSchema } from '@/services/chat/types';
import {
  orchestrateChat,
  checkRateLimit,
} from '@/services/chat/orchestrator';
import { flagService } from '@/services/flags/flags';
import type { EnrichedService } from '@/domain/types';
import type { Intent, ChatContext } from '@/services/chat/types';
import type { SearchQuery } from '@/services/search/types';
import { ServiceSearchEngine } from '@/services/search/engine';
import { executeQuery, executeCount, isDatabaseConfigured } from '@/services/db/postgres';
import { MAX_SERVICES_PER_RESPONSE } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// REQUEST VALIDATION
// ============================================================

const RequestSchema = ChatRequestSchema;

// ============================================================
// DB-BACKED RETRIEVAL
// ============================================================

const engine = new ServiceSearchEngine({ executeQuery, executeCount });

/**
 * Load user profile from database if authenticated.
 * Returns approximateCity if set, null otherwise.
 */
async function loadUserApproximateCity(userId?: string): Promise<string | null> {
  if (!userId || !isDatabaseConfigured()) {
    return null;
  }
  try {
    const rows = await executeQuery<{ approximate_city: string | null }>(
      'SELECT approximate_city FROM user_profiles WHERE user_id = $1',
      [userId]
    );
    return rows[0]?.approximate_city ?? null;
  } catch {
    // Silently ignore profile lookup failures
    return null;
  }
}

/**
 * Maps a chat intent to a SearchQuery and retrieves matching services.
 * Pure SQL — no LLM, no ML. Text search uses the intent's raw query.
 * Uses userProfile.approximateCity for city-biased sorting if available.
 */
async function retrieveServices(
  intent: Intent,
  context: ChatContext,
): Promise<EnrichedService[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  // Load user's approximate city for distance-based sorting bias
  const cityBias = await loadUserApproximateCity(context.userId);

  const query: SearchQuery = {
    text: intent.rawQuery,
    filters: {
      status: 'active',
    },
    pagination: {
      page: 1,
      limit: MAX_SERVICES_PER_RESPONSE,
    },
    // Add city bias if user has set approximate city in their profile
    ...(cityBias && { cityBias }),
  };

  const response = await engine.search(query);
  return response.results.map((r) => r.service);
}

// ============================================================
// HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate request
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { message, sessionId, userId, locale } = parsed.data;

  // Rate limit check (per IP + userId)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimitKey = userId ? `chat:user:${userId}` : `chat:ip:${ip}`;
  const rateLimit = checkRateLimit(rateLimitKey);
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before sending more messages.' },
      { status: 429 }
    );
  }

  try {
    const response = await orchestrateChat(message, sessionId, userId, locale, {
      retrieveServices,
      isFlagEnabled: (flagName) => flagService.isEnabled(flagName),
    });

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, {
      feature: 'api_chat',
      sessionId,
      userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Only POST is supported
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
