// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SEEKER_PROFILE } from '@/services/profile/contracts';

import {
  clearStoredSeekerProfile,
  emitStoredSeekerProfileUpdated,
  readStoredSeekerProfile,
  SEEKER_PROFILE_STORAGE_KEY,
  SEEKER_PROFILE_UPDATED_EVENT,
  writeStoredSeekerProfile,
} from '../clientContext';

describe('client seeker context helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads and writes normalized seeker profiles', () => {
    writeStoredSeekerProfile({
      serviceInterests: ['food_assistance'],
      profileHeadline: 'Parent seeking support',
    });

    expect(localStorage.getItem(SEEKER_PROFILE_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...EMPTY_SEEKER_PROFILE,
        serviceInterests: ['food_assistance'],
        profileHeadline: 'Parent seeking support',
      }),
    );
    expect(readStoredSeekerProfile()).toEqual({
      ...EMPTY_SEEKER_PROFILE,
      serviceInterests: ['food_assistance'],
      profileHeadline: 'Parent seeking support',
    });
  });

  it('falls back to an empty seeker profile when storage is malformed', () => {
    localStorage.setItem(SEEKER_PROFILE_STORAGE_KEY, '{bad-json');

    expect(readStoredSeekerProfile()).toEqual({ ...EMPTY_SEEKER_PROFILE });
  });

  it('emits seeker-profile updates for same-tab listeners', () => {
    const handler = vi.fn();
    window.addEventListener(SEEKER_PROFILE_UPDATED_EVENT, handler as EventListener);

    writeStoredSeekerProfile({ serviceInterests: ['food_assistance'] });
    emitStoredSeekerProfileUpdated({ profileHeadline: 'Need help today' });
    clearStoredSeekerProfile();

    expect(handler).toHaveBeenCalledTimes(3);
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      profile: { ...EMPTY_SEEKER_PROFILE, serviceInterests: ['food_assistance'] },
    });
    expect((handler.mock.calls[1]?.[0] as CustomEvent).detail).toEqual({
      profile: { ...EMPTY_SEEKER_PROFILE, profileHeadline: 'Need help today' },
    });
    expect((handler.mock.calls[2]?.[0] as CustomEvent).detail).toEqual({
      profile: { ...EMPTY_SEEKER_PROFILE },
    });

    window.removeEventListener(SEEKER_PROFILE_UPDATED_EVENT, handler as EventListener);
  });
});
