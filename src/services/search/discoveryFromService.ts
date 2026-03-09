import type { EnrichedService, ServiceAttribute } from '@/domain/types';

import type { DiscoveryLinkState } from './discovery';

export function toDiscoveryAttributeFilters(
  attributes: ServiceAttribute[] | null | undefined,
): Record<string, string[]> | undefined {
  if (!attributes || attributes.length === 0) return undefined;

  const filters: Record<string, string[]> = {};
  for (const attribute of attributes) {
    if (attribute.taxonomy !== 'delivery' && attribute.taxonomy !== 'cost' && attribute.taxonomy !== 'access') {
      continue;
    }

    if (!filters[attribute.taxonomy]) {
      filters[attribute.taxonomy] = [];
    }

    if (!filters[attribute.taxonomy].includes(attribute.tag)) {
      filters[attribute.taxonomy].push(attribute.tag);
    }
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

export function buildServiceFallbackDiscoveryState(
  service: EnrichedService | null | undefined,
): DiscoveryLinkState {
  if (!service) {
    return {
      taxonomyTermIds: [],
      attributeFilters: undefined,
    };
  }

  return {
    taxonomyTermIds: service.taxonomyTerms.map((term) => term.id).slice(0, 20),
    attributeFilters: toDiscoveryAttributeFilters(service.attributes),
  };
}
