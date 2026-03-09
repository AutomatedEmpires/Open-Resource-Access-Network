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
import { useToast } from '@/components/ui/toast';
import { buildDiscoveryHref } from '@/services/search/discovery';
import { buildServiceFallbackDiscoveryState } from '@/services/search/discoveryFromService';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  fetchServerSavedIds,
  readStoredSavedServiceIds,
  removeServerSaved,
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
  const [discoveryPreference] = useState(() => readStoredDiscoveryPreference());
  const [serverSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const [services, setServices] = useState<EnrichedService[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [notFoundCount, setNotFoundCount] = useState(0);
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
        let mergedIds: string[];

        if (serverSyncEnabled) {
          const serverIds = await fetchServerSavedIds();

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
        } else {
          mergedIds = localIds;
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
    if (serverSyncEnabled) {
      void removeServerSaved(serviceId);
    }
    success(toggleCopy.toastMessage);
  }, [serverSyncEnabled, success]);

  const clearAll = useCallback(() => {
    writeStoredSavedServiceIds([]);
    setSavedIds([]);
    setServices([]);
    setShowClearConfirm(false);
    if (serverSyncEnabled) {
      savedIds.forEach((id) => void removeServerSaved(id));
    }
  }, [savedIds, serverSyncEnabled]);

  const isEmpty = useMemo(() => savedIds.length === 0, [savedIds]);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
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
                className="gap-1.5 text-error-base border-error-soft hover:bg-error-subtle"
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
                  className="bg-error-base hover:bg-error-strong text-white gap-1.5"
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
        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-deep"
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
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
            <Bookmark className="h-12 w-12 mx-auto text-gray-200 mb-4" aria-hidden="true" />
            <p className="text-gray-800 font-semibold text-base mb-1">No saved services yet</p>
            <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
              {serverSyncEnabled
                ? 'Bookmark services to access them quickly. Saves on this device can sync to your account when you sign in.'
                : 'Bookmark services to access them quickly. Saves stay on this device.'}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <Link href={chatHref}>
                <Button size="sm" className="gap-1.5 w-full sm:w-auto">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Find services via Chat
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
            <p className="text-sm font-medium text-gray-700" role="status" aria-live="polite">
              {services.length} saved service{services.length !== 1 ? 's' : ''}
            </p>
            {notFoundCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <p>{notFoundCount} saved service{notFoundCount > 1 ? 's' : ''} could not be loaded (may no longer be available).</p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {services.map((s) => (
                <ServiceCard
                  key={s.service.id}
                  enriched={s}
                  href={buildSavedServiceHref(s)}
                  isSaved
                  onToggleSave={removeService}
                  savedSyncEnabled={serverSyncEnabled}
                />
              ))}
            </div>
          </div>
        )}

        {/* Saved IDs with no matching services (could not fetch details) */}
        {!isLoading && !isEmpty && services.length === 0 && !error && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-700 font-medium mb-1">
              {savedIds.length} service{savedIds.length > 1 ? 's' : ''} saved
            </p>
            <p className="text-sm text-gray-500">
              Details could not be loaded. The services may no longer be available, or the database is not connected.
            </p>
          </div>
        )}
      </ErrorBoundary>
    </main>
  );
}
