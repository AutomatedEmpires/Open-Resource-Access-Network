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
  ChatRateLimitExceededError,
} from '@/services/chat/orchestrator';
import { flagService } from '@/services/flags/flags';
import { summarizeWithLLM } from '@/services/chat/llm';
import { enrichIntent } from '@/services/chat/intentEnrich';
import { translateBatch, isConfigured as isTranslatorConfigured } from '@/services/i18n/translator';
import { SUPPORTED_LOCALES } from '@/services/i18n/i18n';
import type { LocaleCode } from '@/services/i18n/i18n';
import type { EnrichedService } from '@/domain/types';
import type { Intent, ChatContext } from '@/services/chat/types';
import type { SearchQuery } from '@/services/search/types';
import { ServiceSearchEngine } from '@/services/search/engine';
import { cachedSearch } from '@/services/search/cache';
import { executeQuery, executeCount, isDatabaseConfigured } from '@/services/db/postgres';
import { MAX_SERVICES_PER_RESPONSE, FEATURE_FLAGS } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';

// ============================================================
// REQUEST VALIDATION
// ============================================================

const RequestSchema = ChatRequestSchema;

// ============================================================
// DB-BACKED RETRIEVAL
// ============================================================

const engine = new ServiceSearchEngine({ executeQuery, executeCount });

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

  const { message, sessionId, locale, filters } = parsed.data;

  const authCtx = await getAuthContext();
  const effectiveUserId = authCtx?.userId;

  // Rate limit key is derived server-side (per IP + optional user)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimitKey = effectiveUserId ? `chat:user:${effectiveUserId}` : `chat:ip:${ip}`;

  /**
   * Maps a chat intent to a SearchQuery and retrieves matching services.
   * Pure SQL — no LLM, no ML. Text search uses the intent's raw query.
   * Uses the same cachedSearch() helper as /api/search to keep behavior aligned.
   */
  async function retrieveServices(
    intent: Intent,
    _context: ChatContext,
  ): Promise<EnrichedService[]> {
    if (!isDatabaseConfigured()) {
      return [];
    }

    const trust = filters?.trust;
    const minConfidenceScore = trust === 'HIGH' ? 80 : trust === 'LIKELY' ? 60 : undefined;

    const query: SearchQuery = {
      text: intent.rawQuery,
      filters: {
        status: 'active',
        taxonomyTermIds: filters?.taxonomyTermIds,
        minConfidenceScore,
      },
      pagination: {
        page: 1,
        limit: MAX_SERVICES_PER_RESPONSE,
      },
      sortBy: 'relevance',
    };

    const response = await cachedSearch(engine, query);
    return response.results.map((r) => r.service);
  }

  try {
    let response = await orchestrateChat(message, sessionId, effectiveUserId, locale, rateLimitKey, {
      retrieveServices,
      isFlagEnabled: (flagName) => flagService.isEnabled(flagName),
      summarizeWithLLM,
      enrichIntent,
    });

    // Idea 8: Multilingual service descriptions
    // Translate service card descriptions when the request locale is not English.
    // Fail-open: any translation error keeps original descriptions.
    const multilingualEnabled = await flagService.isEnabled(FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS);
    if (multilingualEnabled && locale !== 'en' && response.services.length > 0 && isTranslatorConfigured()) {
      const safeLocale: LocaleCode | null = SUPPORTED_LOCALES.includes(locale as LocaleCode)
        ? (locale as LocaleCode)
        : null;
      if (safeLocale) {
        const descriptions = response.services.map((s) => s.description ?? '');
        try {
          const translated = await translateBatch(descriptions, safeLocale);
          response = {
            ...response,
            services: response.services.map((s, i) => ({
              ...s,
              description: (descriptions[i] && translated[i]?.translatedText) || s.description,
            })),
          };
        } catch {
          // Translator failure is non-fatal — keep original descriptions
        }
      }
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ChatRateLimitExceededError) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before sending more messages.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(error.retryAfterSeconds),
            'Cache-Control': 'private, no-store',
          },
        }
      );
    }
    await captureException(error, {
      feature: 'api_chat',
      sessionId,
      userId: effectiveUserId,
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
