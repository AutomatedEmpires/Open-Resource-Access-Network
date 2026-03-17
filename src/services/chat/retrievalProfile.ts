import type { Intent, ChatContext } from './types';
import type { SearchFilters, SearchQuery, SearchPreferenceSignals } from '@/services/search/types';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import { buildSearchQueryFromDiscovery } from '@/services/search/discovery';
import { milesToMeters } from '@/services/search/radius';

interface BuildChatSearchQueryOptions {
  taxonomyTermIds?: string[];
  attributeFilters?: SearchFilters['attributeFilters'];
  minConfidenceScore?: number;
  limit: number;
}

function buildHydratedSearchText(intent: Intent, context: ChatContext): string {
  if (intent.category !== 'general') {
    return intent.rawQuery;
  }

  const preferenceTerms = buildSeekerDiscoveryProfile(context.userProfile, { locale: context.locale })
    .interestSearchText
    .slice(0, 3);

  if (preferenceTerms.length === 0) {
    return intent.rawQuery;
  }

  return `${intent.rawQuery} ${preferenceTerms.join(' ')}`.trim();
}

export function buildChatSearchProfileSignals(context: ChatContext): SearchPreferenceSignals | undefined {
  const userProfile = context.userProfile;
  if (!userProfile) {
    return undefined;
  }

  return buildSeekerDiscoveryProfile(userProfile, { locale: context.locale }).profileSignals;
}

export function buildChatSearchQuery(
  intent: Intent,
  context: ChatContext,
  options: BuildChatSearchQueryOptions
): SearchQuery {
  const query = buildSearchQueryFromDiscovery({
    text: buildHydratedSearchText(intent, context),
    taxonomyTermIds: options.taxonomyTermIds,
    attributeFilters: options.attributeFilters,
    minConfidenceScore: options.minConfidenceScore,
    limit: options.limit,
    geo: context.sessionContext?.activeGeo
      ? {
          type: 'radius',
          lat: context.sessionContext.activeGeo.lat,
          lng: context.sessionContext.activeGeo.lng,
          radiusMeters: milesToMeters(context.sessionContext.activeGeo.radiusMiles),
        }
      : undefined,
  });

  return {
    ...query,
    filters: {
      ...query.filters,
      publishedOnly: true,
    },
    cachePolicy: 'skip',
    cityBias: context.approximateLocation?.city ?? context.userProfile?.locationCity,
    profileSignals: buildChatSearchProfileSignals(context),
  };
}
