'use client';

/**
 * ORAN Client-side Locale Context
 *
 * Bridges server-resolved locale + pre-merged messages bundle into the React
 * client tree. Root layout (server component) resolves the locale, loads the
 * correct bundle via getMessages(), and passes both as serialisable props to
 * <Providers> which renders <LocaleProvider>.
 *
 * Public API:
 *   useLocale()          — returns { locale, dir, t, setLocale }
 *   t(key, params?)      — translate a dot-notation key
 *   setLocale(code)      — set NEXT_LOCALE cookie + refresh RSC tree
 */

import React, { createContext, useCallback, useContext } from 'react';
import { useRouter } from 'next/navigation';
import type { LocaleCode, TranslationParams } from '@/services/i18n/i18n';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LocaleContextValue {
  /** Active locale code, e.g. 'en' | 'es' | 'zh' | 'ar' | 'vi' | 'fr' */
  locale: LocaleCode;
  /** Document direction derived from locale */
  dir: 'ltr' | 'rtl';
  /** Translate a dot-notation key from the loaded locale bundle. */
  t: (key: string, params?: TranslationParams) => string;
  /**
   * Switch the application locale.
   * Sets NEXT_LOCALE cookie via /api/locale, then calls router.refresh()
   * so the server component tree re-hydrates with the new locale.
   */
  setLocale: (locale: LocaleCode) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

// ── Helpers ────────────────────────────────────────────────────────────────

function getNestedValue(
  dict: Record<string, unknown>,
  keyPath: string
): string | undefined {
  const parts = keyPath.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

// ── Provider ───────────────────────────────────────────────────────────────

interface LocaleProviderProps {
  locale: LocaleCode;
  dir: 'ltr' | 'rtl';
  /**
   * Pre-merged messages bundle produced by getMessages(locale) on the server.
   * English fills any untranslated gaps so clients always have a complete set.
   */
  messages: Record<string, unknown>;
  children: React.ReactNode;
}

export function LocaleProvider({
  locale,
  dir,
  messages,
  children,
}: LocaleProviderProps) {
  const router = useRouter();

  const t = useCallback(
    (key: string, params?: TranslationParams): string => {
      const value = getNestedValue(messages, key);
      if (value === undefined) return key;
      if (!params) return value;
      return value.replace(/\{(\w+)\}/g, (_, k) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`
      );
    },
    [messages]
  );

  const setLocale = useCallback(
    async (newLocale: LocaleCode): Promise<void> => {
      try {
        await fetch('/api/locale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: newLocale }),
        });
      } catch {
        // Network failure — locale stays as-is; server will re-resolve on next navigation
      }
      // Re-run server components with the new locale cookie
      router.refresh();
    },
    [router]
  );

  return (
    <LocaleContext.Provider value={{ locale, dir, t, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale() must be called inside <LocaleProvider>');
  return ctx;
}
