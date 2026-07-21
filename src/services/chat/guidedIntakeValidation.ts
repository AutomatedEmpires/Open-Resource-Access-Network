import type { GuidedIntakeSubmission } from '@/domain/resourceNavigator';

export type GuidedIntakeRequestValue = Omit<GuidedIntakeSubmission, 'prompt'>;

const APPROXIMATE_LOCATION_PATTERN = /^(?:\d{5}(?:-\d{4})?|[\p{L}][\p{L}\s.'-]{0,59}(?:,\s*[A-Za-z]{2})?)$/u;
const STREET_LEVEL_SUFFIX_PATTERN = /\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|highway|hwy|route|parkway|pkwy|circle|terrace|suite|unit|apartment|apt)\.?$/i;
const REQUEST_KEYS = new Set(['searchText', 'location', 'urgency', 'audience', 'accessMode']);
const URGENCY_VALUES = new Set(['today', 'within_days', 'planning']);
const AUDIENCE_VALUES = new Set(['self', 'child', 'family', 'someone_else']);
const ACCESS_MODE_VALUES = new Set(['can_travel', 'cannot_travel', 'phone', 'online']);

type ParseResult =
  | { success: true; data: GuidedIntakeRequestValue }
  | { success: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateLocation(location: string): string | null {
  if (location.length < 1 || location.length > 80 || !APPROXIMATE_LOCATION_PATTERN.test(location)) {
    return 'Use a city, City, ST, or 5-digit ZIP code.';
  }
  if (STREET_LEVEL_SUFFIX_PATTERN.test(location.replace(/,\s*[A-Za-z]{2}$/, '').trim())) {
    return 'Use a city, City, ST, or 5-digit ZIP code, not a street address.';
  }
  if (!location.includes(',') && /\s[A-Z]{2}$/i.test(location)) {
    return 'Put a comma before a 2-letter state code, for example Detroit, MI.';
  }
  return null;
}

/** Parses the shared guided-intake wire contract without pulling Zod into client bundles. */
export function parseGuidedIntakeRequest(value: unknown): ParseResult {
  if (!isRecord(value) || Object.keys(value).some((key) => !REQUEST_KEYS.has(key))) {
    return { success: false, message: 'Guided intake contains unsupported fields.' };
  }

  if (typeof value.searchText !== 'string') {
    return { success: false, message: 'Describe the need with at least one letter or number.' };
  }
  const searchText = value.searchText.trim();
  if (searchText.length < 1 || searchText.length > 500 || !/[\p{L}\p{N}]/u.test(searchText)) {
    return { success: false, message: 'Describe the need with at least one letter or number.' };
  }

  let location: string | undefined;
  if (value.location !== undefined) {
    if (typeof value.location !== 'string') {
      return { success: false, message: 'Use a city, City, ST, or 5-digit ZIP code.' };
    }
    location = value.location.trim();
    const locationError = validateLocation(location);
    if (locationError) return { success: false, message: locationError };
  }

  if (value.urgency !== undefined) {
    if (typeof value.urgency !== 'string' || !URGENCY_VALUES.has(value.urgency)) {
      return { success: false, message: 'Choose a supported urgency.' };
    }
  }
  if (value.audience !== undefined) {
    if (typeof value.audience !== 'string' || !AUDIENCE_VALUES.has(value.audience)) {
      return { success: false, message: 'Choose a supported audience.' };
    }
  }
  if (value.accessMode !== undefined) {
    if (typeof value.accessMode !== 'string' || !ACCESS_MODE_VALUES.has(value.accessMode)) {
      return { success: false, message: 'Choose a supported access option.' };
    }
  }

  return {
    success: true,
    data: {
      searchText,
      ...(location ? { location } : {}),
      ...(value.urgency ? { urgency: value.urgency as GuidedIntakeRequestValue['urgency'] } : {}),
      ...(value.audience ? { audience: value.audience as GuidedIntakeRequestValue['audience'] } : {}),
      ...(value.accessMode ? { accessMode: value.accessMode as GuidedIntakeRequestValue['accessMode'] } : {}),
    },
  };
}
