'use client';

/**
 * LanguageSwitcher
 *
 * Accessible language picker for the AppNav.
 * Reads current locale from LocaleContext and calls setLocale() on selection.
 * Displays a Globe icon trigger with the current locale's native name.
 *
 * Keyboard: Escape closes the panel, ArrowUp/Down navigate options, Enter selects.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { useLocale } from '@/contexts/LocaleContext';
import type { LocaleCode } from '@/services/i18n/i18n';

// ── Language registry ──────────────────────────────────────────────────────

const LANGUAGES: Array<{
  code: LocaleCode;
  nativeName: string;
  englishName: string;
  flag: string;
}> = [
  { code: 'en', nativeName: 'English',      englishName: 'English',    flag: '🇺🇸' },
  { code: 'es', nativeName: 'Español',      englishName: 'Spanish',    flag: '🇪🇸' },
  { code: 'zh', nativeName: '中文',           englishName: 'Chinese',    flag: '🇨🇳' },
  { code: 'ar', nativeName: 'العربية',      englishName: 'Arabic',     flag: '🇸🇦' },
  { code: 'vi', nativeName: 'Tiếng Việt',   englishName: 'Vietnamese', flag: '🇻🇳' },
  { code: 'fr', nativeName: 'Français',     englishName: 'French',     flag: '🇫🇷' },
];

// ── Component ──────────────────────────────────────────────────────────────

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocusIndex(-1);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // Focus active item when panel opens / focus changes
  useEffect(() => {
    if (!open || focusIndex < 0) return;
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    items?.[focusIndex]?.focus();
  }, [open, focusIndex]);

  const handleToggle = () => {
    setOpen((v) => !v);
    setFocusIndex(open ? -1 : LANGUAGES.findIndex((l) => l.code === locale));
  };

  const handleSelect = useCallback(
    async (code: LocaleCode) => {
      setOpen(false);
      setFocusIndex(-1);
      if (code !== locale) await setLocale(code);
    },
    [locale, setLocale]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setFocusIndex(LANGUAGES.findIndex((l) => l.code === locale));
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setFocusIndex(-1);
      containerRef.current?.querySelector<HTMLElement>('button')?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, LANGUAGES.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      setOpen(false);
      setFocusIndex(-1);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={handleKeyDown}
    >
      {/* Trigger */}
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('common.select_language')}
        title={t('common.select_language')}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]"
      >
        <Globe className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <span className="hidden sm:inline">{current.nativeName}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={t('common.select_language')}
          aria-activedescendant={focusIndex >= 0 ? `lang-option-${LANGUAGES[focusIndex]?.code}` : undefined}
          className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {LANGUAGES.map((lang, idx) => {
            const isSelected = lang.code === locale;
            return (
              <li key={lang.code} role="presentation">
                <button
                  id={`lang-option-${lang.code}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => handleSelect(lang.code)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors focus:outline-none focus-visible:bg-[var(--bg-surface-alt)] ${
                    isSelected
                      ? 'bg-[var(--bg-surface-alt)] font-semibold text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                  } ${idx === focusIndex ? 'bg-[var(--bg-surface-alt)]' : ''}`}
                >
                  <span className="text-base leading-none" aria-hidden="true">
                    {lang.flag}
                  </span>
                  <span className="flex-1 text-left">{lang.nativeName}</span>
                  {isSelected && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-primary)]" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
