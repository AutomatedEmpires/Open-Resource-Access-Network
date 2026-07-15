// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildOnboardingChatPrompt,
  mergeOnboardingIntoProfile,
  normalizeOnboardingDraft,
  ONBOARDING_CONSENT_VERSION,
} from '../onboarding';
import {
  consumeOnboardingChatHandoff,
  ONBOARDING_CHAT_HANDOFF_KEY,
  writeOnboardingChatHandoff,
} from '../onboardingHandoff';

beforeEach(() => {
  sessionStorage.clear();
});

describe('privacy-first onboarding contracts', () => {
  it('keeps every matching detail optional and rejects out-of-range household counts', () => {
    expect(normalizeOnboardingDraft({})).toEqual(expect.objectContaining({
      needId: '',
      approximateLocation: '',
      ageGroup: '',
      householdSize: null,
      employmentStatus: '',
      incomeRange: '',
      accessibilityNeeds: [],
      veteranSupport: false,
      immigrationSupportNeeds: [],
    }));

    expect(normalizeOnboardingDraft({ householdSize: 21 }).householdSize).toBeNull();
  });

  it('builds a useful prompt only from context the seeker explicitly supplied', () => {
    const prompt = buildOnboardingChatPrompt({
      needId: 'housing',
      approximateLocation: 'Tacoma, WA',
      urgency: 'today',
      audience: 'household',
      ageGroup: '25_54',
      householdSize: 3,
      employmentStatus: 'unemployed_looking',
      incomeRange: 'under_1500_monthly',
      accessibilityNeeds: ['wheelchair_access'],
      veteranSupport: true,
      immigrationSupportNeeds: ['immigration_legal_aid', 'no_ssn_services'],
    });

    expect(prompt).toContain('I need help with housing.');
    expect(prompt).toContain('Please look near Tacoma, WA.');
    expect(prompt).toContain('The person who needs help is age 25 to 54.');
    expect(prompt).toContain('My household has 3 people.');
    expect(prompt).toContain('veteran or military-family services');
    expect(prompt).toContain('immigration legal aid');
    expect(prompt).toContain('do not require a Social Security number');
    expect(prompt).not.toMatch(/citizen|visa holder|undocumented person/i);
  });

  it('does not disclose prefer-not-to-say selections in the chat prompt', () => {
    const prompt = buildOnboardingChatPrompt({
      customNeed: 'help paying an electric bill',
      urgency: 'prefer_not_to_say',
      audience: 'prefer_not_to_say',
      ageGroup: 'prefer_not_to_say',
      employmentStatus: 'prefer_not_to_say',
      incomeRange: 'prefer_not_to_say',
    });

    expect(prompt).toBe('I am looking for help paying an electric bill.');
    expect(prompt).not.toContain('prefer');
  });

  it('adds only explicitly selected profile signals and records save consent', () => {
    const merged = mergeOnboardingIntoProfile(
      { serviceInterests: ['food_assistance'], selfIdentifiers: ['caregiver'] },
      {
        needId: 'housing',
        urgency: 'one_to_two_days',
        ageGroup: '55_64',
        householdSize: 4,
        employmentStatus: 'employed_part_time',
        incomeRange: '1500_2999_monthly',
        accessibilityNeeds: ['hearing_support'],
        veteranSupport: true,
        immigrationSupportNeeds: ['language_support', 'no_ssn_services'],
      },
      '2026-07-13T20:00:00.000Z',
    );

    expect(merged.serviceInterests).toEqual(['food_assistance', 'housing']);
    expect(merged.selfIdentifiers).toEqual(['caregiver']);
    expect(merged.veteranServicePreference).toBe(true);
    expect(merged.accessibilityNeeds).toEqual(['hearing_support', 'language_interpretation']);
    expect(merged.documentationBarriers).toEqual(['no_ssn']);
    expect(merged.urgencyWindow).toBe('next_day');
    expect(merged.ageGroup).toBe('55_64');
    expect(merged.householdSize).toBe(4);
    expect(merged.employmentStatus).toBe('employed_part_time');
    expect(merged.incomeRange).toBe('1500_2999_monthly');
    expect(merged.onboardingProfileConsent).toBe(true);
    expect(merged.onboardingConsentVersion).toBe(ONBOARDING_CONSENT_VERSION);
    expect(merged.onboardingCompletedAt).toBe('2026-07-13T20:00:00.000Z');
    expect(merged.selfIdentifiers).not.toContain('undocumented_friendly');
    expect(merged.selfIdentifiers).not.toContain('veteran');
  });
});

describe('one-time onboarding handoff', () => {
  it('consumes and deletes the session-only handoff', () => {
    expect(writeOnboardingChatHandoff({ prompt: 'I need food help.', needId: 'food_assistance' })).toBe(true);
    expect(sessionStorage.getItem(ONBOARDING_CHAT_HANDOFF_KEY)).not.toBeNull();

    expect(consumeOnboardingChatHandoff()).toEqual({
      prompt: 'I need food help.',
      needId: 'food_assistance',
    });
    expect(sessionStorage.getItem(ONBOARDING_CHAT_HANDOFF_KEY)).toBeNull();
    expect(consumeOnboardingChatHandoff()).toBeNull();
  });

  it('drops malformed handoff data instead of exposing it to chat', () => {
    sessionStorage.setItem(ONBOARDING_CHAT_HANDOFF_KEY, JSON.stringify({ prompt: '', needId: 'not-real' }));

    expect(consumeOnboardingChatHandoff()).toBeNull();
    expect(sessionStorage.getItem(ONBOARDING_CHAT_HANDOFF_KEY)).toBeNull();
  });
});
