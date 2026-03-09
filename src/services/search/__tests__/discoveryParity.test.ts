import { describe, expect, it } from 'vitest';

import { buildChatSearchQuery } from '@/services/chat/retrievalProfile';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';

import {
  buildDiscoveryUrlParams,
  buildSearchQueryFromDiscovery,
  parseDiscoveryUrlState,
} from '../discovery';

describe('discovery compiler parity', () => {
  it('round-trips a profile-derived selector bundle without changing the compiled query', () => {
    const discoveryProfile = buildSeekerDiscoveryProfile({
      serviceInterests: ['housing', 'food_assistance'],
      accessibilityNeeds: ['language_interpretation'],
      preferredDeliveryModes: ['phone'],
      documentationBarriers: ['no_id'],
      urgencyWindow: 'same_day',
    });

    const sourceState = {
      ...discoveryProfile.browseState,
      confidenceFilter: 'HIGH' as const,
      taxonomyTermIds: ['11111111-1111-4111-8111-111111111111'],
    };

    const roundTrippedState = parseDiscoveryUrlState(buildDiscoveryUrlParams(sourceState));

    expect(buildSearchQueryFromDiscovery(sourceState)).toEqual(buildSearchQueryFromDiscovery(roundTrippedState));
  });

  it('keeps chat retrieval on the same eligibility envelope as the shared search compiler', () => {
    const sharedQuery = buildSearchQueryFromDiscovery({
      text: 'food',
      taxonomyTermIds: ['11111111-1111-4111-8111-111111111111'],
      attributeFilters: {
        delivery: ['virtual'],
        access: ['walk_in'],
      },
      minConfidenceScore: 80,
      limit: 5,
    });

    const chatQuery = buildChatSearchQuery(
      {
        category: 'general',
        rawQuery: 'food',
        urgencyQualifier: 'standard',
      },
      {
        sessionId: '00000000-0000-0000-0000-000000000001',
        locale: 'en',
        messageCount: 0,
        userProfile: { userId: 'user-1' },
      },
      {
        taxonomyTermIds: ['11111111-1111-4111-8111-111111111111'],
        attributeFilters: {
          delivery: ['virtual'],
          access: ['walk_in'],
        },
        minConfidenceScore: 80,
        limit: 5,
      },
    );

    expect(chatQuery.text).toBe(sharedQuery.text);
    expect(chatQuery.filters).toEqual(sharedQuery.filters);
    expect(chatQuery.pagination).toEqual(sharedQuery.pagination);
    expect(chatQuery.sortBy).toEqual(sharedQuery.sortBy);
  });

  it('rejects unrecognized selector dimensions and invalid tags deterministically', () => {
    const state = parseDiscoveryUrlState(
      new URLSearchParams(
        'category=unknown&taxonomyIds=bad,11111111-1111-4111-8111-111111111111&attributes=%7B%22delivery%22%3A%5B%22virtual%22%2C%22teleport%22%5D%2C%22made_up%22%3A%5B%22mystery%22%5D%7D',
      ),
    );

    expect(state).toEqual({
      text: null,
      needId: null,
      confidenceFilter: undefined,
      sortBy: undefined,
      taxonomyTermIds: ['11111111-1111-4111-8111-111111111111'],
      attributeFilters: {
        delivery: ['virtual'],
      },
      page: 1,
    });
  });
});
