import {
  getDiscoveryNeedLabel,
  getDiscoveryNeedSearchText,
  isDiscoveryNeedSearchText,
} from '@/domain/discoveryNeeds';
import type { EnrichedService, ServiceAttributeTaxonomy } from '@/domain/types';

import {
  DISCOVERY_CONFIDENCE_OPTIONS,
  DISCOVERY_SORT_OPTIONS,
  hasMeaningfulDiscoveryState,
  type DiscoveryLinkState,
} from './discovery';
import type { SearchFilters } from './types';

export interface DiscoveryContextChip {
  key: string;
  label: string;
}

const ATTRIBUTE_DIMENSION_LABELS: Partial<Record<ServiceAttributeTaxonomy, string>> = {
  delivery: 'Delivery',
  cost: 'Cost',
  access: 'Access',
  culture: 'Culture',
  population: 'Population',
  situation: 'Situation',
};

export const DISCOVERY_ATTRIBUTE_LABELS: Record<string, string> = {
  in_person: 'In-Person',
  virtual: 'Virtual',
  phone: 'By Phone',
  home_delivery: 'Home Delivery',
  free: 'Free',
  sliding_scale: 'Sliding Scale',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
  no_insurance_required: 'No Insurance Needed',
  ebt_snap: 'EBT/SNAP',
  walk_in: 'Walk-In',
  no_id_required: 'No ID Required',
  no_referral_needed: 'No Referral',
  no_documentation_required: 'No Documentation Required',
  no_ssn_required: 'No SSN Required',
  drop_in: 'Drop-In',
  accepting_new_clients: 'Accepting New Clients',
  weekend_hours: 'Weekend Hours',
  evening_hours: 'Evening Hours',
  same_day: 'Same-Day Help',
  next_day: 'Next-Day Help',
  child_friendly: 'Child Friendly',
  language_interpretation: 'Interpreter Support',
};

function titleCaseSlug(value: string): string {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function formatDiscoveryAttributeLabel(
  tag: string,
  options: { taxonomy?: string; prefixed?: boolean } = {},
): string {
  const shortLabel = DISCOVERY_ATTRIBUTE_LABELS[tag]
    ?? titleCaseSlug(tag)
    ?? tag;

  if (!options.prefixed) {
    return shortLabel;
  }

  const taxonomyLabel = options.taxonomy
    ? ATTRIBUTE_DIMENSION_LABELS[options.taxonomy as ServiceAttributeTaxonomy] ?? titleCaseSlug(options.taxonomy)
    : 'Filter';

  return `${taxonomyLabel}: ${shortLabel}`;
}

function pushLimitedLabels(
  chips: DiscoveryContextChip[],
  labels: string[],
  prefix: string,
  maxVisible = 3,
) {
  labels.slice(0, maxVisible).forEach((label, index) => {
    chips.push({
      key: `${prefix}-${index}`,
      label,
    });
  });

  if (labels.length > maxVisible) {
    chips.push({
      key: `${prefix}-overflow`,
      label: `+${labels.length - maxVisible} more`,
    });
  }
}

export function formatDiscoveryAttributeFilters(
  filters: SearchFilters['attributeFilters'] | undefined,
  options: { prefixed?: boolean } = {},
): string[] {
  if (!filters) return [];

  const labels: string[] = [];
  for (const [taxonomy, values] of Object.entries(filters)) {
    values.forEach((value) => {
      labels.push(formatDiscoveryAttributeLabel(value, { taxonomy, prefixed: options.prefixed }));
    });
  }

  return labels;
}

export function hasMeaningfulDiscoveryContext(state: DiscoveryLinkState | null | undefined): boolean {
  return hasMeaningfulDiscoveryState(state);
}

export function summarizeDiscoveryContext(
  state: DiscoveryLinkState | null | undefined,
  options: {
    taxonomyLabelById?: Record<string, string>;
    includeSort?: boolean;
  } = {},
): DiscoveryContextChip[] {
  if (!state) return [];

  const chips: DiscoveryContextChip[] = [];
  const trimmedText = state.text?.trim() ?? '';
  const needLabel = getDiscoveryNeedLabel(state.needId);

  if (needLabel) {
    chips.push({
      key: 'need',
      label: `Need: ${needLabel}`,
    });
  }

  if (trimmedText && !isDiscoveryNeedSearchText(state.needId, trimmedText)) {
    chips.push({
      key: 'query',
      label: `Search: ${trimmedText}`,
    });
  } else if (!needLabel && trimmedText) {
    chips.push({
      key: 'query',
      label: `Search: ${trimmedText}`,
    });
  } else if (!trimmedText && state.needId) {
    const needSearchText = getDiscoveryNeedSearchText(state.needId);
    if (needSearchText) {
      chips.push({
        key: 'query',
        label: `Search: ${needSearchText}`,
      });
    }
  }

  if (state.confidenceFilter && state.confidenceFilter !== 'all') {
    const trustLabel = DISCOVERY_CONFIDENCE_OPTIONS.find((option) => option.value === state.confidenceFilter)?.label;
    if (trustLabel) {
      chips.push({
        key: 'trust',
        label: `Trust: ${trustLabel}`,
      });
    }
  }

  if (options.includeSort && state.sortBy && state.sortBy !== 'relevance') {
    const sortLabel = DISCOVERY_SORT_OPTIONS.find((option) => option.value === state.sortBy)?.label;
    if (sortLabel) {
      chips.push({
        key: 'sort',
        label: `Sort: ${sortLabel}`,
      });
    }
  }

  const taxonomyLabels = (state.taxonomyTermIds ?? [])
    .map((id) => options.taxonomyLabelById?.[id])
    .filter((value): value is string => Boolean(value))
    .map((label) => `Tag: ${label}`);
  pushLimitedLabels(chips, taxonomyLabels, 'taxonomy', 2);

  const attributeLabels = formatDiscoveryAttributeFilters(state.attributeFilters, { prefixed: true });
  pushLimitedLabels(chips, attributeLabels, 'attribute', 4);

  return chips;
}

export function summarizeServiceAlignment(
  service: EnrichedService,
  state: DiscoveryLinkState | null | undefined,
  options: {
    taxonomyLabelById?: Record<string, string>;
  } = {},
): string[] {
  if (!state) return [];

  const matchedAttributeLabels = new Set<string>();
  const selectedAttributes = state.attributeFilters ?? {};
  const serviceAttributes = service.attributes ?? [];

  for (const [taxonomy, tags] of Object.entries(selectedAttributes)) {
    tags.forEach((tag) => {
      const matched = serviceAttributes.some((attribute) => attribute.taxonomy === taxonomy && attribute.tag === tag);
      if (matched) {
        matchedAttributeLabels.add(formatDiscoveryAttributeLabel(tag, { taxonomy }));
      }
    });
  }

  const matchedTaxonomyLabels = new Set<string>();
  const selectedTaxonomyIds = new Set(state.taxonomyTermIds ?? []);
  (service.taxonomyTerms ?? []).forEach((term) => {
    if (selectedTaxonomyIds.has(term.id)) {
      matchedTaxonomyLabels.add(options.taxonomyLabelById?.[term.id] ?? term.term);
    }
  });

  return [...matchedAttributeLabels, ...matchedTaxonomyLabels];
}
