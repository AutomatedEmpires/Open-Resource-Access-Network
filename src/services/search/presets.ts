/**
 * Composite Search Presets
 *
 * Pre-built filter combinations mapping common seeker needs
 * to structured attribute filters + optional text queries.
 *
 * Each preset is a shortcut for "Low Cost Dental" → { text, attributeFilters }.
 * Presets never add facts — they map to existing tags in taxonomy.ts.
 *
 * @module services/search/presets
 */

import type { SearchFilters } from './types';

// ============================================================
// TYPES
// ============================================================

export interface SearchPreset {
  /** Machine-readable identifier */
  id: string;
  /** Human-readable label for UI display */
  label: string;
  /** Brief description of what this preset finds */
  description: string;
  /** Optional text query to inject */
  text?: string;
  /** Attribute filters to apply (merged with any user-selected filters) */
  attributeFilters: NonNullable<SearchFilters['attributeFilters']>;
}

// ============================================================
// PRESET DEFINITIONS
// ============================================================

export const SEARCH_PRESETS: readonly SearchPreset[] = [
  {
    id: 'low_cost_dental',
    label: 'Low Cost Dental',
    description: 'Free or sliding-scale dental services',
    text: 'dental',
    attributeFilters: {
      cost: ['free', 'sliding_scale', 'medicaid'],
    },
  },
  {
    id: 'free_food',
    label: 'Free Food',
    description: 'Free food assistance, pantries, and meals',
    text: 'food',
    attributeFilters: {
      cost: ['free', 'ebt_snap'],
    },
  },
  {
    id: 'free_medical',
    label: 'Free Medical Care',
    description: 'Free or low-cost medical and health services',
    text: 'medical health clinic',
    attributeFilters: {
      cost: ['free', 'sliding_scale', 'no_insurance_required'],
    },
  },
  {
    id: 'walk_in_mental_health',
    label: 'Walk-In Mental Health',
    description: 'Mental health services accepting walk-ins',
    text: 'mental health counseling',
    attributeFilters: {
      access: ['walk_in', 'same_day'],
    },
  },
  {
    id: 'virtual_counseling',
    label: 'Virtual Counseling',
    description: 'Telehealth and virtual therapy or counseling',
    text: 'counseling therapy',
    attributeFilters: {
      delivery: ['virtual', 'phone'],
    },
  },
  {
    id: 'housing_assistance',
    label: 'Housing Help',
    description: 'Emergency shelter and housing assistance',
    text: 'housing shelter',
    attributeFilters: {
      cost: ['free', 'government_funded'],
    },
  },
  {
    id: 'legal_aid_free',
    label: 'Free Legal Aid',
    description: 'Free legal assistance and representation',
    text: 'legal aid lawyer',
    attributeFilters: {
      cost: ['free', 'grant_funded'],
    },
  },
  {
    id: 'veteran_services',
    label: 'Veteran Services',
    description: 'Services specifically for veterans',
    attributeFilters: {
      cost: ['free_for_veterans', 'va_benefits', 'tricare'],
    },
  },
] as const;

// ============================================================
// LOOKUP
// ============================================================

const PRESET_MAP = new Map(SEARCH_PRESETS.map((p) => [p.id, p]));

/**
 * Look up a search preset by ID.
 * Returns undefined if the preset is not found.
 */
export function getSearchPreset(id: string): SearchPreset | undefined {
  return PRESET_MAP.get(id);
}

/**
 * Merge a preset's attribute filters with user-selected filters.
 * User filters take precedence — if a user explicitly set a dimension,
 * the preset does NOT override it.
 */
export function mergePresetFilters(
  preset: SearchPreset,
  userFilters?: Record<string, string[]>,
): Record<string, string[]> {
  const merged = { ...preset.attributeFilters };
  if (userFilters) {
    for (const [key, tags] of Object.entries(userFilters)) {
      if (tags.length > 0) {
        merged[key] = tags;
      }
    }
  }
  return merged;
}
