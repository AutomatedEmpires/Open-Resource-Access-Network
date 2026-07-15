/**
 * POST /api/chat
 *
 * Chat API handler implementing the retrieval-first pipeline.
 * Crisis detection takes priority over all other processing.
 * Launch mode is deterministic: no OpenAI generation or enrichment is invoked.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  MAX_SERVICES_PER_RESPONSE,
  FEATURE_FLAGS,
  CHAT_DEVICE_COOKIE,
  CONFIDENCE_BANDS,
  CRISIS_KEYWORDS,
} from '@/domain/constants';
import { getAuthContext } from '@/services/auth/session';
import {
  checkQuotaByIdentity,
  finalizeChatRequest,
  reserveChatRequest,
} from '@/services/chat/quota';
import type { ChatUsageReservation } from '@/services/chat/quota';
import {
  orchestrateChat,
  ChatRateLimitExceededError,
  detectCrisis,
} from '@/services/chat/orchestrator';
import { buildChatSearchQuery } from '@/services/chat/retrievalProfile';
import { ChatRequestSchema } from '@/services/chat/types';
import type { ChatContext, ChatResponse, ChatRetrievalResult, Intent } from '@/services/chat/types';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { flagService } from '@/services/flags/flags';
import { SUPPORTED_LOCALES } from '@/services/i18n/i18n';
import type { LocaleCode } from '@/services/i18n/i18n';
import { translateBatch, isConfigured as isTranslatorConfigured } from '@/services/i18n/translator';
import { hydrateChatContext } from '@/services/profile/chatHydration';
import { cachedSearch } from '@/services/search/cache';
import { ServiceSearchEngine } from '@/services/search/engine';
import type { SearchFilters } from '@/services/search/types';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';

const RequestSchema = ChatRequestSchema;
const engine = new ServiceSearchEngine({ executeQuery, executeCount });

function attachDeviceCookie(
  response: NextResponse,
  deviceId: string,
  needsDeviceCookie: boolean,
): NextResponse {
  if (needsDeviceCookie) {
    response.cookies.set(CHAT_DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return response;
}

function consumesDailyQuota(response: ChatResponse): boolean {
  return !response.isCrisis
    && response.clarification?.reason !== 'crisis_scope'
    && response.retrievalStatus !== 'temporarily_unavailable';
}

function bypassesUsageControls(message: string): boolean {
  const normalized = message.toLowerCase();
  return detectCrisis(message)
    || CRISIS_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

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
  if (!deviceId) deviceId = crypto.randomUUID();

  const ip = getIp(req);
  const rateLimitKey = effectiveUserId ? `chat:user:${effectiveUserId}` : `chat:ip:${ip}`;
  const bypassUsageControls = bypassesUsageControls(message);
  let usageReservation: ChatUsageReservation | undefined;

  // Explicit self-crisis messages must always reach deterministic 911/988/211
  // routing, including when normal usage limits are exhausted.
  if (!bypassUsageControls) {
    usageReservation = await reserveChatRequest({
      requestId: crypto.randomUUID(),
      deviceId,
      userId: effectiveUserId,
      rateLimitKey,
    });

    if (usageReservation.decision !== 'allowed') {
      if (usageReservation.decision === 'unavailable') {
        return attachDeviceCookie(
          NextResponse.json(
            { error: 'Chat is temporarily unavailable. Please try again shortly.' },
            {
              status: 503,
              headers: {
                'Cache-Control': 'private, no-store',
                'Retry-After': String(usageReservation.retryAfterSeconds),
              },
            },
          ),
          deviceId,
          needsDeviceCookie,
        );
      }

      const quotaResetAt = usageReservation.quota.resetAt?.toISOString() ?? null;
      const commonOptions = {
        status: 429,
        headers: {
          'Cache-Control': 'private, no-store',
          'Retry-After': String(usageReservation.retryAfterSeconds),
        },
      };

      if (usageReservation.decision === 'quota_exceeded') {
        return attachDeviceCookie(
          NextResponse.json(
            {
              error: 'Daily message limit reached.',
              quotaRemaining: 0,
              quotaResetAt,
            },
            commonOptions,
          ),
          deviceId,
          needsDeviceCookie,
        );
      }

      const error = usageReservation.decision === 'in_flight'
        ? 'Please wait for your current chat request to finish.'
        : 'Rate limit exceeded. Please wait before sending more messages.';
      return attachDeviceCookie(
        NextResponse.json({ error }, commonOptions),
        deviceId,
        needsDeviceCookie,
      );
    }
  }

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
    const minConfidenceScore = trust === 'HIGH' ? CONFIDENCE_BANDS.HIGH.min : trust === 'LIKELY' ? CONFIDENCE_BANDS.LIKELY.min : undefined;

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

    // Only successful, non-crisis responses commit the pre-search reservation.
    // Distress-safe clarification and temporary search failure release it.
    const updatedWindowQuota = usageReservation
      ? await finalizeChatRequest(usageReservation, consumesDailyQuota(response))
      : await checkQuotaByIdentity(deviceId, effectiveUserId);

    const finalResponse = {
      ...response,
      quotaRemaining: updatedWindowQuota.remaining,
      quotaResetAt: updatedWindowQuota.resetAt?.toISOString() ?? undefined,
    };

    const res = NextResponse.json(finalResponse, {
      headers: { 'Cache-Control': 'private, no-store' },
    });

    return attachDeviceCookie(res, deviceId, needsDeviceCookie);
  } catch (error) {
    if (usageReservation?.decision === 'allowed') {
      try {
        await finalizeChatRequest(usageReservation, false);
      } catch (releaseError) {
        await captureException(releaseError, {
          feature: 'api_chat_usage_release',
          sessionId,
          userId: effectiveUserId,
        });
      }
    }

    if (error instanceof ChatRateLimitExceededError) {
      return attachDeviceCookie(
        NextResponse.json(
          { error: 'Rate limit exceeded. Please wait before sending more messages.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(error.retryAfterSeconds),
              'Cache-Control': 'private, no-store',
            },
          },
        ),
        deviceId,
        needsDeviceCookie,
      );
    }

    await captureException(error, {
      feature: 'api_chat',
      sessionId,
      userId: effectiveUserId,
    });

    return attachDeviceCookie(
      NextResponse.json(
        { error: 'Internal server error' },
        { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
      ),
      deviceId,
      needsDeviceCookie,
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
