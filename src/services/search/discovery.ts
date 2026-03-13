import type { DiscoveryNeedId } from '@/domain/discoveryNeeds';
import { getDiscoveryNeedSearchText, resolveDiscoveryNeedId } from '@/domain/discoveryNeeds';
import { SERVICE_ATTRIBUTES_TAXONOMY, isValidTag } from '@/domain/taxonomy';

import type {
  BboxQuery,
  RadiusQuery,
  SearchFilters,
  SearchQuery,
  SortBy,
} from './types';

export type DiscoveryConfidenceFilter = 'all' | 'HIGH' | 'LIKELY';
export type DiscoverySortOption = SortBy;

export const DISCOVERY_CONFIDENCE_OPTIONS: ReadonlyArray<{
  value: DiscoveryConfidenceFilter;
  label: string;
  minScore?: number;
}> = [
  { value: 'all', label: 'All results' },
  { value: 'LIKELY', label: 'Likely or higher', minScore: 60 },
  { value: 'HIGH', label: 'High confidence only', minScore: 80 },
] as const;

export const DISCOVERY_SORT_OPTIONS: ReadonlyArray<{
  value: DiscoverySortOption;
  label: string;
}> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'trust', label: 'Trust (highest)' },
  { value: 'name_asc', label: 'Name (A-Z)' },
  { value: 'name_desc', label: 'Name (Z-A)' },
] as const;

export interface DiscoverySearchInput {
  text?: string | null;
  needId?: DiscoveryNeedId | null;
  taxonomyTermIds?: string[];
  attributeFilters?: SearchFilters['attributeFilters'];
  confidenceFilter?: DiscoveryConfidenceFilter;
  minConfidenceScore?: number;
  sortBy?: SortBy;
  organizationId?: string;
  page?: number;
  limit?: number;
  geo?: RadiusQuery | BboxQuery;
}

export interface DiscoveryLinkState {
  text?: string | null;
  needId?: DiscoveryNeedId | null;
  confidenceFilter?: DiscoveryConfidenceFilter;
  sortBy?: SortBy;
  taxonomyTermIds?: string[];
  attributeFilters?: SearchFilters['attributeFilters'];
  page?: number;
}

export interface DiscoveryUrlState {
  text: string | null;
  needId: DiscoveryNeedId | null;
  confidenceFilter?: DiscoveryConfidenceFilter;
  sortBy?: SortBy;
  taxonomyTermIds: string[];
  attributeFilters?: SearchFilters['attributeFilters'];
  page: number;
}

interface DiscoveryUrlParamsLike {
  get(name: string): string | null;
}

export function sanitizeDiscoveryTaxonomyTermIds(
  raw: readonly string[] | string | null | undefined,
): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[,\s]+/)
      : [];

  return values
    .map((value) => value.trim())
    .filter((value) => value && isUuid(value));
}

export function hasMeaningfulDiscoveryState(
  state: Pick<
    DiscoveryLinkState,
    'text' | 'needId' | 'confidenceFilter' | 'sortBy' | 'taxonomyTermIds' | 'attributeFilters'
  > | null | undefined,
): boolean {
  if (!state) return false;
  if (state.needId) return true;
  if (state.text?.trim()) return true;
  if (state.confidenceFilter && state.confidenceFilter !== 'all') return true;
  if (state.sortBy && state.sortBy !== 'relevance') return true;
  if ((state.taxonomyTermIds?.length ?? 0) > 0) return true;
  if (Object.keys(sanitizeDiscoveryAttributeFilters(state.attributeFilters) ?? {}).length > 0) return true;
  return false;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseDiscoveryAttributeFilters(
  raw: string | null | undefined,
): SearchFilters['attributeFilters'] | undefined {
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    return sanitizeDiscoveryAttributeFilters(parsed as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

export function sanitizeDiscoveryAttributeFilters(
  raw: Record<string, unknown> | SearchFilters['attributeFilters'] | null | undefined,
): SearchFilters['attributeFilters'] | undefined {
  if (!raw) return undefined;

  const filters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in SERVICE_ATTRIBUTES_TAXONOMY) || !Array.isArray(value)) {
      continue;
    }

    const validValues = Array.from(
      new Set(
        value.filter(
          (entry): entry is string => typeof entry === 'string' && isValidTag(key, entry),
        ),
      ),
    );

    if (validValues.length > 0) {
      filters[key] = validValues;
    }
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

export function parseDiscoveryUrlState(searchParams: DiscoveryUrlParamsLike): DiscoveryUrlState {
  const confidence = searchParams.get('confidence');
  const sort = searchParams.get('sort');
  const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);

  return {
    text: searchParams.get('q'),
    needId: resolveDiscoveryNeedId(searchParams.get('category')),
    confidenceFilter:
      confidence === 'HIGH' || confidence === 'LIKELY'
        ? confidence
        : undefined,
    sortBy:
    sort === 'relevance' || sort === 'trust' || sort === 'name_asc' || sort === 'name_desc'
        ? sort
        : undefined,
    taxonomyTermIds: sanitizeDiscoveryTaxonomyTermIds(searchParams.get('taxonomyIds')),
    attributeFilters: parseDiscoveryAttributeFilters(searchParams.get('attributes')),
    page: Number.isFinite(rawPage) && rawPage > 1 ? rawPage : 1,
  };
}

export function resolveDiscoverySearchText(
  text: string | null | undefined,
  needId: DiscoveryNeedId | null | undefined,
): string {
  const trimmed = text?.trim() ?? '';
  return trimmed || getDiscoveryNeedSearchText(needId) || '';
}

export function getMinConfidenceScoreForDiscoveryFilter(
  filter: DiscoveryConfidenceFilter | null | undefined,
): number | undefined {
  return DISCOVERY_CONFIDENCE_OPTIONS.find((option) => option.value === (filter ?? 'all'))?.minScore;
}

export function buildSearchQueryFromDiscovery(input: DiscoverySearchInput): SearchQuery {
  const text = resolveDiscoverySearchText(input.text, input.needId);
  const minConfidenceScore = input.minConfidenceScore ?? getMinConfidenceScoreForDiscoveryFilter(input.confidenceFilter);
  const attributeFilters = sanitizeDiscoveryAttributeFilters(input.attributeFilters);

  return {
    text: text || undefined,
    geo: input.geo,
    filters: {
      status: 'active',
      publishedOnly: true,
      taxonomyTermIds: input.taxonomyTermIds && input.taxonomyTermIds.length > 0 ? input.taxonomyTermIds : undefined,
      attributeFilters,
      minConfidenceScore,
      organizationId: input.organizationId,
    },
    pagination: {
      page: input.page ?? 1,
      limit: input.limit ?? 12,
    },
    sortBy: input.sortBy ?? 'relevance',
  };
}

export function buildSearchApiParamsFromDiscovery(input: DiscoverySearchInput): URLSearchParams {
  const query = buildSearchQueryFromDiscovery(input);
  const params = new URLSearchParams({
    page: String(query.pagination.page),
    limit: String(query.pagination.limit),
  });

  if (query.text) {
    params.set('q', query.text);
  }

  if (query.filters.taxonomyTermIds?.length) {
    params.set('taxonomyIds', query.filters.taxonomyTermIds.join(','));
  }

  if (query.filters.attributeFilters && Object.keys(query.filters.attributeFilters).length > 0) {
    params.set('attributes', JSON.stringify(query.filters.attributeFilters));
  }

  if (query.filters.minConfidenceScore !== undefined) {
    params.set('minConfidenceScore', String(query.filters.minConfidenceScore));
  }

  if (query.sortBy && query.sortBy !== 'relevance') {
    params.set('sortBy', query.sortBy);
  }

  if (query.geo?.type === 'radius') {
    params.set('lat', String(query.geo.lat));
    params.set('lng', String(query.geo.lng));
    params.set('radius', String(query.geo.radiusMeters));
  } else if (query.geo?.type === 'bbox') {
    params.set('minLat', String(query.geo.minLat));
    params.set('minLng', String(query.geo.minLng));
    params.set('maxLat', String(query.geo.maxLat));
    params.set('maxLng', String(query.geo.maxLng));
  }

  return params;
}

export function buildDiscoveryUrlParams(input: DiscoveryLinkState): URLSearchParams {
  const params = new URLSearchParams();
  const text = resolveDiscoverySearchText(input.text, input.needId);
  const attributeFilters = sanitizeDiscoveryAttributeFilters(input.attributeFilters);

  if (text) {
    params.set('q', text);
  }
  if (input.confidenceFilter && input.confidenceFilter !== 'all') {
    params.set('confidence', input.confidenceFilter);
  }
  if (input.sortBy && input.sortBy !== 'relevance') {
    params.set('sort', input.sortBy);
  }
  if (input.needId) {
    params.set('category', input.needId);
  }
  if (input.taxonomyTermIds?.length) {
    params.set('taxonomyIds', input.taxonomyTermIds.join(','));
  }
  if (attributeFilters && Object.keys(attributeFilters).length > 0) {
    params.set('attributes', JSON.stringify(attributeFilters));
  }
  if ((input.page ?? 1) > 1) {
    params.set('page', String(input.page));
  }

  return params;
}

export function buildDiscoveryHref(
  basePath: string,
  input: DiscoveryLinkState,
  options?: {
    requireIntent?: boolean;
  },
): string {
  if (options?.requireIntent && !resolveDiscoverySearchText(input.text, input.needId)) {
    return basePath;
  }

  const params = buildDiscoveryUrlParams(input);
  const qs = params.toString();
  if (!qs) return basePath;
  return `${basePath}${basePath.includes('?') ? '&' : '?'}${qs}`;
}
