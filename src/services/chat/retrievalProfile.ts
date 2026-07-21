import type { Intent, ChatContext } from './types';
import type { SearchFilters, SearchQuery } from '@/services/search/types';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import { buildSearchQueryFromDiscovery } from '@/services/search/discovery';
import { milesToMeters } from '@/services/search/radius';
import {
  buildChatSearchProfileSignals,
  shouldUseSavedSeekerProfile,
} from '@/services/chat/profileSignals';

export { buildChatSearchProfileSignals } from '@/services/chat/profileSignals';

interface BuildChatSearchQueryOptions {
  taxonomyTermIds?: string[];
  attributeFilters?: SearchFilters['attributeFilters'];
  minConfidenceScore?: number;
  limit: number;
}

function buildHydratedSearchText(intent: Intent, context: ChatContext): string {
  const retrievalText = context.retrievalText?.trim();
  if (retrievalText) {
    return retrievalText;
  }

  if (intent.category !== 'general') {
    return intent.rawQuery;
  }

  const preferenceTerms = (shouldUseSavedSeekerProfile(context)
    ? buildSeekerDiscoveryProfile(context.userProfile, { locale: context.locale }).interestSearchText
    : [])
    .slice(0, 3);

  if (preferenceTerms.length === 0) {
    return intent.rawQuery;
  }

  return `${intent.rawQuery} ${preferenceTerms.join(' ')}`.trim();
}

function buildApproximateLocationBias(context: ChatContext): string | undefined {
  const location = context.approximateLocation;
  if (location?.postalCode) return location.postalCode;
  if (location?.city && location.stateProvince) {
    return `${location.city}, ${location.stateProvince}`;
  }
  return location?.city
    ?? (shouldUseSavedSeekerProfile(context) ? context.userProfile?.locationCity : undefined);
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
    cityBias: buildApproximateLocationBias(context),
    profileSignals: buildChatSearchProfileSignals(context),
  };
}
