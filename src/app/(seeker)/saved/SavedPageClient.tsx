/**
 * Saved Services Page
 *
 * Privacy-first: saves are local-only (localStorage) until the user
 * explicitly signs in and consents to server-side bookmarks.
 * No data leaves the device without consent.
 *
 * If sync is enabled on this device and the user is authenticated,
 * bookmarks also sync with /api/saved.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Search, Trash2, MessageCircle, MapPin, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { ServiceCard } from '@/components/directory/ServiceCard';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { EnrichedService } from '@/domain/types';
import { getDiscoveryNeedLabel, getPrimaryDiscoveryNeedId, type DiscoveryNeedId } from '@/domain/discoveryNeeds';
import { useToast } from '@/components/ui/toast';
import { buildDiscoveryHref } from '@/services/search/discovery';
import { buildServiceFallbackDiscoveryState } from '@/services/search/discoveryFromService';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  addServerSavedCollectionAssignment,
  createSavedCollection,
  createServerSavedCollection,
  deleteSavedCollection,
  deleteServerSavedCollection,
  fetchServerSavedIds,
  fetchServerSavedCollectionsState,
  mergeSavedCollectionsStates,
  readStoredSavedServiceIds,
  readStoredSavedCollectionsState,
  removeServerSavedCollectionAssignment,
  removeSavedServiceAssignments,
  renameSavedCollection,
  renameServerSavedCollection,
  removeServerSaved,
  toggleSavedServiceCollection,
  writeStoredSavedCollectionsState,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { getSavedTogglePresentation } from '@/services/saved/presentation';

// ============================================================
// SERVER-SIDE HELPERS (graceful fallback to localStorage)
// ============================================================

interface BatchServiceResponse {
  results: EnrichedService[];
  notFound?: string[];
}

interface SavedServiceGroup {
  id: string;
  label: string;
  services: EnrichedService[];
}

type SavedCollectionFilter = 'all' | 'unfiled' | string;

function resolveSavedGroupId(service: EnrichedService): DiscoveryNeedId | 'other' {
  const candidateTerms = [
    ...service.taxonomyTerms.map((term) => term.term),
    service.service.name,
    service.service.description ?? undefined,
    ...(service.organization.whoWeServe ? [service.organization.whoWeServe] : []),
  ];

  return getPrimaryDiscoveryNeedId(candidateTerms) ?? 'other';
}

function getSavedGroupLabel(groupId: DiscoveryNeedId | 'other'): string {
  return groupId === 'other' ? 'Other services' : `${getDiscoveryNeedLabel(groupId) ?? 'Other'} resources`;
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecentlyAdded(service: EnrichedService): boolean {
  const updatedAt = coerceDate(service.service.updatedAt);
  const createdAt = coerceDate(service.service.createdAt);
  const candidate = updatedAt ?? createdAt;
  if (!candidate) return false;
  return Date.now() - candidate.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

/** Fetch services by IDs from batch endpoint */
async function fetchServicesByIds(ids: string[]): Promise<{ services: EnrichedService[]; notFound: string[] }> {
  if (ids.length === 0) return { services: [], notFound: [] };

  const params = new URLSearchParams({ ids: ids.join(',') });

  const res = await fetch(`/api/services?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 400) {
      // Some or all IDs were invalid
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Invalid service IDs');
    }
    throw new Error('Failed to fetch services');
  }

  const json = (await res.json()) as BatchServiceResponse;
  return {
    services: json.results,
    notFound: json.notFound ?? [],
  };
}

// ============================================================
// PAGE
// ============================================================

export default function SavedPage() {
  const [savedIds, setSavedIds] = useState<string[]>(readStoredSavedServiceIds);
  const [savedCollectionsState, setSavedCollectionsState] = useState(() => readStoredSavedCollectionsState());
  const [discoveryPreference] = useState(() => readStoredDiscoveryPreference());
  const [serverSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const [services, setServices] = useState<EnrichedService[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [notFoundCount, setNotFoundCount] = useState(0);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collectionFilter, setCollectionFilter] = useState<SavedCollectionFilter>('all');
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState('');
  const [activeCollectionEditorServiceId, setActiveCollectionEditorServiceId] = useState<string | null>(null);
  const [collectionsStatus, setCollectionsStatus] = useState<'local' | 'syncing' | 'synced'>('local');
  const { success } = useToast();

  const chatHref = useMemo(() => buildDiscoveryHref('/chat', discoveryPreference), [discoveryPreference]);
  const directoryHref = useMemo(() => buildDiscoveryHref('/directory', discoveryPreference), [discoveryPreference]);
  const mapHref = useMemo(() => buildDiscoveryHref('/map', discoveryPreference), [discoveryPreference]);
  const buildSavedServiceHref = useCallback((service: EnrichedService) => {
    return buildDiscoveryHref(`/service/${service.service.id}`, {
      ...discoveryPreference,
      ...buildServiceFallbackDiscoveryState(service),
    });
  }, [discoveryPreference]);

  // Fetch details for saved IDs on mount and when IDs change
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      setNotFoundCount(0);

      try {
        const localIds = readStoredSavedServiceIds();
        const localCollectionsState = readStoredSavedCollectionsState();
        let mergedIds: string[];

        if (serverSyncEnabled) {
          setCollectionsStatus('syncing');
          const serverIds = await fetchServerSavedIds();
          const serverCollectionsState = await fetchServerSavedCollectionsState();

          if (serverIds !== null) {
            const localOnly = localIds.filter((id) => !serverIds.includes(id));
            for (const id of localOnly) {
              await addServerSaved(id);
            }
            mergedIds = [...new Set([...serverIds, ...localOnly])];
            writeStoredSavedServiceIds(mergedIds);
            setSavedIds(mergedIds);
          } else {
            mergedIds = localIds;
          }

          if (serverCollectionsState !== null) {
            const syncedCollectionsByName = new Map(
              serverCollectionsState.collections.map((collection) => [collection.name.trim().toLowerCase(), collection]),
            );

            for (const collection of localCollectionsState.collections) {
              const key = collection.name.trim().toLowerCase();
              if (!syncedCollectionsByName.has(key)) {
                const created = await createServerSavedCollection(collection.name);
                if (created) {
                  syncedCollectionsByName.set(key, created);
                }
              }
            }

            for (const [serviceId, collectionIds] of Object.entries(localCollectionsState.serviceAssignments)) {
              for (const localCollectionId of collectionIds) {
                const localCollection = localCollectionsState.collections.find((collection) => collection.id === localCollectionId);
                if (!localCollection) continue;
                const serverCollection = syncedCollectionsByName.get(localCollection.name.trim().toLowerCase());
                if (!serverCollection) continue;
                await addServerSavedCollectionAssignment(serverCollection.id, serviceId);
              }
            }

            const refreshedServerCollectionsState = await fetchServerSavedCollectionsState();
            if (refreshedServerCollectionsState) {
              const mergedCollectionsState = mergeSavedCollectionsStates(refreshedServerCollectionsState, localCollectionsState);
              writeStoredSavedCollectionsState(mergedCollectionsState);
              if (!cancelled) {
                setSavedCollectionsState(mergedCollectionsState);
                setCollectionsStatus('synced');
              }
            } else if (!cancelled) {
              setCollectionsStatus('local');
            }
          } else if (!cancelled) {
            setCollectionsStatus('local');
          }
        } else {
          mergedIds = localIds;
          setSavedCollectionsState(localCollectionsState);
          setCollectionsStatus('local');
        }

        if (cancelled) return;

        if (mergedIds.length === 0) {
          setServices([]);
          setIsLoading(false);
          return;
        }

        // Fetch services by IDs using batch endpoint
        const { services: fetchedServices, notFound } = await fetchServicesByIds(mergedIds);

        if (cancelled) return;

        setServices(fetchedServices);
        setNotFoundCount(notFound.length);

        // If some IDs were not found, clean them from saved IDs
        if (notFound.length > 0) {
          const validIds = mergedIds.filter((id) => !notFound.includes(id));
          writeStoredSavedServiceIds(validIds);
          setSavedIds(validIds);
          let nextCollectionsState = readStoredSavedCollectionsState();
          for (const missingId of notFound) {
            nextCollectionsState = removeSavedServiceAssignments(missingId);
          }
          setSavedCollectionsState(nextCollectionsState);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load saved services');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverSyncEnabled]);

  const removeService = useCallback((serviceId: string) => {
    const toggleCopy = getSavedTogglePresentation(true, serverSyncEnabled);
    setSavedIds((prev) => {
      const next = prev.filter((id) => id !== serviceId);
      writeStoredSavedServiceIds(next);
      return next;
    });
    setServices((prev) => prev.filter((s) => s.service.id !== serviceId));
    setSavedCollectionsState(removeSavedServiceAssignments(serviceId));
    if (serverSyncEnabled) {
      void removeServerSaved(serviceId);
    }
    success(toggleCopy.toastMessage);
  }, [serverSyncEnabled, success]);

  const clearAll = useCallback(() => {
    writeStoredSavedServiceIds([]);
    const nextCollectionsState = {
      ...readStoredSavedCollectionsState(),
      serviceAssignments: {},
    };
    writeStoredSavedCollectionsState(nextCollectionsState);
    setSavedIds([]);
    setServices([]);
    setSavedCollectionsState(nextCollectionsState);
    setShowClearConfirm(false);
    if (serverSyncEnabled) {
      savedIds.forEach((id) => void removeServerSaved(id));
    }
  }, [savedIds, serverSyncEnabled]);

  const isEmpty = useMemo(() => savedIds.length === 0, [savedIds]);
  const collectionsById = useMemo(
    () => Object.fromEntries(savedCollectionsState.collections.map((collection) => [collection.id, collection])),
    [savedCollectionsState.collections],
  );
  const unfiledCount = useMemo(
    () => services.filter((service) => (savedCollectionsState.serviceAssignments[service.service.id] ?? []).length === 0).length,
    [savedCollectionsState.serviceAssignments, services],
  );
  const savedGroups = useMemo<SavedServiceGroup[]>(() => {
    const grouped = new Map<string, SavedServiceGroup>();

    for (const savedService of services) {
      const assignedCollections = savedCollectionsState.serviceAssignments[savedService.service.id] ?? [];
      if (collectionFilter === 'unfiled' && assignedCollections.length > 0) {
        continue;
      }
      if (collectionFilter !== 'all' && collectionFilter !== 'unfiled' && !assignedCollections.includes(collectionFilter)) {
        continue;
      }

      const groupId = resolveSavedGroupId(savedService);
      const existing = grouped.get(groupId);
      if (existing) {
        existing.services.push(savedService);
      } else {
        grouped.set(groupId, {
          id: groupId,
          label: getSavedGroupLabel(groupId),
          services: [savedService],
        });
      }
    }

    return Array.from(grouped.values()).sort((left, right) => right.services.length - left.services.length || left.label.localeCompare(right.label));
  }, [collectionFilter, savedCollectionsState.serviceAssignments, services]);

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const service of services) {
      const assignedCollections = savedCollectionsState.serviceAssignments[service.service.id] ?? [];
      for (const collectionId of assignedCollections) {
        counts.set(collectionId, (counts.get(collectionId) ?? 0) + 1);
      }
    }
    return counts;
  }, [savedCollectionsState.serviceAssignments, services]);

  const handleCreateCollection = useCallback(() => {
    void (async () => {
      const created = createSavedCollection(newCollectionName);
      if (!created) return;

      let nextState = readStoredSavedCollectionsState();
      if (serverSyncEnabled) {
        const serverCollection = await createServerSavedCollection(created.name);
        if (serverCollection) {
          nextState = {
            ...nextState,
            collections: nextState.collections.map((collection) => (
              collection.id === created.id ? serverCollection : collection
            )),
            serviceAssignments: Object.fromEntries(
              Object.entries(nextState.serviceAssignments).map(([serviceId, collectionIds]) => [
                serviceId,
                collectionIds.map((collectionId) => (collectionId === created.id ? serverCollection.id : collectionId)),
              ]),
            ),
          };
          writeStoredSavedCollectionsState(nextState);
        }
      }

      setSavedCollectionsState(nextState);
      setNewCollectionName('');
      setCollectionFilter(serverSyncEnabled && nextState.collections.some((collection) => collection.name === created.name)
        ? nextState.collections.find((collection) => collection.name === created.name)?.id ?? created.id
        : created.id);
      success(`Created ${created.name}`);
    })();
  }, [newCollectionName, serverSyncEnabled, success]);

  const handleToggleCollection = useCallback((serviceId: string, collectionId: string) => {
    void (async () => {
      const assignedBefore = (savedCollectionsState.serviceAssignments[serviceId] ?? []).includes(collectionId);
      const nextState = toggleSavedServiceCollection(serviceId, collectionId);
      setSavedCollectionsState(nextState);

      if (serverSyncEnabled) {
        if (assignedBefore) {
          await removeServerSavedCollectionAssignment(collectionId, serviceId);
        } else {
          await addServerSavedCollectionAssignment(collectionId, serviceId);
        }
      }
    })();
  }, [savedCollectionsState.serviceAssignments, serverSyncEnabled]);

  const handleDeleteCollection = useCallback((collectionId: string) => {
    const collectionName = collectionsById[collectionId]?.name ?? 'collection';
    deleteSavedCollection(collectionId);
    setSavedCollectionsState(readStoredSavedCollectionsState());
    setCollectionFilter((current) => (current === collectionId ? 'all' : current));
    setEditingCollectionId(null);
    setEditingCollectionName('');
    setActiveCollectionEditorServiceId((current) => current);
    if (serverSyncEnabled) {
      void deleteServerSavedCollection(collectionId);
    }
    success(`Removed ${collectionName}`);
  }, [collectionsById, serverSyncEnabled, success]);

  const handleRenameCollection = useCallback((collectionId: string) => {
    void (async () => {
      const renamed = renameSavedCollection(collectionId, editingCollectionName);
      if (!renamed) return;

      let nextState = readStoredSavedCollectionsState();
      if (serverSyncEnabled) {
        const serverCollection = await renameServerSavedCollection(collectionId, renamed.name);
        if (serverCollection) {
          nextState = {
            ...nextState,
            collections: nextState.collections.map((collection) => (
              collection.id === collectionId ? serverCollection : collection
            )),
          };
          writeStoredSavedCollectionsState(nextState);
        }
      }

      setSavedCollectionsState(nextState);
      setEditingCollectionId(null);
      setEditingCollectionName('');
      success(`Renamed to ${renamed.name}`);
    })();
  }, [editingCollectionName, serverSyncEnabled, success]);

  return (
    <main className="min-h-screen bg-white">
      <div className="container mx-auto max-w-7xl px-4 pt-4 pb-8 md:py-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <section className="rounded-[30px] border border-slate-200 bg-white p-4 shadow-sm md:p-8">
            <PageHeader
              eyebrow="Your seeker workspace"
              title="Saved Services"
              icon={<Bookmark className="h-6 w-6" aria-hidden="true" />}
              subtitle={
                serverSyncEnabled
                  ? 'Bookmarks on this device can sync to your account when you are signed in.'
                  : 'Bookmarks stay on this device until you turn on cross-device sync in Profile.'
              }
              badges={(
                <>
                  <PageHeaderBadge tone="accent">
                    {serverSyncEnabled ? 'Cross-device sync allowed' : 'Stored on this device'}
                  </PageHeaderBadge>
                  <PageHeaderBadge tone="trust">
                    {serverSyncEnabled ? 'Sync ready after sign-in' : 'Sync off on this device'}
                  </PageHeaderBadge>
                  {savedIds.length > 0 ? <PageHeaderBadge>{savedIds.length > 99 ? '99+' : savedIds.length} saved</PageHeaderBadge> : null}
                </>
              )}
              actions={
                savedIds.length > 0 ? (
                  !showClearConfirm ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowClearConfirm(true)}
                      className="gap-1.5 border-error-soft text-error-base hover:bg-error-subtle"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Clear all
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={clearAll}
                        className="gap-1.5 bg-error-base text-white hover:bg-error-strong"
                      >
                        Confirm
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowClearConfirm(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )
                ) : undefined
              }
            />

            <ErrorBoundary>
              <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] md:p-5">
        {!isLoading && savedIds.length > 0 && (
          <div className="mb-5 rounded-[22px] border border-slate-200 bg-white/80 p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Collections</p>
                <h2 className="mt-1 text-sm font-semibold text-stone-900">Organize saved services your way</h2>
                <p className="mt-1 text-sm text-stone-600">
                  {serverSyncEnabled
                    ? collectionsStatus === 'synced'
                      ? 'Collections are syncing to your signed-in account.'
                      : 'Collections are syncing when your account is available.'
                    : 'Collections stay on this device, just like your default saved list.'}
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row md:max-w-md">
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                  placeholder="Create a collection"
                  className="h-10 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-stone-900 shadow-sm outline-none transition focus:border-stone-400"
                />
                <Button type="button" size="sm" onClick={handleCreateCollection} disabled={!newCollectionName.trim()}>
                  Add collection
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCollectionFilter('all')}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  collectionFilter === 'all'
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-slate-200 bg-white text-stone-700 hover:border-stone-300'
                }`}
              >
                All saved · {services.length}
              </button>
              <button
                type="button"
                onClick={() => setCollectionFilter('unfiled')}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  collectionFilter === 'unfiled'
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-slate-200 bg-white text-stone-700 hover:border-stone-300'
                }`}
              >
                Unfiled · {unfiledCount}
              </button>
              {savedCollectionsState.collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => setCollectionFilter(collection.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    collectionFilter === collection.id
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-slate-200 bg-white text-stone-700 hover:border-stone-300'
                  }`}
                >
                  {collection.name} · {collectionCounts.get(collection.id) ?? 0}
                </button>
              ))}
            </div>

            {savedCollectionsState.collections.length > 0 && (
              <div className="mt-4 space-y-2">
                {savedCollectionsState.collections.map((collection) => (
                  <div key={collection.id} className="flex flex-col gap-2 rounded-[18px] border border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                    {editingCollectionId === collection.id ? (
                      <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          value={editingCollectionName}
                          onChange={(event) => setEditingCollectionName(event.target.value)}
                          className="h-9 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-stone-900 outline-none transition focus:border-stone-400"
                        />
                        <div className="flex gap-2">
                          <Button type="button" size="sm" onClick={() => handleRenameCollection(collection.id)} disabled={!editingCollectionName.trim()}>
                            Save
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => {
                            setEditingCollectionId(null);
                            setEditingCollectionName('');
                          }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="text-sm font-semibold text-stone-900">{collection.name}</p>
                          <p className="text-xs text-stone-500">{collectionCounts.get(collection.id) ?? 0} saved service{(collectionCounts.get(collection.id) ?? 0) === 1 ? '' : 's'}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => {
                            setEditingCollectionId(collection.id);
                            setEditingCollectionName(collection.name);
                          }}>
                            Rename
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => handleDeleteCollection(collection.id)}>
                            Delete
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-[20px] border border-error-soft bg-error-subtle p-4 text-sm text-error-deep shadow-[0_12px_32px_rgba(127,29,29,0.08)]"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            role="status"
            aria-busy="true"
            aria-label="Loading saved services"
          >
            {Array.from({ length: Math.min(savedIds.length, 4) }).map((_, i) => (
              <SkeletonCard key={`saved-skeleton-${i}`} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && isEmpty && (
          <div className="rounded-[24px] border border-orange-100 bg-gradient-to-br from-white via-orange-50/70 to-rose-50/60 p-10 text-center shadow-[0_18px_50px_rgba(234,88,12,0.06)]">
            <Bookmark className="mx-auto mb-4 h-12 w-12 text-orange-200" aria-hidden="true" />
            <p className="mb-1 text-base font-semibold text-stone-800">No saved services yet</p>
            <p className="mx-auto mb-6 max-w-xs text-sm text-stone-500">
              {serverSyncEnabled
                ? 'Bookmark services to access them quickly. Saves on this device can sync to your account when you sign in.'
                : 'Bookmark services to access them quickly. Saves stay on this device.'}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <Link href={chatHref}>
                <Button size="sm" className="gap-1.5 w-full sm:w-auto">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Open Chat
                </Button>
              </Link>
              <Link href={directoryHref}>
                <Button variant="outline" size="sm" className="gap-1.5 w-full sm:w-auto">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Browse directory
                </Button>
              </Link>
              <Link href={mapHref}>
                <Button variant="outline" size="sm" className="gap-1.5 w-full sm:w-auto">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Map view
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Results */}
        {!isLoading && services.length > 0 && (
          <div className="space-y-4">
            <p className="rounded-[20px] border border-orange-100 bg-white/80 px-4 py-3 text-sm font-medium text-stone-700 shadow-[0_10px_30px_rgba(234,88,12,0.04)]" role="status" aria-live="polite">
              {savedGroups.reduce((count, group) => count + group.services.length, 0)} saved service{savedGroups.reduce((count, group) => count + group.services.length, 0) !== 1 ? 's' : ''}
            </p>
            {savedGroups.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {savedGroups.map((group) => (
                  <span
                    key={group.id}
                    className="inline-flex items-center rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-xs font-medium text-stone-700"
                  >
                    {group.label} · {group.services.length}
                  </span>
                ))}
              </div>
            )}
            {notFoundCount > 0 && (
              <div className="flex items-start gap-2 rounded-[20px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-[0_10px_30px_rgba(120,53,15,0.08)]">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <p>{notFoundCount} saved service{notFoundCount > 1 ? 's' : ''} could not be loaded (may no longer be available).</p>
              </div>
            )}
            <div className="space-y-6">
              {savedGroups.map((group) => (
                <section key={group.id} className="space-y-3" aria-label={group.label}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-stone-900">{group.label}</h2>
                      <p className="text-xs text-stone-500">{group.services.length} saved</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {group.services.map((s) => (
                      <div key={s.service.id} className="space-y-2">
                        {isRecentlyAdded(s) && (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                            New this week
                          </span>
                        )}
                        <div className="rounded-[20px] border border-slate-200 bg-white/70 p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Collections</p>
                              <p className="mt-1 text-xs text-stone-600">
                                {(savedCollectionsState.serviceAssignments[s.service.id] ?? []).length > 0
                                  ? (savedCollectionsState.serviceAssignments[s.service.id] ?? [])
                                      .map((collectionId) => collectionsById[collectionId]?.name)
                                      .filter(Boolean)
                                      .join(', ')
                                  : 'Unfiled'}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setActiveCollectionEditorServiceId((current) => current === s.service.id ? null : s.service.id)}
                            >
                              {activeCollectionEditorServiceId === s.service.id ? 'Done' : 'Manage'}
                            </Button>
                          </div>
                          {activeCollectionEditorServiceId === s.service.id && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {savedCollectionsState.collections.length > 0 ? (
                                savedCollectionsState.collections.map((collection) => {
                                  const assigned = (savedCollectionsState.serviceAssignments[s.service.id] ?? []).includes(collection.id);
                                  return (
                                    <button
                                      key={collection.id}
                                      type="button"
                                      onClick={() => handleToggleCollection(s.service.id, collection.id)}
                                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                        assigned
                                          ? 'border-stone-900 bg-stone-900 text-white'
                                          : 'border-slate-200 bg-white text-stone-700 hover:border-stone-300'
                                      }`}
                                    >
                                      {assigned ? 'Remove' : 'Add'} {collection.name}
                                    </button>
                                  );
                                })
                              ) : (
                                <span className="text-xs text-stone-500">Create a collection above to organize this saved service.</span>
                              )}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(savedCollectionsState.serviceAssignments[s.service.id] ?? []).map((collectionId) => {
                              const collection = collectionsById[collectionId];
                              if (!collection) return null;
                              return (
                                <span
                                  key={collectionId}
                                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-stone-700"
                                >
                                  {collection.name}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <ServiceCard
                          enriched={s}
                          href={buildSavedServiceHref(s)}
                          isSaved
                          onToggleSave={removeService}
                          savedSyncEnabled={serverSyncEnabled}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {/* Saved IDs with no matching services (could not fetch details) */}
        {!isLoading && !isEmpty && services.length === 0 && !error && (
          <div className="rounded-[24px] border border-orange-100 bg-gradient-to-br from-white to-orange-50/60 p-8 text-center shadow-[0_18px_50px_rgba(234,88,12,0.06)]">
            <p className="mb-1 font-medium text-stone-700">
              {savedIds.length} service{savedIds.length > 1 ? 's' : ''} saved
            </p>
            <p className="text-sm text-stone-500">
              Details could not be loaded. The services may no longer be available, or the database is not connected.
            </p>
          </div>
        )}
              </div>
            </ErrorBoundary>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-700">Saved flow</p>
              <h2 className="mt-2 text-lg font-semibold text-stone-900">Keep promising options close</h2>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-stone-600">
                <li>Saved items stay grounded in verified service records only.</li>
                <li>You can jump back into Chat, Directory, or Map from the same seeker context.</li>
                <li>Clear-all confirmation stays device-safe and explicit.</li>
              </ul>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Sync behavior</p>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                Saves remain local unless cross-device sync is enabled on this device and you are signed in. That keeps the default behavior private and predictable.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
