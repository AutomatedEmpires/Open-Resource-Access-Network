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

  it('uses explicit guided need text without appending transcript or profile terms', () => {
    const query = buildChatSearchQuery(
      {
        category: 'utility_assistance',
        rawQuery: 'Utility bill help. Near 48201. I need help today. I need help by phone.',
        urgencyQualifier: 'urgent',
      },
      {
        ...baseContext,
        retrievalText: 'Utility bill help',
        userProfile: {
          userId: 'user-1',
          serviceInterests: ['housing'],
        },
      },
      { limit: 5 },
    );

    expect(query.text).toBe('Utility bill help');
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

  it('ranks explicit urgency and audience while letting can-travel clear saved delivery preferences', () => {
    const signals = buildChatSearchProfileSignals({
      ...baseContext,
      sessionContext: {
        urgency: 'urgent',
        urgencyWindow: 'today',
        audience: 'child',
        accessMode: 'can_travel',
        preferredDeliveryModes: [],
        profileShapingEnabled: true,
      },
      userProfile: {
        userId: 'user-1',
        transportationBarrier: true,
        preferredDeliveryModes: ['phone'],
      },
    });

    expect(signals).toMatchObject({
      accessTags: ['same_day', '24_7', 'after_hours', 'weekend_hours', 'evening_hours'],
      cultureTags: ['youth_focused', 'family_centered'],
      deliveryTags: undefined,
      situationTags: undefined,
    });
    expect(signals?.accessTags).not.toContain('transportation_provided');
  });

  it('lets an explicit planning window clear stale saved urgency ranking', () => {
    const signals = buildChatSearchProfileSignals({
      ...baseContext,
      sessionContext: {
        urgency: 'standard',
        urgencyWindow: 'planning',
        profileShapingEnabled: true,
      },
      userProfile: {
        userId: 'user-1',
        urgencyWindow: 'same_day',
      },
    });

    expect(signals).toBeUndefined();
  });

  it('does not shape another person\'s search with the signed-in seeker\'s profile', () => {
    const context: ChatContext = {
      ...baseContext,
      sessionContext: {
        audience: 'someone_else',
        profileShapingEnabled: true,
      },
      userProfile: {
        userId: 'user-1',
        serviceInterests: ['housing'],
        selfIdentifiers: ['pregnant', 'lgbtq'],
        transportationBarrier: true,
        preferredDeliveryModes: ['phone'],
        documentationBarriers: ['no_id'],
      },
    };

    expect(buildChatSearchProfileSignals(context)).toBeUndefined();
    expect(buildChatSearchQuery(baseIntent, context, { limit: 5 }).text).toBe('help');
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

  it.each([
    [{ postalCode: '48201' }, '48201'],
    [{ city: 'Portland', stateProvince: 'OR' }, 'Portland, OR'],
  ])('preserves explicit approximate location for soft ordering bias', (approximateLocation, expectedBias) => {
    const query = buildChatSearchQuery(baseIntent, {
      ...baseContext,
      approximateLocation,
    }, { limit: 5 });

    expect(query.cityBias).toBe(expectedBias);
  });
});
