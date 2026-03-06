/**
 * ORAN server-side locale resolver.
 *
 * Resolution order:
 *   1. `NEXT_LOCALE` cookie (set by profile preference save)
 *   2. `Accept-Language` request header (best-match against SUPPORTED_LOCALES)
 *   3. DEFAULT_LOCALE ('en')
 *
 * Only call this from Server Components / Route Handlers — it reads Next.js
 * request headers via `next/headers`.
 */

import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocaleCode } from '@/services/i18n/i18n';

/** Name of the cookie that stores the user's preferred locale. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * Parse an `Accept-Language` header value and return the first supported locale.
 * e.g. "es-419,es;q=0.9,en;q=0.8" → 'es'
 */
function matchAcceptLanguage(header: string): LocaleCode | null {
  for (const part of header.split(',')) {
    const lang = part.trim().split(';')[0].trim().toLowerCase();
    // Match both full tag ("zh-hans") and primary subtag ("zh")
    const primary = lang.split('-')[0] as LocaleCode;
    if ((SUPPORTED_LOCALES as readonly string[]).includes(primary)) {
      return primary;
    }
  }
  return null;
}

/**
 * Resolve the active locale for the current request.
 * Safe to call in any async Server Component or Route Handler.
 */
export async function resolveLocale(): Promise<LocaleCode> {
  // 1. Cookie preference (set when user selects a language in their profile)
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value as LocaleCode | undefined;
  if (cookieLocale && (SUPPORTED_LOCALES as readonly string[]).includes(cookieLocale)) {
    return cookieLocale;
  }

  // 2. Accept-Language header
  const headerStore = await headers();
  const acceptLang = headerStore.get('accept-language');
  if (acceptLang) {
    const matched = matchAcceptLanguage(acceptLang);
    if (matched) return matched;
  }

  // 3. Fallback
  return DEFAULT_LOCALE;
}
