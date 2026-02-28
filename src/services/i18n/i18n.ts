/**
 * ORAN i18n Service
 * Simple in-code translation dictionary with t() helper.
 *
 * Note: file-based JSON locales are planned but not implemented yet.
 */

// ============================================================
// TYPES
// ============================================================

export type TranslationParams = Record<string, string | number>;
export type LocaleCode = 'en' | 'es' | 'zh' | 'ar' | 'vi' | 'fr';

export const SUPPORTED_LOCALES: readonly LocaleCode[] = ['en', 'es', 'zh', 'ar', 'vi', 'fr'];
export const DEFAULT_LOCALE: LocaleCode = 'en';
export const RTL_LOCALES: readonly LocaleCode[] = ['ar'];

export type TranslationDict = Record<string, string | Record<string, unknown>>;

// ============================================================
// BUILT-IN ENGLISH TRANSLATIONS
// ============================================================

const en: TranslationDict = {
  chat: {
    crisis: {
      title: 'It sounds like you may be in crisis. Please reach out for help immediately.',
      emergency: 'Emergency: Call 911',
      crisis_line: 'Crisis Line: Call or text 988',
      community_line: 'Community Resources: Call 211',
    },
    disclaimer: {
      eligibility:
        'Results shown are from verified records. Eligibility is determined by each service provider — ORAN does not guarantee qualification. Always confirm with the provider.',
    },
    input: {
      placeholder: 'Describe what you need help with...',
      send: 'Send',
    },
    quota: {
      exceeded: "You've reached the message limit for this session. Please start a new conversation.",
    },
  },
  service: {
    confidence: {
      high: 'High confidence',
      medium: 'Medium confidence — information may have changed',
      low: 'Low confidence — please verify before visiting',
      unverified: 'Unverified record',
    },
    eligibility_hint: 'You may qualify for this service. Confirm eligibility with the provider.',
  },
  common: {
    loading: 'Loading...',
    error: {
      generic: 'Something went wrong. Please try again.',
      not_found: 'Not found.',
    },
    button: {
      save: 'Save',
      cancel: 'Cancel',
      submit: 'Submit',
      close: 'Close',
    },
  },
  nav: {
    chat: 'Find Services',
    map: 'Map',
    directory: 'Directory',
    saved: 'Saved',
    profile: 'Profile',
  },
} as const;

// ============================================================
// TRANSLATION CACHE
// ============================================================

const localeCache = new Map<LocaleCode, TranslationDict>();
localeCache.set('en', en);

// ============================================================
// UTILITIES
// ============================================================

function getNestedValue(dict: TranslationDict, keyPath: string): string | undefined {
  const parts = keyPath.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = dict;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params: TranslationParams): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{${key}}`;
  });
}

// ============================================================
// MAIN t() FUNCTION
// ============================================================

/**
 * Translate a dot-notation key with optional parameter interpolation.
 * Falls back to English if key not found in requested locale.
 * In development, throws if key not found in English either.
 */
export function t(
  key: string,
  params?: TranslationParams,
  locale: LocaleCode = DEFAULT_LOCALE
): string {
  const localeDict = localeCache.get(locale);
  let value: string | undefined;

  if (localeDict) {
    value = getNestedValue(localeDict, key);
  }

  // Fallback to English
  if (value === undefined && locale !== DEFAULT_LOCALE) {
    const enDict = localeCache.get('en');
    if (enDict) {
      value = getNestedValue(enDict, key);
    }
  }

  if (value === undefined) {
    if (process.env.NODE_ENV === 'development') {
      throw new Error(`[i18n] Missing translation key: ${key}`);
    }
    return key; // Return key as fallback so UI doesn't break
  }

  return params ? interpolate(value, params) : value;
}

/**
 * Returns true if the locale is RTL.
 */
export function isRTL(locale: LocaleCode): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

/**
 * Creates a locale-bound translator.
 * Usage: const tl = createTranslator('es'); tl('nav.chat')
 */
export function createTranslator(locale: LocaleCode) {
  return (key: string, params?: TranslationParams) => t(key, params, locale);
}
