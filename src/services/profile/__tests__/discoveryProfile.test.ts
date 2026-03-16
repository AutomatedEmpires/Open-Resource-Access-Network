import { describe, expect, it } from 'vitest';

import { buildSeekerDiscoveryProfile } from '../discoveryProfile';

describe('buildSeekerDiscoveryProfile', () => {
  it('derives canonical browse defaults and retrieval signals from structured seeker preferences', () => {
    const discoveryProfile = buildSeekerDiscoveryProfile({
      serviceInterests: ['housing', 'food_assistance'],
      accessibilityNeeds: ['language_interpretation', 'virtual_option'],
      preferredDeliveryModes: ['phone'],
      documentationBarriers: ['no_id'],
      urgencyWindow: 'same_day',
      transportationBarrier: true,
      selfIdentifiers: ['pregnant', 'lgbtq'],
      householdType: 'single_parent',
      housingSituation: 'shelter',
      additionalContext: 'Needs support soon.',
    });

    expect(discoveryProfile.primaryNeedId).toBe('housing');
    expect(discoveryProfile.additionalNeedIds).toEqual(['food_assistance']);
    expect(discoveryProfile.interestSearchText).toEqual(['housing', 'food']);
    expect(discoveryProfile.browseState).toEqual({
      needId: 'housing',
    });
    expect(discoveryProfile.profileSignals).toEqual({
      populationTags: ['pregnant', 'single_parent'],
      situationTags: ['no_fixed_address', 'language_barrier', 'transportation_barrier'],
      accessTags: ['interpreter_on_site', 'no_id_required', 'same_day', 'transportation_provided'],
      deliveryTags: ['virtual', 'phone', 'hybrid'],
      cultureTags: ['lgbtq_affirming', 'bilingual_services'],
    });
    expect(discoveryProfile.hasPersonalization).toBe(true);
    expect(discoveryProfile.hasIdentityContext).toBe(false);
  });

  it('tracks identity context separately from retrieval personalization', () => {
    const discoveryProfile = buildSeekerDiscoveryProfile({
      profileHeadline: 'Parent looking for stability',
      pronouns: 'they/them',
      avatarEmoji: '🧭',
    });

    expect(discoveryProfile.browseState).toEqual({
      needId: null,
    });
    expect(discoveryProfile.profileSignals).toBeUndefined();
    expect(discoveryProfile.hasPersonalization).toBe(false);
    expect(discoveryProfile.hasIdentityContext).toBe(true);
  });
});
