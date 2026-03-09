import { z } from 'zod';

export const PROFILE_PREFERENCES_STORAGE_KEY = 'oran:preferences';
export const PROFILE_PREFERENCES_UPDATED_EVENT = 'oran:profile-preferences-updated';

export const ProfilePreferencesSchema = z.object({
  approximateCity: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
  serverSyncEnabled: z.boolean().optional(),
});

export type ProfilePreferences = z.infer<typeof ProfilePreferencesSchema>;

export interface ProfilePreferencesUpdatedDetail {
  preferences: ProfilePreferences;
}

export function normalizeProfilePreferences(
  prefs: Partial<ProfilePreferences> | null | undefined,
): ProfilePreferences {
  const parsed = ProfilePreferencesSchema.safeParse(prefs ?? {});
  return parsed.success ? parsed.data : {};
}

export function readStoredProfilePreferences(): ProfilePreferences {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(PROFILE_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    return normalizeProfilePreferences(JSON.parse(raw) as ProfilePreferences);
  } catch {
    return {};
  }
}

export function writeStoredProfilePreferences(prefs: Partial<ProfilePreferences>) {
  if (typeof window === 'undefined') return;

  try {
    const normalized = normalizeProfilePreferences(prefs);
    localStorage.setItem(
      PROFILE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    emitStoredProfilePreferencesUpdated(normalized);
  } catch {
    // Ignore storage quota and serialization failures.
  }
}

export function emitStoredProfilePreferencesUpdated(prefs: Partial<ProfilePreferences>) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<ProfilePreferencesUpdatedDetail>(PROFILE_PREFERENCES_UPDATED_EVENT, {
      detail: {
        preferences: normalizeProfilePreferences(prefs),
      },
    }),
  );
}

export function clearStoredProfilePreferences() {
  if (typeof window === 'undefined') return;

  localStorage.removeItem(PROFILE_PREFERENCES_STORAGE_KEY);
  emitStoredProfilePreferencesUpdated({});
}

export function resolveProfileSyncConsent(
  prefs: Partial<ProfilePreferences> | null | undefined,
  hasMeaningfulServerProfile: boolean,
): boolean {
  const normalized = normalizeProfilePreferences(prefs);
  return normalized.serverSyncEnabled ?? hasMeaningfulServerProfile;
}

export function isServerSyncEnabledOnDevice(): boolean {
  return readStoredProfilePreferences().serverSyncEnabled === true;
}
