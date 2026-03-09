'use client';

export const SAVED_SERVICE_STORAGE_KEY = 'oran:saved-service-ids';
export const SAVED_SERVICES_UPDATED_EVENT = 'oran:saved-services-updated';

export interface SavedServicesUpdatedDetail {
  ids: string[];
  count: number;
}

export function readStoredSavedServiceIds(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(SAVED_SERVICE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function readStoredSavedServiceIdSet(): Set<string> {
  return new Set(readStoredSavedServiceIds());
}

export function readStoredSavedServiceCount(): number {
  return readStoredSavedServiceIds().length;
}

export function emitSavedServicesUpdated(ids: string[]): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<SavedServicesUpdatedDetail>(SAVED_SERVICES_UPDATED_EVENT, {
      detail: {
        ids,
        count: ids.length,
      },
    }),
  );
}

export function writeStoredSavedServiceIds(ids: Iterable<string>): void {
  if (typeof window === 'undefined') return;

  try {
    const normalized = [...ids];
    localStorage.setItem(SAVED_SERVICE_STORAGE_KEY, JSON.stringify(normalized));
    emitSavedServicesUpdated(normalized);
  } catch {
    // Ignore quota and serialization errors.
  }
}

export async function fetchServerSavedIds(): Promise<string[] | null> {
  try {
    const res = await fetch('/api/saved', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.status === 401) {
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as { savedIds?: unknown };
    return Array.isArray(json.savedIds)
      ? json.savedIds.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return null;
  }
}

export async function addServerSaved(serviceId: string): Promise<void> {
  try {
    await fetch('/api/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort only.
  }
}

export async function removeServerSaved(serviceId: string): Promise<void> {
  try {
    await fetch('/api/saved', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort only.
  }
}
