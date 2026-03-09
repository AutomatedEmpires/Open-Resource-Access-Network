import type { DiscoveryLinkState } from '@/services/search/discovery';

import { normalizeSeekerProfile } from './contracts';
import { buildSeekerDiscoveryProfile } from './discoveryProfile';

export const SEEKER_CONTEXT_STORAGE_KEY = 'oran:seeker-context';

export function readStoredDiscoveryPreference(): DiscoveryLinkState {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(SEEKER_CONTEXT_STORAGE_KEY);
    if (!raw) return {};
    const profile = normalizeSeekerProfile(JSON.parse(raw) as Record<string, unknown>);
    return buildSeekerDiscoveryProfile(profile).browseState;
  } catch {
    return {};
  }
}

export function readStoredPrimaryDiscoveryNeed() {
  return readStoredDiscoveryPreference().needId ?? null;
}
