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

// ============================================================
// REQUEST VALIDATION
// ============================================================

const RequestSchema = ChatRequestSchema;

// ============================================================
// MOCK RETRIEVAL (replace with real DB query in production)
// ============================================================

async function retrieveServices(): Promise<EnrichedService[]> {
  // In production: call ServiceSearchEngine with intent-derived filters
  // Pure SQL — no LLM
  return [];
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

  const { message, sessionId, userId } = parsed.data;

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
    const response = await orchestrateChat(message, sessionId, userId, {
      retrieveServices,
      isFlagEnabled: (flagName) => flagService.isEnabled(flagName),
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[/api/chat] Orchestrator error:', error);
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
