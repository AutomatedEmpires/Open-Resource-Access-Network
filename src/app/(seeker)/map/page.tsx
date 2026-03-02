'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, MessageCircle, List, AlertTriangle, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ServiceCard } from '@/components/directory/ServiceCard';
import { MapContainer } from '@/components/map/MapContainer';
import type { SearchResponse } from '@/services/search/types';
import type { EnrichedService } from '@/domain/types';

const DEFAULT_LIMIT = 50;
const DEBOUNCE_MS = 600;
const SAVED_KEY = 'oran:saved-service-ids';

interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export default function MapPage() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [searchMode, setSearchMode] = useState<'text' | 'bbox'>('text');

  // Track latest bounds from the map for bbox-on-pan queries
  const boundsRef = useRef<Bounds | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: only auto-query after user has done at least one manual search
  const [hasSearched, setHasSearched] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) setSavedIds(new Set(parsed.filter((v): v is string => typeof v === 'string')));
      }
    } catch { /* ignore */ }
  }, []);

  const toggleSave = useCallback((serviceId: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) { next.delete(serviceId); } else { next.add(serviceId); }
      try { localStorage.setItem(SAVED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const canSearch = useMemo(() => query.trim().length > 0, [query]);

  const services: EnrichedService[] = useMemo(() => {
    return data?.results?.map((r) => r.service) ?? [];
  }, [data]);

  const pinnedCount = useMemo(
    () => services.filter((s) => s.location?.latitude != null && s.location?.longitude != null).length,
    [services],
  );

  // ── fetch services (text OR bbox) ─────────────────────────
  const runSearch = useCallback(
    async (opts?: { bbox?: Bounds }) => {
      const trimmed = query.trim();
      const bbox = opts?.bbox;

      // Need either text or bbox
      if (!trimmed && !bbox) return;

      setIsLoading(true);
      setError(null);

      try {
        const url = new URL('/api/search', window.location.origin);
        url.searchParams.set('status', 'active');
        url.searchParams.set('limit', String(DEFAULT_LIMIT));
        url.searchParams.set('page', '1');

        if (trimmed) url.searchParams.set('q', trimmed);

        if (bbox) {
          url.searchParams.set('minLat', String(bbox.minLat));
          url.searchParams.set('minLng', String(bbox.minLng));
          url.searchParams.set('maxLat', String(bbox.maxLat));
          url.searchParams.set('maxLng', String(bbox.maxLng));
        }

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Search failed');
        }

        const json = (await res.json()) as SearchResponse;
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [query],
  );

  // ── text search submit ────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSearched(true);
    setSearchMode('text');
    void runSearch();
  };

  // ── toggle to "search this area" mode ─────────────────────
  const searchThisArea = useCallback(() => {
    if (!boundsRef.current) return;
    setHasSearched(true);
    setSearchMode('bbox');
    void runSearch({ bbox: boundsRef.current });
  }, [runSearch]);

  // ── handle map bounds change (debounced bbox re-query) ────
  const handleBoundsChange = useCallback(
    (bounds: Bounds) => {
      boundsRef.current = bounds;
      if (!hasSearched) return; // don't auto-query before first search
      if (searchMode !== 'bbox') return; // only auto re-query in bbox mode

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch({ bbox: bounds });
      }, DEBOUNCE_MS);
    },
    [searchMode, runSearch, hasSearched],
  );

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Focus results container when results arrive for keyboard users
  useEffect(() => {
    if (data && !isLoading && resultsContainerRef.current) {
      resultsContainerRef.current.focus();
    }
  }, [data, isLoading]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Service Map</h1>
      <p className="text-gray-600 mb-6">
        Verified service locations. No device location is requested.
        Prefer browsing?{' '}
        <Link href="/directory" className="text-blue-600 hover:underline inline-flex items-center gap-1">
          <List className="h-4 w-4" aria-hidden="true" />
          Directory
        </Link>
        {' '}or{' '}
        <Link href="/chat" className="text-blue-600 hover:underline inline-flex items-center gap-1">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Chat
        </Link>
        .
      </p>

      <ErrorBoundary>
        {/* Search bar */}
        <form onSubmit={handleSubmit} className="flex gap-2 items-center mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder="Search for services (e.g., food bank, shelter)"
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              aria-label="Search services to plot"
            />
          </div>
          <Button type="submit" disabled={!canSearch || isLoading}>
            Search
          </Button>
        </form>

        {/* "Search this area" toggle */}
        {hasSearched && (
          <div className="flex items-center gap-3 mb-4 text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={searchThisArea}
              className="gap-1.5"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Search this area
            </Button>
            {searchMode === 'bbox' && (
              <span className="text-gray-500 text-xs">
                Results update as you pan and zoom.
              </span>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Search failed</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Map */}
        <MapContainer
          className="w-full h-[60vh]"
          services={services}
          onBoundsChange={handleBoundsChange}
        />

        {/* Pin count */}
        {data && pinnedCount > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {pinnedCount} of {services.length} results have map coordinates.
          </p>
        )}

        {/* Results panel */}
        <div className="mt-6">
          {isLoading && (
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              role="status"
              aria-busy="true"
              aria-label="Loading map results"
            >
              {Array.from({ length: 9 }).map((_, i) => (
                <SkeletonCard key={`map-skeleton-${i}`} />
              ))}
            </div>
          )}

          {!isLoading && !data && !error && (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
              <p className="text-gray-700 font-medium">Search to view services</p>
              <p className="mt-1 text-sm text-gray-500">
                Results come from verified records. Click a pin to preview.
              </p>
            </div>
          )}

          {!isLoading && data && (
            <div
              ref={resultsContainerRef}
              tabIndex={-1}
              className="space-y-3 outline-none"
            >
              <p className="text-sm text-gray-600" role="status" aria-live="polite">
                {data.total} total matches · showing {data.results.length}
              </p>
              {data.results.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                  <p className="text-gray-700 font-medium">No matches</p>
                  <p className="mt-1 text-sm text-gray-500">Try different keywords or pan to a new area.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.results.map((r) => (
                    <ServiceCard
                    key={r.service.service.id}
                    enriched={r.service}
                    compact
                    isSaved={savedIds.has(r.service.service.id)}
                    onToggleSave={toggleSave}
                    href={`/service/${r.service.service.id}`}
                  />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ErrorBoundary>
    </main>
  );
}
