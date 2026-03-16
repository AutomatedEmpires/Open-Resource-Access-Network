import { describe, expect, it, vi } from 'vitest';
import { hydrateChatContext } from '../chatHydration';

describe('hydrateChatContext', () => {
  it('keeps the request locale authoritative while hydrating profile fields', async () => {
    const executeQuery = vi.fn().mockResolvedValueOnce([
      {
        user_id: 'user-1',
        approximate_city: 'Denver',
        service_interests: ['housing'],
        age_group: null,
        household_type: 'single_parent',
        housing_situation: 'shelter',
        self_identifiers: ['pregnant'],
        current_services: null,
        accessibility_needs: ['language_interpretation'],
        transportation_barrier: true,
        preferred_delivery_modes: ['phone'],
        urgency_window: 'same_day',
        documentation_barriers: ['no_id'],
        digital_access_barrier: true,
      },
    ]);

    const hydrated = await hydrateChatContext(
      {
        sessionId: '00000000-0000-0000-0000-000000000001',
        userId: 'user-1',
        locale: 'en',
        messageCount: 0,
        userProfile: { userId: 'user-1' },
      },
      { executeQuery },
    );

    expect(hydrated.locale).toBe('en');
    expect(hydrated.approximateLocation?.city).toBe('Denver');
    expect(hydrated.userProfile).toMatchObject({
      userId: 'user-1',
      serviceInterests: ['housing'],
      primaryNeedId: 'housing',
      browsePreference: {
        needId: 'housing',
      },
      householdType: 'single_parent',
      housingSituation: 'shelter',
      accessibilityNeeds: ['language_interpretation'],
      transportationBarrier: true,
      preferredDeliveryModes: ['phone'],
      urgencyWindow: 'same_day',
      documentationBarriers: ['no_id'],
      digitalAccessBarrier: true,
    });
  });
});
