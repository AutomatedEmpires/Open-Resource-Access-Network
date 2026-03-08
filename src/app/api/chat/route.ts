/**
 * POST /api/chat
 *
 * Chat API handler implementing the retrieval-first pipeline.
 * Crisis detection takes priority over all other processing.
 * No LLM is used in retrieval. LLM summarization only if feature flag enabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MAX_SERVICES_PER_RESPONSE, FEATURE_FLAGS } from '@/domain/constants';
import type { EnrichedService } from '@/domain/types';
import { getAuthContext } from '@/services/auth/session';
import { orchestrateChat, ChatRateLimitExceededError } from '@/services/chat/orchestrator';
import { buildChatSearchQuery } from '@/services/chat/retrievalProfile';
import { ChatRequestSchema } from '@/services/chat/types';
import type { ChatContext, Intent } from '@/services/chat/types';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { flagService } from '@/services/flags/flags';
import { summarizeWithLLM } from '@/services/chat/llm';
import { enrichIntent } from '@/services/chat/intentEnrich';
import { SUPPORTED_LOCALES } from '@/services/i18n/i18n';
import type { LocaleCode } from '@/services/i18n/i18n';
import { translateBatch, isConfigured as isTranslatorConfigured } from '@/services/i18n/translator';
import { hydrateChatContext } from '@/services/profile/chatHydration';
import { cachedSearch } from '@/services/search/cache';
import { ServiceSearchEngine } from '@/services/search/engine';
import { captureException } from '@/services/telemetry/sentry';

const RequestSchema = ChatRequestSchema;
const engine = new ServiceSearchEngine({ executeQuery, executeCount });

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { message, sessionId, locale, filters } = parsed.data;

  const authCtx = await getAuthContext();
  const effectiveUserId = authCtx?.userId;

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimitKey = effectiveUserId ? `chat:user:${effectiveUserId}` : `chat:ip:${ip}`;

  async function retrieveServices(intent: Intent, context: ChatContext): Promise<EnrichedService[]> {
    if (!isDatabaseConfigured()) {
      return [];
    }

    const trust = filters?.trust;
    const minConfidenceScore = trust === 'HIGH' ? 80 : trust === 'LIKELY' ? 60 : undefined;

    const query = buildChatSearchQuery(intent, context, {
      taxonomyTermIds: filters?.taxonomyTermIds,
      minConfidenceScore,
      limit: MAX_SERVICES_PER_RESPONSE,
    });

    const response = await cachedSearch(engine, query);
    return response.results.map((result) => result.service);
  }

  try {
    let response = await orchestrateChat(message, sessionId, effectiveUserId, locale, rateLimitKey, {
      retrieveServices,
      hydrateContext: (context) => hydrateChatContext(context, { executeQuery }),
      isFlagEnabled: (flagName) => flagService.isEnabled(flagName),
      summarizeWithLLM,
      enrichIntent,
    });

    const multilingualEnabled = await flagService.isEnabled(FEATURE_FLAGS.MULTILINGUAL_DESCRIPTIONS);
    if (multilingualEnabled && locale !== 'en' && response.services.length > 0 && isTranslatorConfigured()) {
      const safeLocale: LocaleCode | null = SUPPORTED_LOCALES.includes(locale as LocaleCode)
        ? (locale as LocaleCode)
        : null;

      if (safeLocale) {
        const descriptions = response.services.map((service) => service.description ?? '');
        try {
          const translated = await translateBatch(descriptions, safeLocale);
          response = {
            ...response,
            services: response.services.map((service, index) => ({
              ...service,
              description: (descriptions[index] && translated[index]?.translatedText) || service.description,
            })),
          };
        } catch {
          // Translator failure is non-fatal — keep original descriptions.
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
        },
      );
    }

    await captureException(error, {
      feature: 'api_chat',
      sessionId,
      userId: effectiveUserId,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
