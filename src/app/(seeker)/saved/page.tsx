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
import { ServiceCard } from '@/components/directory/ServiceCard';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { EnrichedService } from '@/domain/types';

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

  const url = new URL('/api/services', window.location.origin);
  url.searchParams.set('ids', ids.join(','));

  const res = await fetch(url.toString(), {
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

        // Union of localStorage IDs + server-side IDs, deduplicated
        const allIds = [...new Set([...localIds, ...(serverIds ?? [])])];

        if (cancelled) return;

        // Update localStorage with merged IDs
        if (serverIds !== null && serverIds.length > 0) {
          writeSavedIds(allIds);
          setSavedIds(allIds);
        }

        if (allIds.length === 0) {
          setServices([]);
          setIsLoading(false);
          return;
        }

        // Fetch services by IDs using batch endpoint
        const { services: fetchedServices, notFound } = await fetchServicesByIds(allIds);

        if (cancelled) return;

        setServices(fetchedServices);
        setNotFoundCount(notFound.length);

        // If some IDs were not found, clean them from saved IDs
        if (notFound.length > 0) {
          const validIds = allIds.filter((id) => !notFound.includes(id));
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
  }, []);

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
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
            <Bookmark className="h-6 w-6 text-blue-600" aria-hidden="true" />
            Saved Services
          </h1>
          <p className="text-gray-600 text-sm">
            Bookmarks are stored on your device only. No data is sent to ORAN servers.
          </p>
        </div>
        {savedIds.length > 0 && (
          !showClearConfirm ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
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
                className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
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
        )}
      </div>

      <ErrorBoundary>
        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
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
            {Array.from({ length: Math.min(savedIds.length, 6) }).map((_, i) => (
              <SkeletonCard key={`saved-skeleton-${i}`} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && isEmpty && (
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
            <Bookmark className="h-10 w-10 mx-auto text-gray-300 mb-3" aria-hidden="true" />
            <p className="text-gray-700 font-medium mb-1">No saved services yet</p>
            <p className="text-sm text-gray-500 mb-4">
              Find services and bookmark them for quick access later.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link href="/chat">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Find services
                </Button>
              </Link>
              <Link href="/directory">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Directory
                </Button>
              </Link>
              <Link href="/map">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Map
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Results */}
        {!isLoading && services.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500" role="status" aria-live="polite">{services.length} saved</p>
            {notFoundCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <p>{notFoundCount} saved service{notFoundCount > 1 ? 's' : ''} could not be loaded (may no longer be available).</p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {services.map((s) => (
                <div key={s.service.id} className="relative group">
                  <ServiceCard enriched={s} href={`/service/${s.service.id}`} />
                  <button
                    type="button"
                    onClick={() => removeService(s.service.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-white/90 border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 focus:text-red-600 focus:border-red-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100 transition-opacity min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={`Remove ${s.service.name} from saved`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
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
