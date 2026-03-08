'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Search, MapPin, List, AlertTriangle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ServiceCard } from '@/components/directory/ServiceCard';
import type { SearchResponse } from '@/services/search/types';
import type { EnrichedService } from '@/domain/types';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// Azure Maps SDK accesses `window` at module evaluation time — must be loaded
// client-side only. The ssr:false dynamic import prevents SSR prerender errors.
const MapContainer = dynamic(
  () => import('@/components/map/MapContainer').then((m) => m.MapContainer),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[60vh] rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
        Loading map…
      </div>
    ),
  }
);

const DEFAULT_LIMIT = 12;
const DEBOUNCE_MS = 600;
const SAVED_KEY = 'oran:saved-service-ids';

/** Trust filter options — 'all' shows everything */
type ConfidenceFilter = 'all' | 'HIGH' | 'LIKELY';

const CONFIDENCE_OPTIONS: { value: ConfidenceFilter; label: string; minScore?: number }[] = [
  { value: 'all', label: 'All results' },
  { value: 'LIKELY', label: 'Likely or higher', minScore: 60 },
  { value: 'HIGH', label: 'High confidence only', minScore: 80 },
];

/** Sort options */
type SortOption = 'relevance' | 'trust' | 'name_asc' | 'name_desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'trust', label: 'Trust (highest)' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
];

/** Quick category chips for common service needs */
const CATEGORY_CHIPS: { value: string; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'housing', label: 'Housing' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'mental health', label: 'Mental Health' },
  { value: 'employment', label: 'Employment' },
  { value: 'legal aid', label: 'Legal Aid' },
  { value: 'childcare', label: 'Childcare' },
  { value: 'transportation', label: 'Transportation' },
];

/** Human-readable labels for taxonomy dimension keys */
const DIMENSION_LABELS: Record<string, string> = {
  delivery: 'Delivery Method',
  cost: 'Cost & Payment',
  access: 'Access',
  eligibility: 'Eligibility',
  languages: 'Languages',
  temporal: 'Schedule',
};

interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

type TaxonomyTermDTO = {
  id: string;
  term: string;
  description: string | null;
  parentId: string | null;
  taxonomy: string | null;
  serviceCount: number;
};

export default function MapPage() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  // Default to bbox mode so panning/zooming can re-query immediately.
  const [searchMode, setSearchMode] = useState<'text' | 'bbox'>('bbox');

  // Opt-in device geolocation (in-session only; never stored)
  const [isLocating, setIsLocating] = useState(false);
  const [deviceCenter, setDeviceCenter] = useState<{ lat: number; lng: number } | null>(null);

  // Taxonomy filters (IDs are canonical DB UUIDs)
  const [taxonomyTerms, setTaxonomyTerms] = useState<TaxonomyTermDTO[]>([]);
  const [isLoadingTaxonomy, setIsLoadingTaxonomy] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [selectedTaxonomyIds, setSelectedTaxonomyIds] = useState<string[]>([]);
  const [taxonomyDialogOpen, setTaxonomyDialogOpen] = useState(false);
  const [taxonomySearch, setTaxonomySearch] = useState('');

  // Track latest bounds from the map for bbox-on-pan queries
  const boundsRef = useRef<Bounds | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isAreaDirty, setIsAreaDirty] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const savedIdsRef = useRef<Set<string>>(new Set());
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  /** Mobile-only toggle between map and list view */
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const { success, error: toastError, info } = useToast();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTerms() {
      setIsLoadingTaxonomy(true);
      setTaxonomyError(null);
      try {
        const res = await fetch('/api/taxonomy/terms?limit=250', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Failed to load filters');
        }
        const json = (await res.json()) as { terms: TaxonomyTermDTO[] };
        if (!cancelled) {
          setTaxonomyTerms(Array.isArray(json.terms) ? json.terms : []);
        }
      } catch (e) {
        if (!cancelled) {
          setTaxonomyError(e instanceof Error ? e.message : 'Failed to load filters');
        }
      } finally {
        if (!cancelled) setIsLoadingTaxonomy(false);
      }
    }

    void loadTerms();
    return () => {
      cancelled = true;
    };
  }, []);

  const roundForPrivacy = useCallback((value: number): number => {
    // ~0.01° ≈ 1km (varies by latitude); used to reduce precision exposure.
    return Math.round(value * 100) / 100;
  }, []);

  const handleUseMyLocation = useCallback(() => {
    if (isLocating) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      toastError('Device location is not available in this browser.');
      return;
    }

    setIsLocating(true);
    info('Requesting device location…');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = roundForPrivacy(pos.coords.latitude);
        const lng = roundForPrivacy(pos.coords.longitude);
        setDeviceCenter({ lat, lng });
        setMobileView('map');
        setSearchMode('bbox');
        setIsAreaDirty(true);
        success('Centered near your location (not saved).');
        setIsLocating(false);
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : err.code === err.TIMEOUT
              ? 'Location request timed out.'
              : 'Location unavailable.';
        toastError(message);
        setIsLocating(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    );
  }, [info, isLocating, roundForPrivacy, success, toastError]);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const next = new Set(parsed.filter((v): v is string => typeof v === 'string'));
          savedIdsRef.current = next;
          setSavedIds(next);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Keep ref in sync in case savedIds is updated elsewhere.
  useEffect(() => {
    savedIdsRef.current = savedIds;
  }, [savedIds]);

  const toggleSave = useCallback((serviceId: string) => {
    // Read from ref so this callback never goes stale — no savedIds in dep array.
    const wasSaved = savedIdsRef.current.has(serviceId);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) { next.delete(serviceId); } else { next.add(serviceId); }
      savedIdsRef.current = next;
      try { localStorage.setItem(SAVED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    success(wasSaved ? 'Removed from saved' : 'Saved');
  }, [success]);

  const canSearch = useMemo(() => query.trim().length > 0, [query]);

  const taxonomyIdsParam = useMemo(() => {
    return selectedTaxonomyIds.length > 0 ? selectedTaxonomyIds.join(',') : '';
  }, [selectedTaxonomyIds]);

  // Sort by service count so the most-used tags surface first (H3)
  const quickTaxonomyTerms = useMemo(
    () => [...taxonomyTerms].sort((a, b) => b.serviceCount - a.serviceCount).slice(0, 6),
    [taxonomyTerms],
  );

  const visibleTaxonomyTerms = useMemo(() => {
    const trimmed = taxonomySearch.trim().toLowerCase();
    if (!trimmed) return taxonomyTerms;
    return taxonomyTerms.filter((t) => t.term.toLowerCase().includes(trimmed));
  }, [taxonomySearch, taxonomyTerms]);

  /** Terms grouped by taxonomy dimension — used in the "More filters" dialog */
  const groupedTaxonomyTerms = useMemo(() => {
    const groups: Record<string, TaxonomyTermDTO[]> = {};
    for (const t of visibleTaxonomyTerms) {
      const key = t.taxonomy ?? 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [visibleTaxonomyTerms]);

  const services: EnrichedService[] = useMemo(() => {
    return data?.results?.map((r) => r.service) ?? [];
  }, [data]);

  const pinnedCount = useMemo(
    () => services.filter((s) => s.location?.latitude != null && s.location?.longitude != null).length,
    [services],
  );

  // ── fetch services (text OR bbox) ─────────────────────────
  const runSearch = useCallback(
    async (opts?: { bbox?: Bounds; taxonomyIds?: string; confidence?: ConfidenceFilter; sort?: SortOption; category?: string | null }) => {
      const trimmed = query.trim();
      const bbox = opts?.bbox;
      const taxonomyIds = opts?.taxonomyIds;
      const effectiveConfidence = opts?.confidence !== undefined ? opts.confidence : confidenceFilter;
      const effectiveSort = opts?.sort !== undefined ? opts.sort : sortBy;
      // category is passed explicitly when a chip is toggled so the state update
      // and the fetch are always in sync
      const effectiveCategory = opts?.category !== undefined ? opts.category : activeCategory;

      // Need either text, category, or bbox
      if (!trimmed && !effectiveCategory && !bbox) return;

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ status: 'active', limit: String(DEFAULT_LIMIT), page: '1' });

        const searchText = trimmed || effectiveCategory || '';
        if (searchText) params.set('q', searchText);

        if (bbox) {
          params.set('minLat', String(bbox.minLat));
          params.set('minLng', String(bbox.minLng));
          params.set('maxLat', String(bbox.maxLat));
          params.set('maxLng', String(bbox.maxLng));
        }

        const effectiveTaxonomyIds = taxonomyIds ?? taxonomyIdsParam;
        if (effectiveTaxonomyIds) {
          params.set('taxonomyIds', effectiveTaxonomyIds);
        }

        const minScore = CONFIDENCE_OPTIONS.find(c => c.value === effectiveConfidence)?.minScore;
        if (minScore !== undefined) params.set('minConfidenceScore', String(minScore));

        if (effectiveSort !== 'relevance') params.set('sortBy', effectiveSort);

        const res = await fetch(`/api/search?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Search failed');
        }

        const json = (await res.json()) as SearchResponse;
        setData(json);
        setIsAreaDirty(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [query, taxonomyIdsParam, confidenceFilter, sortBy, activeCategory],
  );

  const toggleTaxonomyId = useCallback((id: string) => {
    setSelectedTaxonomyIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const nextParam = next.length > 0 ? next.join(',') : '';

      // Re-run the current search context so filters feel immediate.
      if (boundsRef.current) {
        void runSearch({ bbox: boundsRef.current, taxonomyIds: nextParam });
      } else if (query.trim()) {
        void runSearch({ taxonomyIds: nextParam });
      }

      return next;
    });
  }, [query, runSearch]);

  const clearTaxonomyFilters = useCallback(() => {
    setSelectedTaxonomyIds([]);
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, taxonomyIds: '' });
    } else if (query.trim()) {
      void runSearch({ taxonomyIds: '' });
    }
  }, [query, runSearch]);

  const handleCategoryClick = useCallback((category: string) => {
    const next = activeCategory === category ? null : category;
    setActiveCategory(next);
    setQuery('');
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, category: next });
    } else {
      void runSearch({ category: next });
    }
  }, [activeCategory, runSearch]);

  // ── text search submit ────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Keep bbox mode so results remain tied to the visible map area.
    setSearchMode('bbox');
    setIsAreaDirty(false);
    void runSearch({ bbox: boundsRef.current ?? undefined });
  };

  // ── toggle to "search this area" mode ─────────────────────
  const searchThisArea = useCallback(() => {
    if (!boundsRef.current) return;
    setSearchMode('bbox');
    setIsAreaDirty(false);
    void runSearch({ bbox: boundsRef.current });
  }, [runSearch]);

  // ── handle map bounds change (debounced bbox re-query) ────
  const handleBoundsChange = useCallback(
    (bounds: Bounds) => {
      boundsRef.current = bounds;
      if (searchMode !== 'bbox') return; // only auto re-query in bbox mode

      // Mobile behavior: Zillow-like “Search this area” CTA.
      if (isMobile) {
        setIsAreaDirty(true);
        return;
      }

      // Desktop behavior: auto refresh (debounced).
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch({ bbox: bounds });
      }, DEBOUNCE_MS);
    },
    [isMobile, searchMode, runSearch],
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
    <main className="container mx-auto max-w-6xl px-4 py-4 md:py-8">
      <PageHeader
        title="Service Map"
        subtitle={
          <>
            Search verified service locations. Prefer browsing?{' '}
            <Link href="/directory" className="text-action-base hover:underline">Directory</Link>
            {' '}or{' '}
            <Link href="/chat" className="text-action-base hover:underline">Chat</Link>.
          </>
        }
      />

      <ErrorBoundary>
        {/* Search bar */}
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-center mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder="Search for services (e.g., food bank, shelter)"
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
              aria-label="Search services to plot"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-action"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <Button type="submit" disabled={!canSearch || isLoading}>
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleUseMyLocation}
            disabled={isLocating}
            title="Opt-in: uses device location in-session only; not stored"
          >
            {isLocating ? 'Locating…' : 'Use my location'}
          </Button>
        </form>

        {/* Category chips */}
        <div className="mb-2 flex overflow-x-auto gap-1.5 pb-1" role="group" aria-label="Filter by service category">
          {CATEGORY_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => handleCategoryClick(chip.value)}
              aria-pressed={activeCategory === chip.value}
              className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition-colors min-h-[44px] flex-shrink-0 ${
                activeCategory === chip.value
                  ? 'border-action bg-action text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Confidence + sort controls */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="map-confidence" className="text-xs text-gray-500 whitespace-nowrap">Trust:</label>
          <select
            id="map-confidence"
            value={confidenceFilter}
            onChange={(e) => {
              const next = e.target.value as ConfidenceFilter;
              setConfidenceFilter(next);
              if (boundsRef.current) {
                void runSearch({ bbox: boundsRef.current, confidence: next });
              } else if (query.trim() || activeCategory) {
                void runSearch({ confidence: next });
              }
            }}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
          >
            {CONFIDENCE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <label htmlFor="map-sort" className="text-xs text-gray-500 whitespace-nowrap">Sort:</label>
          <select
            id="map-sort"
            value={sortBy}
            onChange={(e) => {
              const next = e.target.value as SortOption;
              setSortBy(next);
              if (boundsRef.current) {
                void runSearch({ bbox: boundsRef.current, sort: next });
              } else if (query.trim() || activeCategory) {
                void runSearch({ sort: next });
              }
            }}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Quick filters + full taxonomy dialog */}
        {(isLoadingTaxonomy || taxonomyError || taxonomyTerms.length > 0) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {quickTaxonomyTerms.map((t) => {
              const selected = selectedTaxonomyIds.includes(t.id);
              return (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={selected ? 'secondary' : 'outline'}
                  onClick={() => toggleTaxonomyId(t.id)}
                  title={t.description ?? undefined}
                  className="text-xs"
                >
                  {t.term}
                </Button>
              );
            })}

            <Dialog open={taxonomyDialogOpen} onOpenChange={setTaxonomyDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="text-xs">
                  More filters{selectedTaxonomyIds.length > 0 ? ` (${selectedTaxonomyIds.length})` : ''}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Filter by service tags</DialogTitle>
                  <DialogDescription>
                    Filters are based on stored taxonomy terms. You may need to confirm details with the provider.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={taxonomySearch}
                      onChange={(e) => setTaxonomySearch(e.target.value)}
                      type="search"
                      placeholder="Search tags…"
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                      aria-label="Search service tags"
                    />
                    {selectedTaxonomyIds.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={clearTaxonomyFilters}
                      >
                        Clear
                      </Button>
                    )}
                  </div>

                  {taxonomyError && (
                    <p className="text-sm text-error-strong" role="alert">{taxonomyError}</p>
                  )}

                  {isLoadingTaxonomy ? (
                    <p className="text-sm text-gray-600">Loading tags…</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 p-3 space-y-4">
                      {visibleTaxonomyTerms.length === 0 && (
                        <p className="text-sm text-gray-600">No matching tags.</p>
                      )}
                      {Object.entries(groupedTaxonomyTerms).map(([dim, terms]) => (
                        <div key={dim}>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                            {DIMENSION_LABELS[dim] ?? dim}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {terms.map((t) => {
                              const selected = selectedTaxonomyIds.includes(t.id);
                              return (
                                <Button
                                  key={t.id}
                                  type="button"
                                  size="sm"
                                  variant={selected ? 'secondary' : 'outline'}
                                  onClick={() => toggleTaxonomyId(t.id)}
                                  title={t.description ?? undefined}
                                  className="text-xs"
                                >
                                  {t.term}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {taxonomyError && taxonomyTerms.length === 0 && (
              <span className="text-xs text-gray-600">Filters unavailable</span>
            )}
          </div>
        )}

        <p className="-mt-2 mb-3 text-xs text-gray-600">
          Location is optional. If you choose “Use my location”, ORAN uses an approximate location to center the map in-session only and does not store it.
        </p>

        {/* Mobile view toggle — only visible below md */}
        <div className="flex gap-1 mb-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileView('map')}
            className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium transition-colors flex-1 justify-center ${
              mobileView === 'map'
                ? 'bg-action-base text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Map view
          </button>
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium transition-colors flex-1 justify-center ${
              mobileView === 'list'
                ? 'bg-action-base text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <List className="h-3.5 w-3.5" aria-hidden="true" />
            List ({data?.total ?? 0})
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-deep"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Search failed</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Split-pane layout: stacked on mobile, side-by-side on desktop */}
        <div className="md:grid md:grid-cols-[1fr_380px] md:gap-4 md:items-start">
          {/* Map column */}
          <div className={`rounded-lg overflow-hidden md:sticky md:top-24 ${
            mobileView === 'list' ? 'hidden md:block' : ''
          }`}>
            <div className="relative">
              <MapContainer
                className="w-full h-[50vh] md:h-[calc(100vh-16rem)]"
                centerLat={deviceCenter?.lat}
                centerLng={deviceCenter?.lng}
                zoom={deviceCenter ? 12 : undefined}
                services={services}
                onBoundsChange={handleBoundsChange}
              />

              {/* Mobile: show CTA only after pan/zoom */}
              {isMobile && isAreaDirty && (
                <div className="absolute left-0 right-0 top-3 flex justify-center px-3 pointer-events-none">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={searchThisArea}
                    className="gap-1.5 text-xs pointer-events-auto"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    Search this area
                  </Button>
                </div>
              )}
            </div>

            {/* Desktop: always-visible control */}
            <div className="hidden md:flex items-center gap-3 mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={searchThisArea}
                className="gap-1.5 text-xs"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Search this area
              </Button>
              {searchMode === 'bbox' && (
                <span className="text-gray-500 text-xs">Updates as you pan.</span>
              )}
            </div>
          </div>

          {/* Results column */}
          <div
            ref={resultsContainerRef}
            tabIndex={-1}
            className={`mt-4 md:mt-0 md:max-h-[calc(100vh-16rem)] md:overflow-y-auto outline-none ${
              mobileView === 'map' ? 'hidden md:block' : ''
            }`}
          >
            {isLoading && (
              <div
                className="space-y-3"
                role="status"
                aria-busy="true"
                aria-label="Loading map results"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={`map-skeleton-${i}`} />
                ))}
              </div>
            )}

            {!isLoading && !data && !error && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
                <MapPin className="h-8 w-8 text-gray-300 mx-auto mb-2" aria-hidden="true" />
                <p className="text-gray-700 font-medium text-sm">Ready to search</p>
                <p className="mt-1 text-xs text-gray-500">
                  Type a keyword above, tap a category chip, or pan the map and tap <strong>Search this area</strong>.
                </p>
              </div>
            )}

            {!isLoading && data && (
              <>
                <p className="text-xs text-gray-500 mb-3" role="status" aria-live="polite">
                  {data.results.length === 0
                    ? 'No matches'
                    : `${data.results.length} of ${data.total} shown`}
                  {pinnedCount > 0 && data.results.length > 0 && (
                    <span className="ml-1">· {pinnedCount} pinned</span>
                  )}
                </p>
                {data.results.length === 0 ? (
                  <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
                    <p className="text-gray-700 font-medium text-sm">No matches in this area</p>
                    <p className="mt-1 text-xs text-gray-500">Try different keywords, a broader category, or pan to a new area.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.results.map((r) => (
                      <div key={r.service.service.id} className="flex items-stretch gap-3">
                        <ConfidenceRing enriched={r.service} />
                        <div className="flex-1">
                          <ServiceCard
                            enriched={r.service}
                            compact
                            isSaved={savedIds.has(r.service.service.id)}
                            onToggleSave={toggleSave}
                            href={`/service/${r.service.service.id}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </ErrorBoundary>
    </main>
  );
}

function getConfidenceScore(enriched: EnrichedService): number | null {
  const score = enriched.confidenceScore?.score;
  return typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function ConfidenceRing({ enriched }: { enriched: EnrichedService }) {
  const score = getConfidenceScore(enriched);
  const value = score ?? 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;

  const strokeClass =
    score == null ? 'stroke-gray-300' :
      value >= 80 ? 'stroke-green-600' :
      value >= 60 ? 'stroke-yellow-500' :
      value >= 40 ? 'stroke-orange-500' :
      'stroke-red-600';

  return (
    <div
      className="flex-shrink-0 w-10"
      aria-label={score == null ? 'Trust score unknown' : `Trust ${Math.round(value)} percent`}
      title={score == null ? 'Trust score unknown' : `Trust: ${Math.round(value)}%`}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r={radius}
          className="stroke-gray-200"
          strokeWidth="4"
          fill="none"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          className={strokeClass}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform="rotate(-90 20 20)"
        />
        <text
          x="20"
          y="21"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-gray-700 text-[10px] font-semibold"
        >
          {score == null ? '—' : `${Math.round(value)}%`}
        </text>
      </svg>
    </div>
  );
}
