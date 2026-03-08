/**
 * Service Detail Page
 *
 * Displays a full service view reached via deep-link or click from search results.
 * Data comes from verified service records only — no invented facts.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Search } from 'lucide-react';

import { Breadcrumb } from '@/components/ui/breadcrumb';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ServiceCard } from '@/components/directory/ServiceCard';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import type { EnrichedService } from '@/domain/types';

const SAVED_KEY = 'oran:saved-service-ids';

// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================

function readSavedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_KEY);
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
    localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
  } catch {
    /* quota exceeded */
  }
}

// ============================================================
// SERVER-SIDE HELPERS
// ============================================================

interface BatchServiceResponse {
  results: EnrichedService[];
  notFound?: string[];
}

/** Fetch a single service by ID */
async function fetchServiceById(id: string): Promise<EnrichedService | null> {
  const params = new URLSearchParams({ ids: id });

  const res = await fetch(`/api/services?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 404) {
      return null;
    }
    throw new Error('Failed to fetch service');
  }

  const json = (await res.json()) as BatchServiceResponse;
  return json.results[0] ?? null;
}

/** Add service to server-side saves (best-effort) */
async function addServerSaved(serviceId: string): Promise<void> {
  try {
    await fetch('/api/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort
  }
}

/** Remove service from server-side saves (best-effort) */
async function removeServerSaved(serviceId: string): Promise<void> {
  try {
    await fetch('/api/saved', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    });
  } catch {
    // Best-effort
  }
}

// ============================================================
// PAGE
// ============================================================

export default function ServiceDetailPage({ serviceId }: { serviceId: string }) {
  const [service, setService] = useState<EnrichedService | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const { success } = useToast();

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    setSavedIds(new Set(readSavedIds()));
  }, []);

  // Fetch service details
  useEffect(() => {
    if (!serviceId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const result = await fetchServiceById(serviceId);
        if (cancelled) return;

        if (!result) {
          setNotFound(true);
        } else {
          setService(result);
          // Update page title
          document.title = `${result.service.name} | ORAN`;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load service');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const toggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        void removeServerSaved(id);
        success('Removed from saved');
      } else {
        next.add(id);
        void addServerSaved(id);
        success('Saved');
      }
      writeSavedIds([...next]);
      return next;
    });
  }, [success]);

  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <ErrorBoundary>
        {/* Breadcrumb navigation */}
        <Breadcrumb
          className="mb-6"
          items={[
            { label: 'Directory', href: '/directory' },
            ...(service
              ? [{ label: service.service.name }]
              : notFound
              ? [{ label: 'Not found' }]
              : error
              ? [{ label: 'Error' }]
              : []),
          ]}
        />

        {/* Loading */}
        {isLoading && (
          <div role="status" aria-busy="true" aria-label="Loading service details">
            <SkeletonCard />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-error-soft bg-error-subtle p-4 text-sm text-error-deep"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Could not load service</p>
              <p className="mt-1 text-xs">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 text-error-strong hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Not found */}
        {notFound && !isLoading && (
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-400 mb-3" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-2">Service not found</h1>
            <p className="text-sm text-gray-600 mb-4">
              This service may no longer be available, or the link may be incorrect.
            </p>
            <Link href="/directory">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Search className="h-4 w-4" aria-hidden="true" />
                Browse directory
              </Button>
            </Link>
          </div>
        )}

        {/* Service card */}
        {service && !isLoading && !notFound && (
          <div>
            {/* sr-only h1 gives the page a semantic heading without duplicating the card */}
            <h1 className="sr-only">{service.service.name}</h1>
            <ServiceCard
              enriched={service}
              isSaved={savedIds.has(service.service.id)}
              onToggleSave={toggleSave}
            />
            {/* Eligibility disclaimer */}
            <p className="mt-4 text-xs text-center text-gray-500">
              Service information comes from verified records. Always confirm eligibility, hours,
              and requirements directly with the provider before visiting.
            </p>
          </div>
        )}
      </ErrorBoundary>
    </main>
  );
}
