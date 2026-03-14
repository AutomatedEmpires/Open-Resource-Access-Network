/**
 * ORAN i18n Service
 *
 * Loads translations from file-based JSON locale bundles under src/locales/.
 * All bundles are statically imported at module load time so they are bundled
 * with the app and require no runtime file I/O.
 *
 * Public API (backward-compatible):
 *   t(key, params?, locale?)  — translate a dot-notation key
 *   isRTL(locale)             — true for rtl locales (ar)
 *   createTranslator(locale)  — locale-bound t() shorthand
 */

import enStrings from '@/locales/en.json';
import esStrings from '@/locales/es.json';
import zhStrings from '@/locales/zh.json';
import arStrings from '@/locales/ar.json';
import viStrings from '@/locales/vi.json';
import frStrings from '@/locales/fr.json';

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
// BUILT-IN TRANSLATIONS (loaded from locale JSON files)
// ============================================================

// ============================================================
// TRANSLATION CACHE — pre-populated from static JSON imports
// ============================================================

const localeCache = new Map<LocaleCode, TranslationDict>([
  ['en', enStrings as TranslationDict],
  ['es', esStrings as TranslationDict],
  ['zh', zhStrings as TranslationDict],
  ['ar', arStrings as TranslationDict],
  ['vi', viStrings as TranslationDict],
  ['fr', frStrings as TranslationDict],
]);

// ============================================================
// UTILITIES
// ============================================================

function getNestedValue(dict: TranslationDict, keyPath: string): string | undefined {
  const parts = keyPath.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
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

// ============================================================
// CLIENT MESSAGES BUNDLE
// ============================================================

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const bVal = base[key];
    const oVal = override[key];
    if (
      oVal !== null &&
      typeof oVal === 'object' &&
      !Array.isArray(oVal) &&
      bVal !== null &&
      typeof bVal === 'object' &&
      !Array.isArray(bVal)
    ) {
      result[key] = deepMerge(
        bVal as Record<string, unknown>,
        oVal as Record<string, unknown>
      );
    } else if (oVal !== undefined) {
      result[key] = oVal;
    }
  }
  return result;
}

/**
 * Returns a fully merged translation bundle for the given locale.
 * English strings fill any gaps in the target locale so clients always
 * have a complete bundle without a second network round-trip.
 */
export function getMessages(locale: LocaleCode): Record<string, unknown> {
  const en = localeCache.get('en') as Record<string, unknown>;
  if (locale === 'en') return en;
  const target = (localeCache.get(locale) ?? {}) as Record<string, unknown>;
  return deepMerge(en, target);
}
