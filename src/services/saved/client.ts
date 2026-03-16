'use client';

export const SAVED_SERVICE_STORAGE_KEY = 'oran:saved-service-ids';
export const SAVED_SERVICES_UPDATED_EVENT = 'oran:saved-services-updated';
export const SAVED_COLLECTIONS_STORAGE_KEY = 'oran:saved-collections';

export interface SavedServicesUpdatedDetail {
  ids: string[];
  count: number;
}

export interface SavedCollection {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SavedCollectionsState {
  collections: SavedCollection[];
  serviceAssignments: Record<string, string[]>;
}

const EMPTY_SAVED_COLLECTIONS_STATE: SavedCollectionsState = {
  collections: [],
  serviceAssignments: {},
};

function normalizeSavedCollectionsState(value: unknown): SavedCollectionsState {
  if (!value || typeof value !== 'object') {
    return EMPTY_SAVED_COLLECTIONS_STATE;
  }

  const candidate = value as {
    collections?: unknown;
    serviceAssignments?: unknown;
  };

  const collections = Array.isArray(candidate.collections)
    ? candidate.collections.filter(
        (entry): entry is SavedCollection =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as SavedCollection).id === 'string' &&
          typeof (entry as SavedCollection).name === 'string' &&
          typeof (entry as SavedCollection).createdAt === 'string',
      )
    : [];

  const serviceAssignments =
    candidate.serviceAssignments && typeof candidate.serviceAssignments === 'object'
      ? Object.fromEntries(
          Object.entries(candidate.serviceAssignments).map(([serviceId, collectionIds]) => [
            serviceId,
            Array.isArray(collectionIds)
              ? collectionIds.filter((value): value is string => typeof value === 'string')
              : [],
          ]),
        )
      : {};

  return {
    collections,
    serviceAssignments,
  };
}

function createSavedCollectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `saved-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

export function readStoredSavedCollectionsState(): SavedCollectionsState {
  if (typeof window === 'undefined') return EMPTY_SAVED_COLLECTIONS_STATE;

  try {
    const raw = localStorage.getItem(SAVED_COLLECTIONS_STORAGE_KEY);
    if (!raw) return EMPTY_SAVED_COLLECTIONS_STATE;
    return normalizeSavedCollectionsState(JSON.parse(raw));
  } catch {
    return EMPTY_SAVED_COLLECTIONS_STATE;
  }
}

export function writeStoredSavedCollectionsState(state: SavedCollectionsState): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(SAVED_COLLECTIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota and serialization errors.
  }
}

export function createSavedCollection(name: string): SavedCollection | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const current = readStoredSavedCollectionsState();
  const duplicate = current.collections.some((collection) => collection.name.toLowerCase() === trimmed.toLowerCase());
  if (duplicate) return null;

  const collection: SavedCollection = {
    id: createSavedCollectionId(),
    name: trimmed,
    createdAt: new Date().toISOString(),
  };

  writeStoredSavedCollectionsState({
    ...current,
    collections: [...current.collections, collection],
  });

  return collection;
}

export function renameSavedCollection(collectionId: string, name: string): SavedCollection | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const current = readStoredSavedCollectionsState();
  const duplicate = current.collections.some(
    (collection) => collection.id !== collectionId && collection.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicate) return null;

  let updatedCollection: SavedCollection | null = null;
  const collections = current.collections.map((collection) => {
    if (collection.id !== collectionId) return collection;
    updatedCollection = { ...collection, name: trimmed };
    return updatedCollection;
  });

  if (!updatedCollection) return null;

  writeStoredSavedCollectionsState({
    ...current,
    collections,
  });

  return updatedCollection;
}

export function deleteSavedCollection(collectionId: string): void {
  const current = readStoredSavedCollectionsState();
  const collections = current.collections.filter((collection) => collection.id !== collectionId);
  const serviceAssignments = Object.fromEntries(
    Object.entries(current.serviceAssignments)
      .map(([serviceId, collectionIds]) => [
        serviceId,
        collectionIds.filter((assignedId) => assignedId !== collectionId),
      ])
      .filter(([, collectionIds]) => collectionIds.length > 0),
  );

  writeStoredSavedCollectionsState({ collections, serviceAssignments });
}

export function toggleSavedServiceCollection(serviceId: string, collectionId: string): SavedCollectionsState {
  const current = readStoredSavedCollectionsState();
  const existing = current.serviceAssignments[serviceId] ?? [];
  const nextAssignments = existing.includes(collectionId)
    ? existing.filter((assignedId) => assignedId !== collectionId)
    : [...existing, collectionId];

  const serviceAssignments = { ...current.serviceAssignments };
  if (nextAssignments.length === 0) {
    delete serviceAssignments[serviceId];
  } else {
    serviceAssignments[serviceId] = nextAssignments;
  }

  const nextState = {
    ...current,
    serviceAssignments,
  };
  writeStoredSavedCollectionsState(nextState);
  return nextState;
}

export function removeSavedServiceAssignments(serviceId: string): SavedCollectionsState {
  const current = readStoredSavedCollectionsState();
  if (!(serviceId in current.serviceAssignments)) {
    return current;
  }

  const serviceAssignments = { ...current.serviceAssignments };
  delete serviceAssignments[serviceId];
  const nextState = {
    ...current,
    serviceAssignments,
  };
  writeStoredSavedCollectionsState(nextState);
  return nextState;
}

export function mergeSavedCollectionsStates(
  baseState: SavedCollectionsState,
  incomingState: SavedCollectionsState,
): SavedCollectionsState {
  const collectionsByName = new Map<string, SavedCollection>();

  for (const collection of [...baseState.collections, ...incomingState.collections]) {
    const key = collection.name.trim().toLowerCase();
    const existing = collectionsByName.get(key);
    if (!existing) {
      collectionsByName.set(key, collection);
      continue;
    }

    collectionsByName.set(
      key,
      new Date(collection.createdAt).getTime() < new Date(existing.createdAt).getTime() ? collection : existing,
    );
  }

  const nameByCollectionId = new Map<string, string>();
  for (const collection of baseState.collections) nameByCollectionId.set(collection.id, collection.name.trim().toLowerCase());
  for (const collection of incomingState.collections) nameByCollectionId.set(collection.id, collection.name.trim().toLowerCase());

  const canonicalCollectionByName = new Map<string, SavedCollection>();
  for (const collection of collectionsByName.values()) {
    canonicalCollectionByName.set(collection.name.trim().toLowerCase(), collection);
  }

  const serviceAssignments: Record<string, string[]> = {};
  for (const [serviceId, collectionIds] of Object.entries({
    ...baseState.serviceAssignments,
    ...incomingState.serviceAssignments,
  })) {
    const canonicalIds = new Set<string>();
    for (const collectionId of collectionIds) {
      const nameKey = nameByCollectionId.get(collectionId);
      if (!nameKey) continue;
      const canonical = canonicalCollectionByName.get(nameKey);
      if (canonical) canonicalIds.add(canonical.id);
    }
    if (canonicalIds.size > 0) {
      serviceAssignments[serviceId] = Array.from(canonicalIds);
    }
  }

  return {
    collections: Array.from(canonicalCollectionByName.values()).sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    ),
    serviceAssignments,
  };
}

export async function fetchServerSavedCollectionsState(): Promise<SavedCollectionsState | null> {
  try {
    const res = await fetch('/api/saved/collections', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.status === 401) return null;
    if (!res.ok) return null;

    const json = (await res.json()) as Partial<SavedCollectionsState>;
    return normalizeSavedCollectionsState(json);
  } catch {
    return null;
  }
}

export async function createServerSavedCollection(name: string): Promise<SavedCollection | null> {
  try {
    const res = await fetch('/api/saved/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { collection?: SavedCollection };
    return json.collection ?? null;
  } catch {
    return null;
  }
}

export async function renameServerSavedCollection(collectionId: string, name: string): Promise<SavedCollection | null> {
  try {
    const res = await fetch(`/api/saved/collections/${collectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { collection?: SavedCollection };
    return json.collection ?? null;
  } catch {
    return null;
  }
}

export async function deleteServerSavedCollection(collectionId: string): Promise<void> {
  try {
    await fetch(`/api/saved/collections/${collectionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // Best-effort only.
  }
}

export async function addServerSavedCollectionAssignment(collectionId: string, serviceId: string): Promise<void> {
  try {
    await fetch(`/api/saved/collections/${collectionId}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort only.
  }
}

export async function removeServerSavedCollectionAssignment(collectionId: string, serviceId: string): Promise<void> {
  try {
    await fetch(`/api/saved/collections/${collectionId}/services`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort only.
  }
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
