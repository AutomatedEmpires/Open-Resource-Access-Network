import { describe, expect, it } from 'vitest';
import { buildChatSearchProfileSignals, buildChatSearchQuery } from '../retrievalProfile';
import type { ChatContext, Intent } from '../types';

const baseIntent: Intent = {
  category: 'general',
  rawQuery: 'help',
  urgencyQualifier: 'standard',
};

const baseContext: ChatContext = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  locale: 'en',
  messageCount: 0,
  userProfile: {
    userId: 'user-1',
  },
};

describe('retrievalProfile', () => {
  it('maps interpretation support to the correct taxonomy dimensions', () => {
    const signals = buildChatSearchProfileSignals({
      ...baseContext,
      userProfile: {
        userId: 'user-1',
        accessibilityNeeds: ['language_interpretation'],
      },
    });

    expect(signals).toEqual({
      accessTags: ['interpreter_on_site'],
      cultureTags: ['bilingual_services'],
      situationTags: ['language_barrier'],
    });
  });

  it('only appends normalized service-interest hints for recognized IDs', () => {
    const query = buildChatSearchQuery(
      baseIntent,
      {
        ...baseContext,
        userProfile: {
          userId: 'user-1',
          serviceInterests: ['housing', 'education', 'not_real'],
        },
      },
      { limit: 5 },
    );

    expect(query.text).toBe('help housing education');
    expect(query.cachePolicy).toBe('skip');
  });

  it('maps structured Phase 1 constraints to deterministic profile signals', () => {
    const signals = buildChatSearchProfileSignals({
      ...baseContext,
      userProfile: {
        userId: 'user-1',
        transportationBarrier: true,
        preferredDeliveryModes: ['phone', 'in_person'],
        urgencyWindow: 'next_day',
        documentationBarriers: ['no_id', 'no_ssn'],
        digitalAccessBarrier: true,
      },
    });

    expect(signals).toEqual({
      populationTags: undefined,
      situationTags: ['transportation_barrier', 'digital_barrier'],
      accessTags: ['no_id_required', 'no_ssn_required', 'same_day', 'next_day', 'transportation_provided'],
      deliveryTags: ['phone', 'in_person'],
      cultureTags: undefined,
    });
  });

  it('preserves browse-compatible attribute filters in chat retrieval queries', () => {
    const query = buildChatSearchQuery(baseIntent, baseContext, {
      attributeFilters: {
        delivery: ['virtual'],
        access: ['walk_in'],
      },
      limit: 5,
    });

    expect(query.filters.attributeFilters).toEqual({
      delivery: ['virtual'],
      access: ['walk_in'],
    });
  });
});
