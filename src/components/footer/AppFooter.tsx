/**
 * AppFooter
 *
 * Role-aware global footer. Uses the NextAuth session to determine which
 * column variant to render. Falls back to the public variant while loading
 * or when unauthenticated.
 *
 * Layout:
 *   Tier 1 — 4-column grid (brand + 3 role-scoped link columns)
 *   Tier 2 — Legal bar (privacy, terms, accessibility, security, copyright)
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OranRole } from '@/domain/types';
import {
  FOOTER_CONFIG,
  LEGAL_LINKS,
  getFooterVariant,
  type FooterColumn,
} from './footerConfig';
import { useCrisisModal } from '@/components/crisis/CrisisContext';
import { useLocale } from '@/contexts/LocaleContext';

// ============================================================
// CONSTANTS
// ============================================================

const YEAR = new Date().getFullYear();

// ============================================================
// COMPONENT
// ============================================================

interface AppFooterProps {
  /** Optional className applied to the outer <footer> element. */
  className?: string;
}

export function AppFooter({ className }: AppFooterProps) {
  const { data: session } = useSession();
  const { openCrisis } = useCrisisModal();
  const { t } = useLocale();

  const role = session?.user?.role as OranRole | undefined;
  const variant = getFooterVariant(role);
  const columns = FOOTER_CONFIG[variant];

  return (
    <>
      <footer
        className={cn('border-t border-[var(--border)] bg-[var(--bg-surface)]', className)}
        aria-label="Site footer"
      >
        {/* ── Tier 1: Column grid ──────────────────────────── */}
        <div className="container mx-auto max-w-6xl px-4 py-10 sm:py-12">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {/* Brand column */}
            <div className="sm:col-span-2 lg:col-span-1">
              <Link
                href="/"
                className="inline-block font-bold text-gray-900 tracking-tight text-base transition-colors hover:text-action-base"
              >
                ORAN
              </Link>

              <p className="mt-2 text-sm leading-relaxed text-gray-500 max-w-[200px]">
                {t('footer.tagline')}
              </p>

              {/* Crisis help button — opens shared CrisisModal via context */}
              <button
                type="button"
                onClick={openCrisis}
                className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                aria-haspopup="dialog"
                aria-label={t('footer.crisis_resources_aria')}
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t('footer.crisis_resources')}
              </button>
            </div>

            {/* Role-scoped columns */}
            {columns.map((col: FooterColumn) => (
              <div key={col.title}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {col.title}
                </h3>
                <ul className="space-y-2.5" role="list">
                  {col.links.map((link) => (
                    <li key={`${col.title}-${link.label}`}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-gray-600 transition-colors hover:text-gray-900"
                        >
                          {link.label}
                          <ExternalLink
                            className="h-3 w-3 text-gray-400"
                            aria-hidden="true"
                          />
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-sm text-gray-600 transition-colors hover:text-gray-900"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tier 2: Legal bar ───────────────────────────── */}
        <div className="border-t border-[var(--border)]">
          <div className="container mx-auto max-w-6xl px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="order-2 text-xs text-gray-400 sm:order-1">
              © {YEAR}{' '}
              <span className="font-medium text-gray-500">ORAN</span>
              {' '}— {t('footer.copyright_suffix')}
            </p>

            <nav
              className="order-1 flex flex-wrap gap-x-4 gap-y-2 sm:order-2"
              aria-label={t('footer.legal_aria')}
            >
              {LEGAL_LINKS.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="inline-flex items-center min-h-[44px] text-xs text-gray-400 transition-colors hover:text-gray-600"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </footer>
    </>
  );
}

