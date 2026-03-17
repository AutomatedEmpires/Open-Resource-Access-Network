'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, MapPin, AlertTriangle, X, ChevronDown, SlidersHorizontal, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  type DiscoveryNeedId,
  resolveDiscoveryNeedId,
  isDiscoveryNeedSearchText,
  getDiscoveryNeedSearchText,
} from '@/domain/discoveryNeeds';
import { SERVICE_ATTRIBUTES_TAXONOMY } from '@/domain/taxonomy';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ServiceCard } from '@/components/directory/ServiceCard';
import { DistanceRadiusControl } from '@/components/seeker/DistanceRadiusControl';
import { QuickNeedFilterGrid } from '@/components/seeker/QuickNeedFilterGrid';
import { type SeekerAppliedFilterItem } from '@/components/seeker/SeekerAppliedFilters';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  readStoredSavedServiceIdSet,
  removeServerSaved,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { getSavedTogglePresentation } from '@/services/saved/presentation';
import {
  buildDiscoveryHref,
  buildDiscoveryUrlParams,
  buildSearchApiParamsFromDiscovery,
  hasMeaningfulDiscoveryState,
  parseDiscoveryAttributeFilters,
  parseDiscoveryUrlState,
  resolveDiscoverySearchText,
  type DiscoverySortOption,
} from '@/services/search/discovery';
import { clampDiscoveryRadiusMiles, DEFAULT_DISCOVERY_RADIUS_MILES, milesToMeters } from '@/services/search/radius';
import type { SearchResponse, SearchResult } from '@/services/search/types';
import type { EnrichedService } from '@/domain/types';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/toast';
import { DISCOVERY_ATTRIBUTE_LABELS } from '@/services/search/discoveryPresentation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Azure Maps SDK accesses `window` at module evaluation time — must be loaded
// client-side only. The ssr:false dynamic import prevents SSR prerender errors.
const MapContainer = dynamic(
  () => import('@/components/map/MapContainer').then((m) => m.MapContainer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[60vh] w-full items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] text-sm text-[var(--text-muted)]">
        Loading map…
      </div>
    ),
  }
);

const DEFAULT_LIMIT = 12;
const DEBOUNCE_MS = 600;
type ConfidenceFilter = 'all';
type SortOption = 'relevance' | 'distance';
const VALID_SORT_OPTIONS: SortOption[] = ['relevance', 'distance'];

function normalizeSortOption(value: DiscoverySortOption | string | null | undefined): SortOption {
  return VALID_SORT_OPTIONS.includes(value as SortOption) ? (value as SortOption) : 'distance';
}

const SORT_OPTIONS: Array<{ value: SortOption; label: string; description: string }> = [
  { value: 'distance', label: 'Nearby first', description: 'Shows the closest results in the current map area first.' },
  { value: 'relevance', label: 'Balanced results', description: 'Mixes relevance, verification, and nearby results.' },
];

/** Canonical resource taxonomy dimensions exposed on the seeker map */
const SEEKER_ATTRIBUTE_DIMENSIONS = ['delivery', 'cost', 'access', 'culture', 'population', 'situation'] as const;

/** Human-readable labels for taxonomy dimension keys */
const DIMENSION_LABELS: Record<string, string> = {
  delivery: 'Delivery Method',
  cost: 'Cost & Payment',
  access: 'Access',
  culture: 'Culture & Identity',
  population: 'Population Focus',
  situation: 'Situational Context',
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

function formatDistance(meters: number | null | undefined): string | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return null;
  const miles = meters / 1609.344;
  if (miles < 0.2) {
    return `${Math.round(meters / 160.934)} min walk`;
  }
  if (miles < 10) {
    return `${miles.toFixed(1)} mi away`;
  }
  return `${Math.round(miles)} mi away`;
}

function hasPinnedLocation(service: EnrichedService): boolean {
  return service.location?.latitude != null && service.location?.longitude != null;
}

function getAttributeTags(service: EnrichedService, taxonomy: string): string[] {
  return service.attributes
    ?.filter((attribute) => attribute.taxonomy === taxonomy)
    .map((attribute) => attribute.tag) ?? [];
}

function getOffMapReason(service: EnrichedService): string {
  const deliveryTags = getAttributeTags(service, 'delivery');
  const supportsOnline = deliveryTags.includes('virtual') || deliveryTags.includes('hybrid');
  const supportsPhone = deliveryTags.includes('phone');

  if (supportsOnline && supportsPhone) {
    return 'Available online or by phone';
  }
  if (supportsOnline) {
    return 'Available online';
  }
  if (supportsPhone) {
    return 'Available by phone';
  }

  const namedServiceArea = service.serviceAreas?.find((area) => area.name?.trim())?.name?.trim();
  if (namedServiceArea) {
    return `Serves ${namedServiceArea}`;
  }

  const extentType = service.serviceAreas?.find((area) => area.extentType)?.extentType;
  switch (extentType) {
    case 'nationwide':
      return 'Serves people nationwide';
    case 'state':
      return 'Serves a wider state area';
    case 'county':
      return 'Serves a wider county area';
    case 'city':
    case 'zip':
      return 'Serves a wider local area';
    default:
      break;
  }

  const serviceRegion = service.organization?.serviceRegion?.trim();
  if (serviceRegion) {
    return `Serves ${serviceRegion}`;
  }

  return 'No precise map location listed';
}

export default function MapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCategoryFromUrl = resolveDiscoveryNeedId(searchParams.get('category'));

  const [query, setQuery] = useState(() => {
    const urlQuery = searchParams.get('q');
    if (urlQuery) return urlQuery;
    return getDiscoveryNeedSearchText(initialCategoryFromUrl) ?? '';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  // Default to bbox mode so panning/zooming can re-query immediately.
  const [searchMode, setSearchMode] = useState<'text' | 'bbox' | 'radius'>('bbox');

  // Opt-in device geolocation (in-session only; never stored)
  const [isLocating, setIsLocating] = useState(false);
  const [deviceCenter, setDeviceCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_DISCOVERY_RADIUS_MILES);
  const [locationState, setLocationState] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported'>('idle');

  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string[]>>(
    () => parseDiscoveryAttributeFilters(searchParams.get('attributes')) ?? {},
  );
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(false);

  // Track latest bounds from the map for bbox-on-pan queries
  const boundsRef = useRef<Bounds | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [hasMapBounds, setHasMapBounds] = useState(false);
  const [isAreaDirty, setIsAreaDirty] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const savedIdsRef = useRef<Set<string>>(new Set());
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<DiscoveryNeedId | null>(initialCategoryFromUrl);
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    return normalizeSortOption(searchParams.get('sort'));
  });
  const confidenceFilter = 'all' as const;
  const { success, error: toastError, info } = useToast();
  const didRequestLocationRef = useRef(false);
  const didInitialMobileSearchRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const roundForPrivacy = useCallback((value: number): number => {
    // ~0.01° ≈ 1km (varies by latitude); used to reduce precision exposure.
    return Math.round(value * 100) / 100;
  }, []);

  const requestDeviceLocation = useCallback((announce = true) => {
    if (isLocating) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocationState('unsupported');
      if (announce) {
        toastError('Device location is not available in this browser.');
      }
      return;
    }

    setIsLocating(true);
    setLocationState('requesting');
    if (announce) {
      info('Requesting device location…');
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = roundForPrivacy(pos.coords.latitude);
        const lng = roundForPrivacy(pos.coords.longitude);
        setDeviceCenter({ lat, lng });
        setSearchMode('radius');
        setIsAreaDirty(false);
        setLocationState('granted');
        if (announce) {
          success('Centered near your location (not saved).');
        }
        setIsLocating(false);
      },
      (err) => {
        setLocationState(err.code === err.PERMISSION_DENIED ? 'denied' : 'idle');
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : err.code === err.TIMEOUT
              ? 'Location request timed out.'
              : 'Location unavailable.';
        if (announce) {
          toastError(message);
        }
        setIsLocating(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    );
  }, [info, isLocating, roundForPrivacy, success, toastError]);

  const handleUseMyLocation = useCallback(() => {
    requestDeviceLocation(true);
  }, [requestDeviceLocation]);

  useEffect(() => {
    if (didRequestLocationRef.current || deviceCenter || isLocating) return;
    didRequestLocationRef.current = true;
    requestDeviceLocation(false);
  }, [deviceCenter, isLocating, requestDeviceLocation]);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    const next = readStoredSavedServiceIdSet();
    savedIdsRef.current = next;
    setSavedIds(next);
  }, []);

  // Keep ref in sync in case savedIds is updated elsewhere.
  useEffect(() => {
    savedIdsRef.current = savedIds;
  }, [savedIds]);

  const toggleSave = useCallback((serviceId: string) => {
    const wasSaved = savedIdsRef.current.has(serviceId);
    const toggleCopy = getSavedTogglePresentation(wasSaved, savedSyncEnabled);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) { next.delete(serviceId); } else { next.add(serviceId); }
      savedIdsRef.current = next;
      writeStoredSavedServiceIds(next);
      return next;
    });
    if (savedSyncEnabled) {
      if (wasSaved) {
        void removeServerSaved(serviceId);
      } else {
        void addServerSaved(serviceId);
      }
    }
    success(toggleCopy.toastMessage);
  }, [savedSyncEnabled, success]);

  const hasSearchContext = useCallback((
    nextQuery: string,
    nextCategory: DiscoveryNeedId | null,
    nextAttributes: Record<string, string[]>,
    hasBounds = false,
  ) => {
    return Boolean(resolveDiscoverySearchText(nextQuery, nextCategory))
      || Object.keys(nextAttributes).length > 0
      || hasBounds;
  }, []);

  const hasShareableIntent = useCallback((
    nextQuery: string,
    nextCategory: DiscoveryNeedId | null,
    nextAttributes: Record<string, string[]>,
  ) => hasSearchContext(nextQuery, nextCategory, nextAttributes, false), [hasSearchContext]);

  const pushUrlState = useCallback((
    nextQuery: string,
    nextConfidence: ConfidenceFilter,
    nextSort: SortOption,
    nextCategory: DiscoveryNeedId | null,
    nextAttributes: Record<string, string[]>,
  ) => {
    if (!hasShareableIntent(nextQuery, nextCategory, nextAttributes)) {
      router.replace('/map', { scroll: false });
      return;
    }

    const params = buildDiscoveryUrlParams({
      text: nextQuery,
      needId: nextCategory,
      confidenceFilter: nextConfidence,
      sortBy: nextSort,
      attributeFilters: nextAttributes,
    });
    const qs = params.toString();
    router.replace(qs ? `/map?${qs}` : '/map', { scroll: false });
  }, [hasShareableIntent, router]);

  const resetResultsToEmpty = useCallback(() => {
    setData(null);
    setError(null);
    pushUrlState('', 'all', 'distance', null, {});
  }, [pushUrlState]);

  const canSearch = useMemo(
    () => hasSearchContext(query, activeCategory, selectedAttributes, hasMapBounds),
    [activeCategory, hasMapBounds, hasSearchContext, query, selectedAttributes],
  );

  const services: EnrichedService[] = useMemo(() => {
    return data?.results?.map((r) => r.service) ?? [];
  }, [data]);

  const pinnedResults = useMemo<SearchResult[]>(
    () => (data?.results ?? []).filter((result) => hasPinnedLocation(result.service)),
    [data],
  );

  const offMapResults = useMemo<SearchResult[]>(
    () => (data?.results ?? []).filter((result) => !hasPinnedLocation(result.service)),
    [data],
  );

  const pinnedCount = pinnedResults.length;
  const offMapCount = offMapResults.length;

  const mapDiscoveryContext = useMemo(() => {
    return {
      text: query,
      needId: activeCategory,
      confidenceFilter,
      sortBy,
      attributeFilters: selectedAttributes,
    };
  }, [activeCategory, confidenceFilter, query, selectedAttributes, sortBy]);

  const directoryHref = useMemo(() => {
    return buildDiscoveryHref('/directory', mapDiscoveryContext);
  }, [mapDiscoveryContext]);

  const buildServiceDetailHref = useCallback((serviceId: string) => {
    return buildDiscoveryHref(`/service/${serviceId}`, mapDiscoveryContext);
  }, [mapDiscoveryContext]);

  // ── fetch services (text OR bbox) ─────────────────────────
  const runSearch = useCallback(
    async (opts?: {
      bbox?: Bounds;
      attributes?: Record<string, string[]>;
      confidence?: ConfidenceFilter;
      sort?: SortOption;
      category?: DiscoveryNeedId | null;
      text?: string;
      mode?: 'bbox' | 'radius';
    }) => {
      const trimmed = (opts?.text ?? query).trim();
      const bbox = opts?.bbox;
      const effectiveAttributes = opts?.attributes ?? selectedAttributes;
      const effectiveConfidence = opts?.confidence !== undefined ? opts.confidence : confidenceFilter;
      const effectiveSort = opts?.sort !== undefined ? opts.sort : sortBy;
      // category is passed explicitly when a chip is toggled so the state update
      // and the fetch are always in sync
      const effectiveCategory = opts?.category !== undefined ? opts.category : activeCategory;
      const categorySearchText = getDiscoveryNeedSearchText(effectiveCategory) ?? '';

      setIsLoading(true);
      setError(null);

      try {
        if (!hasSearchContext(trimmed, effectiveCategory, effectiveAttributes, Boolean(bbox))) {
          setIsLoading(false);
          return;
        }
        const geo = opts?.mode === 'bbox'
          ? (bbox
              ? {
                  type: 'bbox' as const,
                  minLat: bbox.minLat,
                  minLng: bbox.minLng,
                  maxLat: bbox.maxLat,
                  maxLng: bbox.maxLng,
                }
              : undefined)
          : (opts?.mode === 'radius' || (searchMode === 'radius' && deviceCenter)
              ? {
                  type: 'radius' as const,
                  lat: deviceCenter?.lat ?? 0,
                  lng: deviceCenter?.lng ?? 0,
                  radiusMeters: milesToMeters(radiusMiles),
                }
              : (bbox
                  ? {
                      type: 'bbox' as const,
                      minLat: bbox.minLat,
                      minLng: bbox.minLng,
                      maxLat: bbox.maxLat,
                      maxLng: bbox.maxLng,
                    }
                  : undefined));

        const params = buildSearchApiParamsFromDiscovery({
          text: trimmed || categorySearchText,
          needId: effectiveCategory,
          attributeFilters: effectiveAttributes,
          confidenceFilter: effectiveConfidence,
          sortBy: effectiveSort,
          page: 1,
          limit: DEFAULT_LIMIT,
            geo,
        });

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
        pushUrlState(
          trimmed || categorySearchText,
          effectiveConfidence,
          effectiveSort,
          effectiveCategory,
          effectiveAttributes,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [activeCategory, confidenceFilter, deviceCenter, hasSearchContext, pushUrlState, query, radiusMiles, searchMode, selectedAttributes, sortBy],
  );

  const clearDeviceLocation = useCallback(() => {
    setDeviceCenter(null);
    setLocationState('idle');
    setSearchMode('bbox');
    setRadiusMiles(DEFAULT_DISCOVERY_RADIUS_MILES);

    if (!hasSearchContext(query, activeCategory, selectedAttributes, Boolean(boundsRef.current))) {
      resetResultsToEmpty();
      return;
    }

    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, mode: 'bbox' });
      return;
    }

    void runSearch({ mode: 'bbox' });
  }, [activeCategory, hasSearchContext, query, resetResultsToEmpty, runSearch, selectedAttributes]);

  const handleRadiusChange = useCallback((nextMiles: number) => {
    const nextRadius = clampDiscoveryRadiusMiles(nextMiles);
    setRadiusMiles(nextRadius);
    setSearchMode('radius');

    if (deviceCenter && hasSearchContext(query, activeCategory, selectedAttributes, false)) {
      void runSearch({ mode: 'radius' });
    }
  }, [activeCategory, deviceCenter, hasSearchContext, query, runSearch, selectedAttributes]);

  const clearCategory = useCallback(() => {
    setActiveCategory(null);
    if (!hasSearchContext(query, null, selectedAttributes, Boolean(boundsRef.current))) {
      resetResultsToEmpty();
      return;
    }
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, category: null, attributes: selectedAttributes });
      return;
    }
    void runSearch({ category: null, attributes: selectedAttributes });
  }, [hasSearchContext, query, resetResultsToEmpty, runSearch, selectedAttributes]);

  const clearSort = useCallback(() => {
    setSortBy('distance');
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, sort: 'distance' });
    } else if (hasSearchContext(query, activeCategory, selectedAttributes, false)) {
      void runSearch({ sort: 'distance' });
    }
  }, [activeCategory, hasSearchContext, query, runSearch, selectedAttributes]);

  const applySort = useCallback((next: SortOption) => {
    setSortBy(next);
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, sort: next });
    } else if (hasSearchContext(query, activeCategory, selectedAttributes, false)) {
      void runSearch({ sort: next });
    }
  }, [activeCategory, hasSearchContext, query, runSearch, selectedAttributes]);

  const clearAttributes = useCallback(() => {
    setSelectedAttributes({});
    if (!hasSearchContext(query, activeCategory, {}, Boolean(boundsRef.current))) {
      resetResultsToEmpty();
      return;
    }
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, attributes: {} });
      return;
    }
    void runSearch({ attributes: {} });
  }, [activeCategory, hasSearchContext, query, resetResultsToEmpty, runSearch]);

  const toggleAttribute = useCallback((dimension: string, tag: string) => {
    setSelectedAttributes((prev) => {
      const current = prev[dimension] ?? [];
      const hasTag = current.includes(tag);
      const nextTags = hasTag ? current.filter((t) => t !== tag) : [...current, tag];
      const next = { ...prev };
      if (nextTags.length === 0) {
        delete next[dimension];
      } else {
        next[dimension] = nextTags;
      }
      if (boundsRef.current) {
        void runSearch({ bbox: boundsRef.current, attributes: next });
      } else if (hasSearchContext(query, activeCategory, next, false)) {
        void runSearch({ attributes: next });
      }
      return next;
    });
  }, [activeCategory, hasSearchContext, query, runSearch]);

  const hasActiveAttributes = useMemo(() => Object.keys(selectedAttributes).length > 0, [selectedAttributes]);
  const hasActiveRefinements = useMemo(
    () => Boolean(
      activeCategory
      || deviceCenter
      || hasActiveAttributes
      || sortBy !== 'distance',
    ),
    [activeCategory, deviceCenter, hasActiveAttributes, sortBy],
  );

  // Keyboard shortcut: "/" focuses the search input (standard for search-centric pages)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const clearAllFilters = useCallback(() => {
    setQuery('');
    setActiveCategory(null);
    setSelectedAttributes({});
    setSortBy('distance');
    setDeviceCenter(null);
    setLocationState('idle');
    setRadiusMiles(DEFAULT_DISCOVERY_RADIUS_MILES);
    setSearchMode('bbox');
    if (boundsRef.current) {
      void runSearch({
        bbox: boundsRef.current,
        text: '',
        category: null,
        attributes: {},
        sort: 'distance',
        mode: 'bbox',
      });
      return;
    }
    resetResultsToEmpty();
  }, [resetResultsToEmpty, runSearch]);

  const openFiltersPanel = useCallback(() => {
    if (isMobile) {
      setMobileFiltersOpen(true);
      return;
    }
    setDesktopFiltersOpen(true);
  }, [isMobile]);

  const appliedFilterItems = useMemo<SeekerAppliedFilterItem[]>(() => {
    const items: SeekerAppliedFilterItem[] = [];

    if (deviceCenter) {
      items.push({
        id: 'location',
        label: `Within ${radiusMiles} mi`,
        onClick: clearDeviceLocation,
        ariaLabel: 'Clear location radius',
      });
    }

    if (activeCategory) {
      items.push({
        id: 'category',
        label: `Category: ${activeCategory.replace(/_/g, ' ')}`,
        onClick: clearCategory,
        ariaLabel: 'Clear category filter',
      });
    }

    if (Object.keys(selectedAttributes).length > 0) {
      items.push({
        id: 'service-filters',
        label: `Service filters (${Object.values(selectedAttributes).flat().length})`,
        onClick: clearAttributes,
        ariaLabel: 'Clear service filters',
      });
    }

    if (sortBy !== 'distance') {
      items.push({
        id: 'sort',
        label: `Sort: ${SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy}`,
        onClick: clearSort,
        ariaLabel: 'Clear sort option',
      });
    }

    return items;
  }, [
    activeCategory,
    clearAttributes,
    clearCategory,
    clearDeviceLocation,
    clearSort,
    deviceCenter,
    radiusMiles,
    selectedAttributes,
    sortBy,
  ]);

  const handleCategoryClick = useCallback((category: DiscoveryNeedId) => {
    const next = activeCategory === category ? null : category;
    setActiveCategory(next);
    setQuery('');
    if (searchMode !== 'radius' && boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, category: next, text: '' });
    } else {
      void runSearch({ category: next, text: '', mode: searchMode === 'radius' ? 'radius' : undefined });
    }
  }, [activeCategory, runSearch, searchMode]);

  // ── text search submit ────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Keep bbox mode so results remain tied to the visible map area.
    setSearchMode('bbox');
    setIsAreaDirty(false);
    void runSearch({ bbox: boundsRef.current ?? undefined, mode: 'bbox' });
  };

  // ── toggle to "search this area" mode ─────────────────────
  const searchThisArea = useCallback(() => {
    if (!boundsRef.current) return;
    setSearchMode('bbox');
    setIsAreaDirty(false);
    void runSearch({ bbox: boundsRef.current, mode: 'bbox' });
  }, [runSearch]);

  // ── handle map bounds change (debounced bbox re-query) ────
  const handleBoundsChange = useCallback(
    (bounds: Bounds) => {
      boundsRef.current = bounds;
      setHasMapBounds(true);
      if (searchMode !== 'bbox') return; // only auto re-query in bbox mode

      // Mobile behavior: populate once automatically, then switch to explicit "Search this area".
      if (isMobile) {
        if (!didInitialMobileSearchRef.current) {
          didInitialMobileSearchRef.current = true;
          setIsAreaDirty(false);
          void runSearch({ bbox: bounds });
          return;
        }
        setIsAreaDirty(true);
        return;
      }

      // Desktop behavior: auto refresh (debounced).
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch({ bbox: bounds });
      }, DEBOUNCE_MS);
    },
    [isMobile, runSearch, searchMode],
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

  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    const urlDiscoveryIntent = parseDiscoveryUrlState(searchParams);
    const storedDiscoveryIntent = hasMeaningfulDiscoveryState(urlDiscoveryIntent)
      ? {}
      : readStoredDiscoveryPreference();
    const effectiveDiscoveryIntent = hasMeaningfulDiscoveryState(urlDiscoveryIntent)
      ? urlDiscoveryIntent
      : storedDiscoveryIntent;
    const effectiveCategory = effectiveDiscoveryIntent.needId ?? null;
    const effectiveQuery = resolveDiscoverySearchText(effectiveDiscoveryIntent.text, effectiveCategory);
    const effectiveSort = normalizeSortOption(effectiveDiscoveryIntent.sortBy ?? sortBy);
    const effectiveAttributes = effectiveDiscoveryIntent.attributeFilters ?? {};
    if (!hasSearchContext(effectiveQuery, effectiveCategory, effectiveAttributes, false)) return;

    didAutoRun.current = true;
    setQuery(effectiveQuery);
    setActiveCategory(effectiveCategory);
    setSortBy(effectiveSort);
    setSelectedAttributes(effectiveAttributes);
    void runSearch({
      text: effectiveQuery,
      category: effectiveCategory,
      attributes: effectiveAttributes,
      sort: effectiveSort,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setActiveCategory(null);

    if (!hasSearchContext('', null, selectedAttributes, Boolean(boundsRef.current))) {
      resetResultsToEmpty();
      return;
    }

    if (boundsRef.current) {
      void runSearch({
        bbox: boundsRef.current,
        text: '',
        category: null,
        attributes: selectedAttributes,
      });
      return;
    }

    void runSearch({
      text: '',
      category: null,
      attributes: selectedAttributes,
    });
  }, [hasSearchContext, resetResultsToEmpty, runSearch, selectedAttributes]);

  // ── Mobile bottom-sheet state ──────────────────────────────────────────
  const [bottomSheetSnap, setBottomSheetSnap] = useState<'peek' | 'half' | 'full'>('peek');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const dragSnapRef = useRef<'peek' | 'half' | 'full'>('peek');

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragSnapRef.current = bottomSheetSnap;
    setIsDragging(true);
    setDragOffsetY(0);
  }, [bottomSheetSnap]);

  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const raw = e.touches[0].clientY - dragStartY.current;
    const clamped =
      dragSnapRef.current === 'full' ? Math.max(0, raw) :
      dragSnapRef.current === 'peek' ? Math.min(0, raw) :
      raw;
    setDragOffsetY(clamped);
  }, []);

  const handleSheetTouchEnd = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const delta = e.changedTouches[0].clientY - dragStartY.current;
    setIsDragging(false);
    setDragOffsetY(0);
    dragStartY.current = null;
    if (Math.abs(delta) < 12) {
      setBottomSheetSnap((prev) => prev === 'peek' ? 'half' : prev === 'half' ? 'full' : 'peek');
      return;
    }
    if (delta < -60) {
      setBottomSheetSnap((prev) => prev === 'peek' ? 'half' : 'full');
    } else if (delta > 60) {
      setBottomSheetSnap((prev) => prev === 'full' ? 'half' : 'peek');
    }
  }, []);

  // translateY: 100% = full sheet height (= container height between header and bottom nav)
  const sheetBaseTranslate =
    bottomSheetSnap === 'full' ? '0%' :
    bottomSheetSnap === 'half' ? '52%' :
    'calc(100% - 80px)';

  return (
    <>
      {/* ── MOBILE: Full-screen Zillow-style map (below md) ────────────────────── */}
      {isMobile && (
        <>
          {/*
           * The seeker layout has a sticky header (h-14) and a fixed bottom nav (h-14).
           * This container fills the exact gap between them.
           */}
          <div className="fixed top-14 bottom-14 inset-x-0 overflow-hidden bg-white">

            {/* Full-screen map */}
            <div className="absolute inset-0">
              <ErrorBoundary>
                <MapContainer
                  className="w-full h-full"
                  centerLat={deviceCenter?.lat}
                  centerLng={deviceCenter?.lng}
                  zoom={deviceCenter ? 12 : undefined}
                  services={services}
                  discoveryContext={mapDiscoveryContext}
                  onBoundsChange={handleBoundsChange}
                />
              </ErrorBoundary>
            </div>

            {/* Floating search bar */}
            <div className="absolute top-0 left-0 right-0 px-3 pt-3 z-30 pointer-events-none">
              <form
                onSubmit={handleSubmit}
                className="pointer-events-auto flex h-12 items-center gap-1.5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]/95 pl-3 pr-1 shadow-[0_4px_20px_rgba(15,23,42,0.12)] backdrop-blur-md"
              >
                <Search className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (activeCategory && !isDiscoveryNeedSearchText(activeCategory, e.target.value)) {
                      setActiveCategory(null);
                    }
                  }}
                  type="search"
                  placeholder="Search services…"
                  className="flex-1 text-sm outline-none bg-transparent min-w-0 text-slate-700 placeholder:text-slate-400"
                  aria-label="Search services"
                />
                {query && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="p-1.5 text-slate-400"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!canSearch || isLoading}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--text-primary)] text-[var(--bg-page)] disabled:opacity-40"
                  aria-label="Search"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(true)}
                  className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]"
                  aria-label={`Filters${hasActiveRefinements ? ` (${appliedFilterItems.length} active)` : ''}`}
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  {hasActiveRefinements && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--text-primary)] text-[9px] font-bold text-[var(--bg-page)]">
                      {appliedFilterItems.length}
                    </span>
                  )}
                </button>
              </form>

              {/* Active filter chips — horizontal scroll */}
              {appliedFilterItems.length > 0 && (
                <div
                  className="pointer-events-auto mt-2 flex gap-1.5 overflow-x-auto pb-1"
                  style={{ msOverflowStyle: 'none', scrollbarWidth: 'none' }}
                >
                  {appliedFilterItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.onClick}
                      className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-white/95 border border-slate-200 px-2.5 py-1 text-xs text-slate-700 shadow-sm"
                      aria-label={item.ariaLabel}
                    >
                      {item.label}
                      {item.showRemoveIcon !== false && <X className="h-2.5 w-2.5 text-slate-400" aria-hidden="true" />}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="flex-shrink-0 inline-flex items-center rounded-full bg-slate-800 px-2.5 py-1 text-xs text-white shadow-sm"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {/* "Search this area" pill — floats below search bar */}
            {isAreaDirty && (
              <div
                className="absolute left-0 right-0 z-30 flex justify-center pointer-events-none"
                style={{ top: `${56 + (appliedFilterItems.length > 0 ? 40 : 0) + 8}px` }}
              >
                <button
                  type="button"
                  onClick={searchThisArea}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] shadow-[0_4px_16px_rgba(15,23,42,0.14)]"
                >
                  <MapPin className="h-3.5 w-3.5 text-[var(--text-primary)]" aria-hidden="true" />
                  Search this area
                </button>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div
                role="alert"
                className="absolute left-3 right-3 z-30 flex items-start gap-2 rounded-2xl border border-error-soft bg-white/95 p-3 shadow-md"
                style={{ top: `${56 + (appliedFilterItems.length > 0 ? 40 : 0) + (isAreaDirty ? 48 : 8)}px` }}
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-xs font-medium">Search failed</p>
                  <p className="text-xs mt-0.5 opacity-80">{error}</p>
                </div>
              </div>
            )}

            {/* ── Bottom sheet ─────────────────────────────────────────── */}
            <div
              className="absolute left-0 right-0 bottom-0 z-20 flex flex-col h-full"
              style={{
                transform: isDragging
                  ? `translateY(calc(${sheetBaseTranslate} + ${dragOffsetY}px))`
                  : `translateY(${sheetBaseTranslate})`,
                transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
              }}
            >
              {/* Drag handle + header */}
              <div
                className="flex-shrink-0 rounded-t-[24px] bg-white border-t border-l border-r border-slate-200 shadow-[0_-6px_24px_rgba(15,23,42,0.10)] pt-2.5 px-4 pb-3 select-none cursor-grab active:cursor-grabbing"
                onTouchStart={handleSheetTouchStart}
                onTouchMove={handleSheetTouchMove}
                onTouchEnd={handleSheetTouchEnd}
                role="button"
                tabIndex={0}
                aria-label={`${bottomSheetSnap === 'peek' ? 'Expand' : 'Collapse'} results panel`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setBottomSheetSnap((prev) => prev === 'peek' ? 'half' : prev === 'half' ? 'full' : 'peek');
                  }
                }}
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 leading-tight">
                      {isLoading
                        ? 'Searching…'
                        : data
                          ? `${data.total} service${data.total !== 1 ? 's' : ''} found`
                          : 'Explore services'}
                    </p>
                    {data && (pinnedCount > 0 || offMapCount > 0) && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {pinnedCount > 0 ? `${pinnedCount} pinned on map` : 'No precise pins'}
                        {offMapCount > 0 ? ` · ${offMapCount} off-map but applicable` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />}
                    {isAreaDirty && !isLoading && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); searchThisArea(); }}
                        className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)]"
                      >
                        <Search className="h-3 w-3" aria-hidden="true" />
                        Search area
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Scrollable results */}
              <div
                ref={resultsContainerRef}
                tabIndex={-1}
                className="flex-1 overflow-y-auto bg-white border-l border-r border-slate-200 outline-none"
              >
                <div className="px-4 py-3 pb-8">
                  {isLoading && (
                    <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading results">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={`m-skel-${i}`} />
                      ))}
                    </div>
                  )}

                  {!isLoading && !data && !error && (
                    <div className="flex flex-col items-center py-12 text-center">
                      <MapPin className="h-10 w-10 text-slate-200 mb-3" aria-hidden="true" />
                      <p className="text-sm font-semibold text-slate-700">Ready to search</p>
                      <p className="mt-1 text-xs text-slate-400 max-w-[220px]">
                        Type above, use filters, or pan the map to search an area.
                      </p>
                    </div>
                  )}

                  {!isLoading && data && data.results.length === 0 && (
                    <div className="flex flex-col items-center py-12 text-center">
                      <p className="text-sm font-semibold text-slate-700">No matches in this area</p>
                      <p className="mt-1 text-xs text-slate-400">Try different keywords or pan to a new area.</p>
                    </div>
                  )}

                  {!isLoading && data && data.results.length > 0 && (
                    <>
                      <p className="mb-3 text-xs text-slate-400" role="status" aria-live="polite">
                        {data.results.length} of {data.total} shown
                        {pinnedCount > 0 && <span className="ml-1">· {pinnedCount} on map</span>}
                        {offMapCount > 0 && <span className="ml-1">· {offMapCount} off-map</span>}
                      </p>
                      {pinnedResults.length > 0 ? (
                        <div className="space-y-3">
                          {pinnedResults.map((r) => (
                            <div key={r.service.service.id} className="flex items-stretch gap-3">
                              <ConfidenceRing enriched={r.service} />
                              <div className="flex-1 min-w-0">
                                <ServiceCard
                                  enriched={r.service}
                                  compact
                                  isSaved={savedIds.has(r.service.service.id)}
                                  onToggleSave={toggleSave}
                                  savedSyncEnabled={savedSyncEnabled}
                                  href={buildServiceDetailHref(r.service.service.id)}
                                  discoveryContext={mapDiscoveryContext}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {offMapResults.length > 0 ? (
                        <div className={pinnedResults.length > 0 ? 'mt-4 space-y-3' : 'space-y-3'}>
                          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--bg-surface-alt)] px-4 py-3 text-sm text-[var(--text-primary)]">
                            <p className="font-semibold">Also applicable but not pinned</p>
                            <p className="mt-1 text-xs text-[var(--text-secondary)]">
                              These services matched your search, but they only list online, phone, or broad service-area coverage.
                            </p>
                            <a
                              href={directoryHref}
                              className="mt-2 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-alt)]"
                            >
                              Open the full directory list
                            </a>
                          </div>
                          {offMapResults.map((r) => (
                            <div key={r.service.service.id} className="flex items-stretch gap-3">
                              <ConfidenceRing enriched={r.service} />
                              <div className="flex-1 min-w-0">
                                <div className="mb-2 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                                  {getOffMapReason(r.service)}
                                </div>
                                <ServiceCard
                                  enriched={r.service}
                                  compact
                                  isSaved={savedIds.has(r.service.service.id)}
                                  onToggleSave={toggleSave}
                                  savedSyncEnabled={savedSyncEnabled}
                                  href={buildServiceDetailHref(r.service.service.id)}
                                  discoveryContext={mapDiscoveryContext}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {/* Sheet floor */}
              <div className="flex-shrink-0 bg-white border-l border-r border-b border-slate-200" />
            </div>
          </div>

          {/* ── Mobile filters overlay (page-level, above header + bottom nav) ── */}
          {mobileFiltersOpen && (
            <div
              className="fixed inset-0 z-[var(--z-modal)] flex flex-col justify-end"
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
            >
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setMobileFiltersOpen(false)}
                aria-hidden="true"
              />
              <div className="relative flex max-h-[88vh] flex-col rounded-t-3xl bg-white shadow-2xl">
                {/* Handle + header */}
                <div className="flex-shrink-0 px-5 pt-3 pb-4 border-b border-slate-100">
                  <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-800">Filters</h2>
                    <button
                      type="button"
                      onClick={() => setMobileFiltersOpen(false)}
                      className="flex items-center justify-center h-8 w-8 rounded-full bg-slate-100 text-slate-500"
                      aria-label="Close filters"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Scrollable filter content */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                  <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</p>
                        <p className="mt-1 text-sm text-slate-600">Start with the kind of help you need right now.</p>
                      </div>
                      {activeCategory ? (
                        <Button type="button" variant="outline" size="sm" onClick={clearCategory}>
                          Clear
                        </Button>
                      ) : null}
                    </div>
                    <QuickNeedFilterGrid
                      activeNeedId={activeCategory}
                      onSelect={handleCategoryClick}
                      ariaLabel="Service category"
                      gridClassName="grid grid-cols-2 gap-2"
                    />
                  </div>

                  {/* Canonical service-detail filters */}
                  <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service details</p>
                        <p className="mt-1 text-sm text-slate-600">Use the canonical service taxonomy that powers resource records and search validation.</p>
                      </div>
                      {hasActiveAttributes ? (
                        <Button type="button" variant="outline" size="sm" onClick={clearAttributes}>
                          Clear
                        </Button>
                      ) : null}
                    </div>
                    <div className="space-y-3">
                      {SEEKER_ATTRIBUTE_DIMENSIONS.map((dim) => {
                        const def = SERVICE_ATTRIBUTES_TAXONOMY[dim];
                        if (!def) return null;
                        const commonTags = def.tags.filter((t) => t.common).slice(0, 8);
                        const activeTags = selectedAttributes[dim] ?? [];
                        return (
                          <div key={dim} className="flex flex-col gap-1.5" role="group" aria-label={def.name}>
                            <span className="text-xs font-medium text-[var(--text-muted)]">{DIMENSION_LABELS[dim] ?? def.name}:</span>
                            <div className="flex flex-wrap gap-1.5">
                              {commonTags.map((t) => {
                                const isActive = activeTags.includes(t.tag);
                                return (
                                  <button
                                    key={t.tag}
                                    type="button"
                                    onClick={() => toggleAttribute(dim, t.tag)}
                                    className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[36px] flex-shrink-0 ${
                                      isActive ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'
                                    }`}
                                    aria-pressed={isActive}
                                  >
                                    {DISCOVERY_ATTRIBUTE_LABELS[t.tag] ?? t.tag.replace(/_/g, ' ')}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sort */}
                  <div className="rounded-[18px] border border-slate-200 bg-white p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order</p>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Result order">
                      {SORT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setSortBy(opt.value)}
                          className={`rounded-xl border px-3 py-3 text-left text-sm ${sortBy === opt.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
                          aria-pressed={sortBy === opt.value}
                        >
                          <div className="font-semibold">{opt.label}</div>
                          <div className={`mt-1 text-xs ${sortBy === opt.value ? 'text-slate-200' : 'text-slate-500'}`}>{opt.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Location */}
                  <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Location</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { handleUseMyLocation(); setMobileFiltersOpen(false); }}
                      disabled={isLocating}
                      className="w-full"
                    >
                      {isLocating ? 'Locating…' : locationState === 'denied' ? 'Try location again' : 'Allow location'}
                    </Button>
                    {deviceCenter && (
                      <p className="mt-2 text-center text-xs text-slate-400">Approximate location active (not saved)</p>
                    )}
                    {!deviceCenter && !isLocating && locationState !== 'unsupported' && (
                      <p className="mt-2 text-center text-xs text-slate-400">Location is requested automatically when this map opens.</p>
                    )}
                  </div>

                  {hasActiveRefinements && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="w-full py-2 text-center text-sm font-medium text-slate-500 hover:text-red-600"
                    >
                      Clear all filters
                    </button>
                  )}
                </div>

                {/* Sticky apply button */}
                <div
                  className="flex-shrink-0 border-t border-slate-100 bg-white px-5 py-4"
                  style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <Button
                    type="button"
                    onClick={() => {
                      setMobileFiltersOpen(false);
                      setBottomSheetSnap('half');
                      if (boundsRef.current) {
                        void runSearch({ bbox: boundsRef.current });
                      } else if (canSearch) {
                        void runSearch();
                      }
                    }}
                    className="w-full"
                  >
                    Search with filters
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── DESKTOP: Existing card/sidebar layout (md+) ──────────────────────── */}
      {!isMobile && (
        <main className="min-h-screen bg-[var(--bg-page)]">
          <div className="container mx-auto max-w-7xl px-4 pt-4 pb-8 md:py-8">
            <section className="rounded-[30px] border border-slate-200 bg-white p-4 shadow-xl md:p-6">
              <div className="mb-4 flex flex-col gap-4 border-b border-slate-200 pb-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Verified discovery</span>
                    <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)]">Verified records only</span>
                    {deviceCenter ? (
                      <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">Approximate location active</span>
                    ) : null}
                    {hasActiveRefinements ? (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">Refinements on</span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1 md:flex-row md:items-end md:gap-3">
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-5xl">Map</h1>
                    <p className="pb-1 text-sm text-slate-500">Find verified help nearby with the least amount of effort.</p>
                  </div>
                </div>
              </div>

              <ErrorBoundary>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] md:p-4">
                  {error && (
                    <div
                      role="alert"
                      className="mb-4 flex items-start gap-2 rounded-[20px] border border-error-soft bg-error-subtle p-4 text-sm text-error-deep shadow-[0_12px_32px_rgba(127,29,29,0.08)]"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-medium">Search failed</p>
                        <p className="mt-0.5 text-xs">{error}</p>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 xl:grid-cols-12 xl:items-stretch">
                    <div className="order-2 xl:order-1 xl:col-span-7">
                      <div className="flex h-full flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-lg xl:sticky xl:top-24">
                        <div className="border-b border-slate-200 px-4 py-4 md:px-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">Start with a common need</p>
                              <p className="text-xs text-slate-500">Choose one clear topic to focus the map instantly.</p>
                            </div>
                            {deviceCenter ? (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                                Approximate location active
                              </span>
                            ) : null}
                          </div>
                          <QuickNeedFilterGrid
                            activeNeedId={activeCategory}
                            onSelect={handleCategoryClick}
                            ariaLabel="Common resource terms"
                            className="mt-4"
                          />
                          {deviceCenter ? (
                            <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                              <DistanceRadiusControl value={radiusMiles} onChange={handleRadiusChange} />
                            </div>
                          ) : null}
                        </div>

                        <div className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
                          <div className="relative min-h-96 flex-1 overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                            <MapContainer
                              className="h-full min-h-96 w-full"
                              centerLat={deviceCenter?.lat}
                              centerLng={deviceCenter?.lng}
                              zoom={deviceCenter ? 12 : undefined}
                              services={services}
                              discoveryContext={mapDiscoveryContext}
                              onBoundsChange={handleBoundsChange}
                            />
                            {isAreaDirty && (
                              <div className="pointer-events-none absolute left-0 right-0 top-3 flex justify-center px-3">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={searchThisArea}
                                  className="pointer-events-auto gap-1.5 bg-white text-xs shadow-sm"
                                >
                                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                                  Search this area
                                </Button>
                              </div>
                            )}
                          </div>

                          <div className="mt-3 flex items-center gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={searchThisArea}
                              className="gap-1.5 bg-white text-xs"
                            >
                              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                              Search this area
                            </Button>
                            {searchMode === 'bbox' && (
                              <span className="text-xs text-[var(--text-muted)]">Updates as you pan.</span>
                            )}
                            {searchMode === 'radius' && deviceCenter ? (
                              <span className="text-xs text-[var(--text-muted)]">Showing results within {radiusMiles} miles of your location.</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="order-1 xl:order-2 xl:col-span-5">
                      <div className="flex h-full flex-col gap-4 xl:sticky xl:top-24">
                        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-lg">
                          <div className="space-y-4">
                            <div>
                              <p className="text-base font-semibold text-slate-900">Search and refine</p>
                              <p className="text-sm text-slate-500">Type what you need, then narrow only if the first results are not right.</p>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-3">
                              <FormField id="map-search" label="Search resources" className="w-full">
                                <div className="relative">
                                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                                  <input
                                    ref={searchInputRef}
                                    id="map-search"
                                    value={query}
                                    onChange={(e) => {
                                      setQuery(e.target.value);
                                      if (activeCategory && !isDiscoveryNeedSearchText(activeCategory, e.target.value)) {
                                        setActiveCategory(null);
                                      }
                                    }}
                                    type="search"
                                    placeholder="Food bank, shelter, clinic…"
                                    className="min-h-[48px] w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] py-2 pl-9 pr-8 text-sm text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--text-muted)]"
                                    aria-label="Search services"
                                  />
                                  {query && (
                                    <button
                                      type="button"
                                      onClick={handleClearSearch}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--text-muted)]"
                                      aria-label="Clear search"
                                    >
                                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              </FormField>
                              <Button type="submit" disabled={!canSearch || isLoading} className="w-full">
                                Search map
                              </Button>
                            </form>

                            <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-800">Location</p>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                    {deviceCenter
                                      ? 'Using your approximate device location to center the map. It is not saved.'
                                      : isLocating || locationState === 'requesting'
                                        ? 'Requesting your approximate device location for nearby results.'
                                        : locationState === 'denied'
                                          ? 'Location was blocked. Allow it to start near you.'
                                          : locationState === 'unsupported'
                                            ? 'This browser cannot provide device location.'
                                            : 'The map asks for your approximate location when this page opens.'}
                                  </p>
                                </div>
                                {!deviceCenter && locationState !== 'unsupported' ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleUseMyLocation}
                                    disabled={isLocating}
                                    className="shrink-0"
                                  >
                                    {isLocating ? 'Locating…' : locationState === 'denied' ? 'Try again' : 'Allow'}
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={clearDeviceLocation}
                                    className="shrink-0"
                                  >
                                    Clear
                                  </Button>
                                )}
                              </div>
                              {deviceCenter ? (
                                <div className="mt-3">
                                  <DistanceRadiusControl value={radiusMiles} onChange={handleRadiusChange} />
                                </div>
                              ) : null}
                            </div>

                            <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">Refine results</p>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-500">Open one filter panel to narrow by service details or list order.</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={openFiltersPanel}
                                  className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                                  aria-haspopup="dialog"
                                  aria-expanded={desktopFiltersOpen}
                                >
                                  Filters
                                  {hasActiveRefinements ? (
                                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                                      {appliedFilterItems.length || 1}
                                    </span>
                                  ) : null}
                                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {appliedFilterItems.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {appliedFilterItems.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={item.onClick}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                                  aria-label={item.ariaLabel}
                                  title={item.title}
                                >
                                  {item.label}
                                  {item.showRemoveIcon !== false ? <X className="h-3 w-3 text-slate-400" aria-hidden="true" /> : null}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={clearAllFilters}
                                className="inline-flex min-h-[36px] items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
                              >
                                Clear all
                              </button>
                            </div>
                          )}

                          <p className="mt-4 text-xs text-slate-500">
                            {savedSyncEnabled ? 'Saved places can sync to your account.' : 'Saved places stay on this device.'}
                          </p>
                        </div>

                        <div
                          id="map-results"
                          ref={resultsContainerRef}
                          tabIndex={-1}
                          className="flex-1 rounded-[24px] border border-slate-200 bg-white p-4 shadow-lg outline-none xl:min-h-0 xl:overflow-y-auto"
                        >
                          {isLoading && (
                            <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading map results">
                              {Array.from({ length: 4 }).map((_, i) => (
                                <SkeletonCard key={`map-skeleton-${i}`} />
                              ))}
                            </div>
                          )}

                          {!isLoading && !data && !error && (
                            <div className="rounded-[20px] border border-slate-200 bg-white p-6 text-center shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                              <MapPin className="mx-auto mb-2 h-8 w-8 text-slate-300" aria-hidden="true" />
                              <p className="text-sm font-semibold text-[var(--text-primary)]">Ready to search</p>
                              <p className="mt-1 text-xs text-[var(--text-muted)]">
                                Search, tap a common category, or pan the map and use <strong>Search this area</strong>.
                              </p>
                            </div>
                          )}

                          {!isLoading && data && (
                            <>
                              <p className="mb-3 text-xs text-[var(--text-muted)]" role="status" aria-live="polite">
                                {data.results.length === 0 ? 'No matches' : `${data.results.length} of ${data.total} shown`}
                                {pinnedCount > 0 && data.results.length > 0 && <span className="ml-1">· {pinnedCount} pinned</span>}
                                {offMapCount > 0 && data.results.length > 0 && <span className="ml-1">· {offMapCount} off-map</span>}
                              </p>
                              {data.results.length === 0 ? (
                                <div className="rounded-[20px] border border-slate-200 bg-white p-6 text-center shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                                  <p className="text-sm font-semibold text-[var(--text-primary)]">No matches in this area</p>
                                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                                    Try different keywords, a broader category, or pan to a new area.
                                  </p>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {pinnedResults.map((r) => (
                                    <div key={r.service.service.id} className="flex items-stretch gap-3">
                                      <ConfidenceRing enriched={r.service} />
                                      <div className="flex-1">
                                        {formatDistance(r.distanceMeters) ? (
                                          <div className="mb-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                            {formatDistance(r.distanceMeters)}
                                          </div>
                                        ) : null}
                                        <ServiceCard
                                          enriched={r.service}
                                          compact
                                          isSaved={savedIds.has(r.service.service.id)}
                                          onToggleSave={toggleSave}
                                          savedSyncEnabled={savedSyncEnabled}
                                          href={buildServiceDetailHref(r.service.service.id)}
                                          discoveryContext={mapDiscoveryContext}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                  {offMapResults.length > 0 ? (
                                    <div className={pinnedResults.length > 0 ? 'mt-4 space-y-3' : 'space-y-3'}>
                                      <div className="rounded-[20px] border border-[var(--border)] bg-[var(--bg-surface-alt)] px-4 py-3 text-sm text-[var(--text-primary)]">
                                        <p className="font-semibold">Also applicable but not pinned</p>
                                        <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                          These services matched your search, but they only list online, phone, or broad service-area coverage.
                                        </p>
                                        <a
                                          href={directoryHref}
                                          className="mt-2 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-alt)]"
                                        >
                                          Open the full directory list
                                        </a>
                                      </div>
                                      {offMapResults.map((r) => (
                                        <div key={r.service.service.id} className="flex items-stretch gap-3">
                                          <ConfidenceRing enriched={r.service} />
                                          <div className="flex-1">
                                            <div className="mb-2 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                                              {getOffMapReason(r.service)}
                                            </div>
                                            <ServiceCard
                                              enriched={r.service}
                                              compact
                                              isSaved={savedIds.has(r.service.service.id)}
                                              onToggleSave={toggleSave}
                                              savedSyncEnabled={savedSyncEnabled}
                                              href={buildServiceDetailHref(r.service.service.id)}
                                              discoveryContext={mapDiscoveryContext}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <Dialog open={desktopFiltersOpen} onOpenChange={setDesktopFiltersOpen}>
                    <DialogContent className="max-w-3xl rounded-[28px] border border-slate-200 bg-white p-0 shadow-2xl">
                      <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
                        <DialogTitle className="text-xl font-semibold text-slate-900">Filters</DialogTitle>
                        <DialogDescription className="mt-1 text-sm text-slate-500">
                          Narrow the map by category, service details, and list order in one place.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-5 overflow-y-auto px-6 py-5" style={{ maxHeight: '78vh' }}>
                        <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Category</p>
                              <p className="mt-1 text-xs text-slate-500">Start with the type of help you need, then refine with service details below.</p>
                            </div>
                            {activeCategory ? (
                              <Button type="button" variant="outline" size="sm" onClick={clearCategory}>
                                Clear category
                              </Button>
                            ) : null}
                          </div>

                          <QuickNeedFilterGrid
                            activeNeedId={activeCategory}
                            onSelect={handleCategoryClick}
                            ariaLabel="Service category"
                            gridClassName="grid grid-cols-2 gap-2 md:grid-cols-4"
                          />
                        </div>

                        <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Distance</p>
                              <p className="mt-1 text-xs text-slate-500">Use your approximate location and set a radius for nearby map results.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={handleUseMyLocation} disabled={isLocating}>
                                {isLocating ? 'Locating…' : deviceCenter ? 'Refresh location' : 'Use my location'}
                              </Button>
                              {deviceCenter ? (
                                <Button type="button" variant="outline" size="sm" onClick={clearDeviceLocation}>
                                  Clear location
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          {deviceCenter ? (
                            <DistanceRadiusControl value={radiusMiles} onChange={handleRadiusChange} />
                          ) : (
                            <p className="text-sm text-slate-500">Enable approximate location to filter the map within a fixed distance from you.</p>
                          )}
                        </div>

                        <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Service details</p>
                              <p className="mt-1 text-xs text-slate-500">Canonical service tags from the resource taxonomy. These match what the API validates.</p>
                            </div>
                            {hasActiveAttributes ? (
                              <Button type="button" variant="outline" size="sm" onClick={clearAttributes}>
                                Clear details
                              </Button>
                            ) : null}
                          </div>

                          <div className="space-y-4">
                            {SEEKER_ATTRIBUTE_DIMENSIONS.map((dim) => {
                              const def = SERVICE_ATTRIBUTES_TAXONOMY[dim];
                              if (!def) return null;
                              const commonTags = def.tags.filter((t) => t.common).slice(0, 8);
                              const activeTags = selectedAttributes[dim] ?? [];
                              return (
                                <div key={dim} className="rounded-[18px] border border-slate-200 bg-white p-4" role="group" aria-label={def.name}>
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{DIMENSION_LABELS[dim] ?? def.name}</p>
                                  <div className="flex flex-wrap gap-2">
                                    {commonTags.map((t) => {
                                      const isActive = activeTags.includes(t.tag);
                                      return (
                                        <button
                                          key={t.tag}
                                          type="button"
                                          onClick={() => toggleAttribute(dim, t.tag)}
                                          className={`inline-flex min-h-[40px] items-center justify-center rounded-full border px-3 py-1 text-xs font-medium ${isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                                          aria-pressed={isActive}
                                          title={t.description}
                                        >
                                          {DISCOVERY_ATTRIBUTE_LABELS[t.tag] ?? t.tag.replace(/_/g, ' ')}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Result list order</p>
                              <p className="mt-1 text-xs text-slate-500">Map pins stay the same. This only changes the order of the list on the right.</p>
                            </div>
                          </div>
                          <div className="grid gap-2" role="group" aria-label="Result list order">
                            {SORT_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => applySort(opt.value)}
                                className={`flex items-start justify-between rounded-xl border px-4 py-3 text-left ${sortBy === opt.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                                aria-pressed={sortBy === opt.value}
                              >
                                <div>
                                  <div className="font-semibold">{opt.label}</div>
                                  <div className={`mt-1 text-xs ${sortBy === opt.value ? 'text-slate-200' : 'text-slate-500'}`}>{opt.description}</div>
                                </div>
                                {sortBy === opt.value ? <span className="text-xs font-semibold">Active</span> : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
                        <Button type="button" variant="outline" onClick={clearAllFilters}>Clear all</Button>
                        <Button type="button" onClick={() => setDesktopFiltersOpen(false)}>Done</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </ErrorBoundary>
            </section>
          </div>
        </main>
      )}
    </>
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
    score == null ? 'stroke-[var(--border)]' :
      value >= 80 ? 'stroke-[var(--text-primary)]' :
      value >= 60 ? 'stroke-[var(--text-secondary)]' :
      value >= 40 ? 'stroke-[var(--text-muted)]' :
      'stroke-error-base';

  return (
    <div
      className="flex-shrink-0 w-10"
      aria-label={score == null ? 'Verification score unknown' : `Verification ${Math.round(value)} percent`}
      title={score == null ? 'Verification score unknown' : `Verification: ${Math.round(value)}%`}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r={radius}
          className="stroke-[var(--border-subtle)]"
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
          className="fill-[var(--text-secondary)] text-[10px] font-semibold"
        >
          {score == null ? '—' : `${Math.round(value)}%`}
        </text>
      </svg>
    </div>
  );
}
