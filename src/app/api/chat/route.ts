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
import { getDiscoveryNeedSearchText } from '@/domain/discoveryNeeds';
import { guidedIntakePromptMatchesDraft } from '@/domain/resourceNavigator';
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
import type {
  ChatContext,
  ChatResponse,
  ChatRetrievalResult,
  ChatSessionContext,
  GuidedIntakeRequest,
  Intent,
} from '@/services/chat/types';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { flagService } from '@/services/flags/flags';
import { SUPPORTED_LOCALES } from '@/services/i18n/i18n';
import type { LocaleCode } from '@/services/i18n/i18n';
import { translateBatch, isConfigured as isTranslatorConfigured } from '@/services/i18n/translator';
import { hydrateChatContext } from '@/services/profile/chatHydration';
import { cachedSearch } from '@/services/search/cache';
import { ServiceSearchEngine } from '@/services/search/engine';
import { hydrateEnrichedServices } from '@/services/search/hydrateRelations';
import type { SearchFilters } from '@/services/search/types';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';
import { hasDistressSignals, normalizeSafetyText } from '@/services/security/contentSafety';

const RequestSchema = ChatRequestSchema;
const SafetyEnvelopeSchema = ChatRequestSchema.pick({
  message: true,
  sessionId: true,
  userId: true,
  locale: true,
});
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
  const normalized = normalizeSafetyText(message);
  return detectCrisis(message)
    || CRISIS_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function stripProfileShaping(context: ChatContext): ChatContext {
  const activeLocation = context.sessionContext?.activeLocation
    ?? (context.sessionContext?.activeCity ? { city: context.sessionContext.activeCity } : undefined);

  return {
    ...context,
    profileShapingDisabled: true,
    approximateLocation: activeLocation,
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

function getGuidedDeliveryModes(
  accessMode: GuidedIntakeRequest['accessMode'],
): string[] | undefined {
  switch (accessMode) {
    case 'phone':
      return ['phone'];
    case 'online':
      return ['virtual'];
    case 'cannot_travel':
      return ['phone', 'virtual', 'mobile_outreach', 'home_delivery', 'delivery_available'];
    default:
      return undefined;
  }
}

function applyGuidedAccessFilters(
  attributeFilters: SearchFilters['attributeFilters'] | undefined,
  guidedIntake: GuidedIntakeRequest | undefined,
): SearchFilters['attributeFilters'] | undefined {
  if (!guidedIntake?.accessMode) return attributeFilters;

  const nextFilters = attributeFilters ? { ...attributeFilters } : {};
  const deliveryModes = getGuidedDeliveryModes(guidedIntake.accessMode);
  if (deliveryModes) {
    nextFilters.delivery = deliveryModes;
  } else {
    delete nextFilters.delivery;
  }

  return Object.keys(nextFilters).length > 0 ? nextFilters : undefined;
}

function mergeGuidedSessionContext(
  sessionContext: ChatSessionContext | undefined,
  guidedIntake: GuidedIntakeRequest | undefined,
  guidedLocation: ChatContext['approximateLocation'] | undefined,
): ChatSessionContext | undefined {
  if (!guidedIntake) return sessionContext;

  const beginsNonSelfScope = Boolean(
    guidedIntake.audience && guidedIntake.audience !== 'self',
  );
  const deliveryModes = getGuidedDeliveryModes(guidedIntake.accessMode);
  const hasExistingDeliveryPreference = Boolean(
    !beginsNonSelfScope
    && sessionContext
    && Object.prototype.hasOwnProperty.call(sessionContext, 'preferredDeliveryModes'),
  );
  const deliveryContext = guidedIntake.accessMode
    ? { preferredDeliveryModes: deliveryModes ?? [] }
    : hasExistingDeliveryPreference
      ? { preferredDeliveryModes: sessionContext?.preferredDeliveryModes ?? [] }
      : beginsNonSelfScope ? { preferredDeliveryModes: undefined } : {};

  return {
    ...(sessionContext ?? {}),
    activeNeedId: beginsNonSelfScope ? undefined : sessionContext?.activeNeedId,
    activeRetrievalText: beginsNonSelfScope ? undefined : sessionContext?.activeRetrievalText,
    activeCity: guidedLocation
      ? guidedLocation.city
      : beginsNonSelfScope ? undefined : sessionContext?.activeCity,
    activeLocation: guidedLocation
      ?? (beginsNonSelfScope ? undefined : sessionContext?.activeLocation),
    activeGeo: guidedLocation || beginsNonSelfScope ? undefined : sessionContext?.activeGeo,
    urgency: guidedIntake.urgency
      ? guidedIntake.urgency === 'today' ? 'urgent' : 'standard'
      : beginsNonSelfScope ? undefined : sessionContext?.urgency,
    urgencyWindow: guidedIntake.urgency
      ?? (beginsNonSelfScope ? undefined : sessionContext?.urgencyWindow),
    audience: guidedIntake.audience ?? sessionContext?.audience,
    accessMode: guidedIntake.accessMode
      ?? (beginsNonSelfScope ? undefined : sessionContext?.accessMode),
    ...deliveryContext,
    taxonomyTermIds: beginsNonSelfScope ? undefined : sessionContext?.taxonomyTermIds,
    attributeFilters: applyGuidedAccessFilters(
      beginsNonSelfScope ? undefined : sessionContext?.attributeFilters,
      guidedIntake,
    ),
    profileShapingEnabled: sessionContext?.profileShapingEnabled ?? true,
  };
}

function parseGuidedApproximateLocation(
  location: string | undefined,
): ChatContext['approximateLocation'] | undefined {
  const normalized = location?.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;

  const postalMatch = normalized.match(/^(\d{5})(?:-\d{4})?$/);
  if (postalMatch?.[1]) {
    return { postalCode: postalMatch[1] };
  }

  const [city, stateProvince] = normalized.split(',', 2).map((part) => part.trim());
  if (!city) return undefined;

  return {
    city,
    stateProvince: stateProvince || undefined,
  };
}

function guidedIntakeMatchesMessage(
  message: string,
  guidedIntake: GuidedIntakeRequest,
): boolean {
  return guidedIntakePromptMatchesDraft(message, {
    need: guidedIntake.searchText,
    location: guidedIntake.location,
    urgency: guidedIntake.urgency,
    audience: guidedIntake.audience,
    accessMode: guidedIntake.accessMode,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bodyRecord = body && typeof body === 'object'
    ? body as Record<string, unknown>
    : undefined;
  const safetyEnvelope = SafetyEnvelopeSchema.safeParse({
    message: bodyRecord?.message,
    sessionId: bodyRecord?.sessionId,
    userId: bodyRecord?.userId,
    locale: bodyRecord?.locale,
  });
  const safetyBypassesUsageControls = safetyEnvelope.success
    && (
      bypassesUsageControls(safetyEnvelope.data.message)
      || hasDistressSignals(safetyEnvelope.data.message)
    );
  let parsed = RequestSchema.safeParse(body);
  if (!parsed.success && safetyBypassesUsageControls) {
    // Optional stale/malformed discovery metadata must never suppress a valid
    // bounded self-crisis turn. Retry with only the safety-critical envelope.
    parsed = RequestSchema.safeParse(safetyEnvelope.data);
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { message, sessionId, locale, filters, profileMode, sessionContext, guidedIntake } = parsed.data;
  const bypassUsageControls = safetyBypassesUsageControls || bypassesUsageControls(message);
  const guidedIntakeMatches = !guidedIntake || guidedIntakeMatchesMessage(message, guidedIntake);
  if (!guidedIntakeMatches && !bypassUsageControls) {
    return NextResponse.json(
      { error: 'Guided intake does not match the visible chat message.' },
      { status: 400 },
    );
  }

  // Crisis language must always reach deterministic safety routing. If a
  // malformed client attaches contradictory structured intake, ignore the
  // structured fields and preserve the full visible message for crisis checks.
  const effectiveGuidedIntake = guidedIntakeMatches ? guidedIntake : undefined;
  const beginsNonSelfGuidedScope = Boolean(
    effectiveGuidedIntake?.audience && effectiveGuidedIntake.audience !== 'self',
  );
  const guidedLocation = parseGuidedApproximateLocation(effectiveGuidedIntake?.location);
  const requestSessionContext = mergeGuidedSessionContext(sessionContext, effectiveGuidedIntake, guidedLocation);
  const requestAttributeFilters = applyGuidedAccessFilters(
    beginsNonSelfGuidedScope ? undefined : filters?.attributeFilters,
    effectiveGuidedIntake,
  );
  const requestTaxonomyTermIds = beginsNonSelfGuidedScope
    ? undefined
    : filters?.taxonomyTermIds;
  const shouldOverrideBrowseAttributeFilters = beginsNonSelfGuidedScope
    ? Boolean(effectiveGuidedIntake?.accessMode)
    : Boolean(
        filters?.attributeFilters
        || sessionContext?.attributeFilters
        || effectiveGuidedIntake?.accessMode
        || (sessionContext
          && Object.prototype.hasOwnProperty.call(sessionContext, 'preferredDeliveryModes')),
      );
  const activeBrowseAttributeFilters = mergeAttributeFilters(
    requestSessionContext?.attributeFilters,
    requestAttributeFilters,
  );

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
    const taxonomyTermIds = requestTaxonomyTermIds ?? context.sessionContext?.taxonomyTermIds;
    const attributeFilters = mergeAttributeFilters(inheritedAttributeFilters, requestAttributeFilters);
    const minConfidenceScore = trust === 'HIGH' ? CONFIDENCE_BANDS.HIGH.min : trust === 'LIKELY' ? CONFIDENCE_BANDS.LIKELY.min : undefined;

    try {
      let query = buildChatSearchQuery(intent, context, {
        taxonomyTermIds,
        attributeFilters,
        minConfidenceScore,
        limit: MAX_SERVICES_PER_RESPONSE * 3,
      });

      let response = await cachedSearch(engine, query);
      let searchBroadened = false;
      const categoryFallbackText = context.retrievalText
        ? getDiscoveryNeedSearchText(intent.category)
        : undefined;
      if (
        response.results.length === 0
        && categoryFallbackText
        && categoryFallbackText.toLowerCase() !== query.text?.trim().toLowerCase()
      ) {
        query = { ...query, text: categoryFallbackText };
        response = await cachedSearch(engine, query);
        searchBroadened = response.results.length > 0;
      }
      // The paged search rows are lean; dedupe location fanout and hydrate
      // relations so cards can show phones, schedules, and match evidence.
      const seenServiceIds = new Set<string>();
      const leanServices = response.results
        .map((result) => result.service)
        .filter((service) => {
          const serviceId = service.service?.id;
          if (!serviceId) return true;
          if (seenServiceIds.has(serviceId)) return false;
          seenServiceIds.add(serviceId);
          return true;
        });
      if (leanServices.length > 0) {
        // Hydration is enrichment, not retrieval: if it fails, degrade to
        // lean cards (no phones/schedules) rather than reporting no results.
        let services = leanServices;
        try {
          services = await hydrateEnrichedServices({ executeQuery }, leanServices);
        } catch (hydrationError) {
          await captureException(hydrationError, { feature: 'api_chat_hydration' });
        }
        return {
          services,
          retrievalStatus: 'results',
          effectiveSearchText: query.text,
          locationBiasApplied: response.locationBiasApplied,
          searchBroadened,
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
        effectiveSearchText: query.text,
        locationBiasApplied: response.locationBiasApplied ?? scopeResponse.locationBiasApplied,
        searchBroadened: false,
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
        const hasBrowseFilters = Boolean(requestTaxonomyTermIds?.length)
          || shouldOverrideBrowseAttributeFilters;
        const merged = !hasBrowseFilters && !requestSessionContext
          ? hydrated
          : {
              ...hydrated,
              approximateLocation: requestSessionContext?.activeLocation
                ?? (requestSessionContext?.activeCity
                  ? { city: requestSessionContext.activeCity }
                  : hydrated.approximateLocation),
              sessionContext: requestSessionContext
                ? {
                    ...requestSessionContext,
                    profileShapingEnabled: profileMode !== 'ignore',
                  }
                : hydrated.sessionContext,
              userProfile: {
                ...(hydrated.userProfile ?? { userId: hydrated.userId ?? 'guest' }),
                browsePreference: {
                  ...(hydrated.userProfile?.browsePreference ?? {}),
                  ...(requestTaxonomyTermIds?.length ? { taxonomyTermIds: requestTaxonomyTermIds } : {}),
                  ...(shouldOverrideBrowseAttributeFilters
                    ? { attributeFilters: activeBrowseAttributeFilters }
                    : {}),
                },
              },
            };

        const shaped = profileMode === 'ignore'
          ? stripProfileShaping(merged)
          : merged;
        const audience = shaped.sessionContext?.audience;
        const audienceScoped = audience && audience !== 'self'
          ? {
              ...shaped,
              approximateLocation: shaped.sessionContext?.activeLocation
                ?? (shaped.sessionContext?.activeCity
                  ? { city: shaped.sessionContext.activeCity }
                  : undefined),
            }
          : shaped;

        return {
          ...audienceScoped,
          ...(effectiveGuidedIntake ? { retrievalText: effectiveGuidedIntake.searchText } : {}),
          ...(guidedLocation
            ? {
                approximateLocation: {
                  ...audienceScoped.approximateLocation,
                  ...guidedLocation,
                },
              }
            : {}),
        };
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
