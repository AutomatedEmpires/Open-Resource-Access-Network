'use client';

import {
  EMPTY_SEEKER_PROFILE,
  normalizeSeekerProfile,
  type SeekerProfile,
} from '@/services/profile/contracts';

export const SEEKER_PROFILE_STORAGE_KEY = 'oran:seeker-context';
export const SEEKER_PROFILE_UPDATED_EVENT = 'oran:seeker-profile-updated';

export interface SeekerProfileUpdatedDetail {
  profile: SeekerProfile;
}

export function readStoredSeekerProfile(): SeekerProfile {
  if (typeof window === 'undefined') {
    return { ...EMPTY_SEEKER_PROFILE };
  }

  try {
    const raw = localStorage.getItem(SEEKER_PROFILE_STORAGE_KEY);
    if (!raw) return { ...EMPTY_SEEKER_PROFILE };
    return normalizeSeekerProfile(JSON.parse(raw) as SeekerProfile);
  } catch {
    return { ...EMPTY_SEEKER_PROFILE };
  }
}

export function emitStoredSeekerProfileUpdated(profile: Partial<SeekerProfile>): void {
  if (typeof window === 'undefined') return;

  const normalized = normalizeSeekerProfile(profile);

  window.dispatchEvent(
    new CustomEvent<SeekerProfileUpdatedDetail>(SEEKER_PROFILE_UPDATED_EVENT, {
      detail: { profile: normalized },
    }),
  );
}

export function writeStoredSeekerProfile(profile: Partial<SeekerProfile>): void {
  if (typeof window === 'undefined') return;

  const normalized = normalizeSeekerProfile(profile);

  try {
    localStorage.setItem(SEEKER_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
    emitStoredSeekerProfileUpdated(normalized);
  } catch {
    // Ignore quota and serialization errors.
  }
}

export function clearStoredSeekerProfile(): void {
  if (typeof window === 'undefined') return;

  localStorage.removeItem(SEEKER_PROFILE_STORAGE_KEY);
  emitStoredSeekerProfileUpdated({ ...EMPTY_SEEKER_PROFILE });
}
