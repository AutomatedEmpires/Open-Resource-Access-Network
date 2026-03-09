import { describe, expect, it } from 'vitest';

import {
  buildDiscoveryHref,
  buildDiscoveryUrlParams,
  buildSearchApiParamsFromDiscovery,
  buildSearchQueryFromDiscovery,
  getMinConfidenceScoreForDiscoveryFilter,
  hasMeaningfulDiscoveryState,
  parseDiscoveryUrlState,
  resolveDiscoverySearchText,
} from '../discovery';

describe('search discovery helpers', () => {
  it('resolves discovery text from explicit text first and falls back to need text', () => {
    expect(resolveDiscoverySearchText(' rent help ', 'housing')).toBe('rent help');
    expect(resolveDiscoverySearchText('', 'food_assistance')).toBe('food');
    expect(resolveDiscoverySearchText(undefined, null)).toBe('');
  });

  it('maps discovery confidence filters to deterministic thresholds', () => {
    expect(getMinConfidenceScoreForDiscoveryFilter('HIGH')).toBe(80);
    expect(getMinConfidenceScoreForDiscoveryFilter('LIKELY')).toBe(60);
    expect(getMinConfidenceScoreForDiscoveryFilter('all')).toBeUndefined();
  });

  it('builds a structured search query from discovery inputs', () => {
    const query = buildSearchQueryFromDiscovery({
      needId: 'food_assistance',
      taxonomyTermIds: ['11111111-1111-1111-1111-111111111111'],
      attributeFilters: { delivery: ['virtual'] },
      confidenceFilter: 'HIGH',
      sortBy: 'trust',
      page: 2,
      limit: 24,
      geo: {
        type: 'bbox',
        minLat: 10,
        minLng: 20,
        maxLat: 30,
        maxLng: 40,
      },
    });

    expect(query).toEqual({
      text: 'food',
      geo: {
        type: 'bbox',
        minLat: 10,
        minLng: 20,
        maxLat: 30,
        maxLng: 40,
      },
      filters: {
        status: 'active',
        taxonomyTermIds: ['11111111-1111-1111-1111-111111111111'],
        attributeFilters: { delivery: ['virtual'] },
        minConfidenceScore: 80,
        organizationId: undefined,
      },
      pagination: {
        page: 2,
        limit: 24,
      },
      sortBy: 'trust',
    });
  });

  it('lets callers override confidence score directly when needed', () => {
    const query = buildSearchQueryFromDiscovery({
      text: 'legal aid',
      confidenceFilter: 'LIKELY',
      minConfidenceScore: 92,
      limit: 5,
    });

    expect(query.filters.minConfidenceScore).toBe(92);
  });

  it('serializes discovery inputs into search API params', () => {
    const params = buildSearchApiParamsFromDiscovery({
      text: '',
      needId: 'housing',
      taxonomyTermIds: ['11111111-1111-1111-1111-111111111111'],
      attributeFilters: { access: ['walk_in'] },
      confidenceFilter: 'LIKELY',
      sortBy: 'name_asc',
      geo: {
        type: 'radius',
        lat: 47.62,
        lng: -122.33,
        radiusMeters: 16093,
      },
    });

    expect(params.get('q')).toBe('housing');
    expect(params.get('taxonomyIds')).toBe('11111111-1111-1111-1111-111111111111');
    expect(params.get('attributes')).toBe(JSON.stringify({ access: ['walk_in'] }));
    expect(params.get('minConfidenceScore')).toBe('60');
    expect(params.get('sortBy')).toBe('name_asc');
    expect(params.get('lat')).toBe('47.62');
    expect(params.get('lng')).toBe('-122.33');
    expect(params.get('radius')).toBe('16093');
  });

  it('serializes shareable discovery URL params with canonical category ids', () => {
    const params = buildDiscoveryUrlParams({
      text: '',
      needId: 'food_assistance',
      confidenceFilter: 'HIGH',
      sortBy: 'name_desc',
      taxonomyTermIds: ['11111111-1111-1111-1111-111111111111'],
      attributeFilters: { cost: ['free'] },
      page: 3,
    });

    expect(params.toString()).toBe(
      'q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=11111111-1111-1111-1111-111111111111&attributes=%7B%22cost%22%3A%5B%22free%22%5D%7D&page=3',
    );
  });

  it('builds canonical hrefs and can require an actual discovery intent', () => {
    expect(buildDiscoveryHref('/chat', { needId: 'housing' })).toBe('/chat?q=housing&category=housing');
    expect(buildDiscoveryHref('/report?serviceId=svc-1', { needId: 'housing' })).toBe('/report?serviceId=svc-1&q=housing&category=housing');
    expect(buildDiscoveryHref('/map', { text: '', needId: null }, { requireIntent: true })).toBe('/map');
  });

  it('parses canonical discovery URL state without dropping supported filters', () => {
    const params = new URLSearchParams(
      'q=food&confidence=HIGH&sort=name_desc&category=food&taxonomyIds=11111111-1111-4111-8111-111111111111&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=3',
    );

    expect(parseDiscoveryUrlState(params)).toEqual({
      text: 'food',
      needId: 'food_assistance',
      confidenceFilter: 'HIGH',
      sortBy: 'name_desc',
      taxonomyTermIds: ['11111111-1111-4111-8111-111111111111'],
      attributeFilters: { delivery: ['virtual'] },
      page: 3,
    });
  });

  it('detects whether a discovery state is meaningfully populated', () => {
    expect(hasMeaningfulDiscoveryState({})).toBe(false);
    expect(hasMeaningfulDiscoveryState({ confidenceFilter: 'HIGH' })).toBe(true);
    expect(hasMeaningfulDiscoveryState({ taxonomyTermIds: ['11111111-1111-4111-8111-111111111111'] })).toBe(true);
    expect(hasMeaningfulDiscoveryState({ attributeFilters: { delivery: ['phone'] } })).toBe(true);
  });
});
