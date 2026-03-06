/**
 * Saved Services Page
 *
 * Privacy-first: saves are local-only (localStorage) until the user
 * explicitly signs in and consents to server-side bookmarks.
 * No data leaves the device without consent.
 *
 * If authenticated, syncs with server-side saved services via /api/saved.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Search, Trash2, MessageCircle, MapPin, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageHeader } from '@/components/ui/PageHeader';
import { ServiceCard } from '@/components/directory/ServiceCard';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { EnrichedService } from '@/domain/types';
import { useToast } from '@/components/ui/toast';

const STORAGE_KEY = 'oran:saved-service-ids';

// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================

function readSavedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeSavedIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* quota exceeded — fail silently */
  }
}

// ============================================================
// SERVER-SIDE HELPERS (graceful fallback to localStorage)
// ============================================================

interface BatchServiceResponse {
  results: EnrichedService[];
  notFound?: string[];
}

interface ServerSavedResponse {
  savedIds: string[];
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

/** Fetch server-side saved IDs (returns null if not authenticated) */
async function fetchServerSavedIds(): Promise<string[] | null> {
  try {
    const res = await fetch('/api/saved', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.status === 401) {
      // Not authenticated — that's okay, just use localStorage
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as ServerSavedResponse;
    return json.savedIds;
  } catch {
    return null;
  }
}

/** Remove a service from server-side saves (best-effort, no error handling) */
async function removeServerSaved(serviceId: string): Promise<void> {
  try {
    await fetch('/api/saved', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort, ignore errors
  }
}

// ============================================================
// PAGE
// ============================================================

export default function SavedPage() {
  const [savedIds, setSavedIds] = useState<string[]>(readSavedIds);
  const [services, setServices] = useState<EnrichedService[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [notFoundCount, setNotFoundCount] = useState(0);
  const { success } = useToast();

  // Fetch details for saved IDs on mount and when IDs change
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      setNotFoundCount(0);

      try {
        // First, merge server-side saved IDs (if authenticated)
        const serverIds = await fetchServerSavedIds();
        const localIds = readSavedIds();

        let mergedIds: string[];

        if (serverIds !== null) {
          // Authenticated: server is source of truth.
          // Push any local-only IDs to server, then use server set.
          const localOnly = localIds.filter((id) => !serverIds.includes(id));
          for (const id of localOnly) {
            try {
              await fetch('/api/user/saved', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serviceId: id }),
              });
            } catch { /* best-effort */ }
          }
          mergedIds = [...new Set([...serverIds, ...localOnly])];
          writeSavedIds(mergedIds);
          setSavedIds(mergedIds);
        } else {
          // Not authenticated: use localStorage only
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
          writeSavedIds(validIds);
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
  }, []); // Run once on mount

  const removeService = useCallback((serviceId: string) => {
    setSavedIds((prev) => {
      const next = prev.filter((id) => id !== serviceId);
      writeSavedIds(next);
      return next;
    });
    setServices((prev) => prev.filter((s) => s.service.id !== serviceId));
    // Best-effort server-side removal
    void removeServerSaved(serviceId);
    success('Removed from saved');
  }, [success]);

  const clearAll = useCallback(() => {
    // Clear localStorage
    writeSavedIds([]);
    setSavedIds([]);
    setServices([]);
    setShowClearConfirm(false);
    // Best-effort: remove all from server
    savedIds.forEach((id) => void removeServerSaved(id));
  }, [savedIds]);

  const isEmpty = useMemo(() => savedIds.length === 0, [savedIds]);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title="Saved Services"
        icon={<Bookmark className="h-6 w-6" aria-hidden="true" />}
        subtitle="Bookmarks are stored on your device. Sign in to sync across devices."
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
              Bookmark services to access them quickly. Saves stay on your device.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <Link href="/chat">
                <Button size="sm" className="gap-1.5 w-full sm:w-auto">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Find services via Chat
                </Button>
              </Link>
              <Link href="/directory">
                <Button variant="outline" size="sm" className="gap-1.5 w-full sm:w-auto">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Browse directory
                </Button>
              </Link>
              <Link href="/map">
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
                  href={`/service/${s.service.id}`}
                  isSaved
                  onToggleSave={removeService}
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
