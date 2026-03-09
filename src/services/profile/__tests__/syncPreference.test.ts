// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  clearStoredProfilePreferences,
  emitStoredProfilePreferencesUpdated,
  normalizeProfilePreferences,
  PROFILE_PREFERENCES_UPDATED_EVENT,
  readStoredProfilePreferences,
  resolveProfileSyncConsent,
  writeStoredProfilePreferences,
  PROFILE_PREFERENCES_STORAGE_KEY,
} from '../syncPreference';

describe('profile sync preference helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes invalid preference payloads to an empty object', () => {
    expect(normalizeProfilePreferences({ approximateCity: 'A'.repeat(101) })).toEqual({});
  });

  it('reads and writes normalized stored preferences', () => {
    writeStoredProfilePreferences({
      approximateCity: 'Seattle',
      language: 'es',
      serverSyncEnabled: true,
    });

    expect(localStorage.getItem(PROFILE_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({
        approximateCity: 'Seattle',
        language: 'es',
        serverSyncEnabled: true,
      }),
    );
    expect(readStoredProfilePreferences()).toEqual({
      approximateCity: 'Seattle',
      language: 'es',
      serverSyncEnabled: true,
    });
  });

  it('emits profile-preference updates for same-tab listeners', () => {
    const handler = vi.fn();
    window.addEventListener(PROFILE_PREFERENCES_UPDATED_EVENT, handler as EventListener);

    writeStoredProfilePreferences({ approximateCity: 'Seattle', serverSyncEnabled: true });
    emitStoredProfilePreferencesUpdated({ language: 'es' });
    clearStoredProfilePreferences();

    expect(handler).toHaveBeenCalledTimes(3);
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      preferences: {
        approximateCity: 'Seattle',
        serverSyncEnabled: true,
      },
    });
    expect((handler.mock.calls[1]?.[0] as CustomEvent).detail).toEqual({
      preferences: {
        language: 'es',
      },
    });
    expect((handler.mock.calls[2]?.[0] as CustomEvent).detail).toEqual({
      preferences: {},
    });

    window.removeEventListener(PROFILE_PREFERENCES_UPDATED_EVENT, handler as EventListener);
  });

  it('falls back to empty preferences when storage is malformed', () => {
    localStorage.setItem(PROFILE_PREFERENCES_STORAGE_KEY, '{not-json');
    expect(readStoredProfilePreferences()).toEqual({});
  });

  it('resolves consent from explicit preference first and otherwise from meaningful server data', () => {
    expect(resolveProfileSyncConsent({ serverSyncEnabled: false }, true)).toBe(false);
    expect(resolveProfileSyncConsent({}, true)).toBe(true);
    expect(resolveProfileSyncConsent({}, false)).toBe(false);
  });
});
