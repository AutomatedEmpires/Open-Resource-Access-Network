/**
 * POST /api/chat
 *
 * Chat API handler implementing the retrieval-first pipeline.
 * Crisis detection takes priority over all other processing.
 * No LLM is used in retrieval. LLM summarization only if feature flag enabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MAX_SERVICES_PER_RESPONSE, FEATURE_FLAGS, CHAT_DEVICE_COOKIE } from '@/domain/constants';
import { getAuthContext } from '@/services/auth/session';
import { checkQuotaByIdentity, incrementQuotaByIdentity } from '@/services/chat/quota';
import { orchestrateChat, ChatRateLimitExceededError } from '@/services/chat/orchestrator';
import { buildChatSearchQuery } from '@/services/chat/retrievalProfile';
import { ChatRequestSchema } from '@/services/chat/types';
import type { ChatContext, ChatRetrievalResult, Intent } from '@/services/chat/types';
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
import type { SearchFilters } from '@/services/search/types';
import { captureException } from '@/services/telemetry/sentry';

const RequestSchema = ChatRequestSchema;
const engine = new ServiceSearchEngine({ executeQuery, executeCount });

function stripProfileShaping(context: ChatContext): ChatContext {
  return {
    ...context,
    profileShapingDisabled: true,
    approximateLocation: context.sessionContext?.activeCity
      ? {
          ...context.approximateLocation,
          city: context.sessionContext.activeCity,
        }
      : undefined,
    userProfile: context.userProfile
      ? {
          userId: context.userProfile.userId,
          browsePreference: context.userProfile.browsePreference,
        }
      : undefined,
    sessionContext: context.sessionContext
      ? {
          ...context.sessionContext,
          profileShapingEnabled: false,
        }
      : context.sessionContext,
  };
}

function mergeAttributeFilters(
  base: SearchFilters['attributeFilters'] | undefined,
  extra: SearchFilters['attributeFilters'] | undefined,
): SearchFilters['attributeFilters'] | undefined {
  if (!base && !extra) {
    return undefined;
  }

  const merged: NonNullable<SearchFilters['attributeFilters']> = {
    ...(base ?? {}),
  };

  for (const [taxonomy, tags] of Object.entries(extra ?? {})) {
    const existing = merged[taxonomy] ?? [];
    merged[taxonomy] = Array.from(new Set([...existing, ...tags]));
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

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

  const { message, sessionId, locale, filters, profileMode, sessionContext } = parsed.data;

  const authCtx = await getAuthContext();
  const effectiveUserId = authCtx?.userId;

  // ---- Device identity (for 24-hr quota and logout-bypass prevention) ----
  let deviceId = req.cookies?.get(CHAT_DEVICE_COOKIE)?.value;
  // Validate: must be a UUID-shaped string to prevent injection
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (deviceId && !UUID_RE.test(deviceId)) deviceId = undefined;
  const needsDeviceCookie = !deviceId;
  if (needsDeviceCookie) deviceId = crypto.randomUUID();

  // ---- 24-hour quota check (cross-session, cross-device) ----
  const windowQuota = await checkQuotaByIdentity(deviceId, effectiveUserId);
  if (windowQuota.exceeded) {
    return NextResponse.json(
      {
        error: 'Daily message limit reached.',
        quotaRemaining: 0,
        quotaResetAt: windowQuota.resetAt?.toISOString() ?? null,
      },
      {
        status: 429,
        headers: {
          'Cache-Control': 'private, no-store',
          ...(windowQuota.resetAt
            ? { 'Retry-After': String(Math.ceil((windowQuota.resetAt.getTime() - Date.now()) / 1000)) }
            : {}),
        },
      },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimitKey = effectiveUserId ? `chat:user:${effectiveUserId}` : `chat:ip:${ip}`;

  async function retrieveServices(intent: Intent, context: ChatContext): Promise<ChatRetrievalResult> {
    if (!isDatabaseConfigured()) {
      return {
        services: [],
        retrievalStatus: 'temporarily_unavailable',
      };
    }

    const inheritedAttributeFilters = mergeAttributeFilters(
      context.sessionContext?.attributeFilters,
      context.sessionContext?.preferredDeliveryModes?.length
        ? { delivery: context.sessionContext.preferredDeliveryModes }
        : undefined,
    );
    const trust = filters?.trust ?? context.sessionContext?.trustFilter;
    const taxonomyTermIds = filters?.taxonomyTermIds ?? context.sessionContext?.taxonomyTermIds;
    const attributeFilters = mergeAttributeFilters(inheritedAttributeFilters, filters?.attributeFilters);
    const minConfidenceScore = trust === 'HIGH' ? 80 : trust === 'LIKELY' ? 60 : undefined;

    try {
      const query = buildChatSearchQuery(intent, context, {
        taxonomyTermIds,
        attributeFilters,
        minConfidenceScore,
        limit: MAX_SERVICES_PER_RESPONSE * 3,
      });

      const response = await cachedSearch(engine, query);
      const services = response.results.map((result) => result.service);
      if (services.length > 0) {
        return {
          services,
          retrievalStatus: 'results',
        };
      }

      const scopeResponse = await cachedSearch(engine, {
        ...query,
        text: undefined,
        pagination: {
          page: 1,
          limit: 1,
        },
      });

      return {
        services: [],
        retrievalStatus: scopeResponse.total === 0 ? 'catalog_empty_for_scope' : 'no_match',
      };
    } catch {
      return {
        services: [],
        retrievalStatus: 'temporarily_unavailable',
      };
    }
  }

  try {
    let response = await orchestrateChat(message, sessionId, effectiveUserId, locale, rateLimitKey, {
      retrieveServices,
      hydrateContext: async (context) => {
        const hydrated = await hydrateChatContext(context, { executeQuery });
        const hasBrowseFilters = Boolean(filters?.taxonomyTermIds?.length) || Boolean(filters?.attributeFilters);
        const merged = !hasBrowseFilters && !sessionContext
          ? hydrated
          : {
              ...hydrated,
              approximateLocation: sessionContext?.activeCity
                ? {
                    ...hydrated.approximateLocation,
                    city: sessionContext.activeCity,
                  }
                : hydrated.approximateLocation,
              sessionContext: sessionContext
                ? {
                    ...sessionContext,
                    profileShapingEnabled: profileMode !== 'ignore',
                  }
                : hydrated.sessionContext,
              userProfile: {
                ...(hydrated.userProfile ?? { userId: hydrated.userId ?? 'guest' }),
                browsePreference: {
                  ...(hydrated.userProfile?.browsePreference ?? {}),
                  ...(filters?.taxonomyTermIds?.length ? { taxonomyTermIds: filters.taxonomyTermIds } : {}),
                  ...(filters?.attributeFilters ? { attributeFilters: filters.attributeFilters } : {}),
                },
              },
            };

        return profileMode === 'ignore'
          ? stripProfileShaping(merged)
          : merged;
      },
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

    // Increment the 24-hr window quota after a successful response
    await incrementQuotaByIdentity(deviceId, effectiveUserId);
    const updatedWindowQuota = await checkQuotaByIdentity(deviceId, effectiveUserId);

    const finalResponse = {
      ...response,
      quotaRemaining: updatedWindowQuota.remaining,
      quotaResetAt: updatedWindowQuota.resetAt?.toISOString() ?? undefined,
    };

    const res = NextResponse.json(finalResponse, {
      headers: { 'Cache-Control': 'private, no-store' },
    });

    // Set (or refresh) the HttpOnly device-identity cookie
    if (needsDeviceCookie) {
      res.cookies.set(CHAT_DEVICE_COOKIE, deviceId!, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60, // 1 year
        secure: process.env.NODE_ENV === 'production',
      });
    }

    return res;
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
