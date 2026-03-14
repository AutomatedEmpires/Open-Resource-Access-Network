/**
 * ORAN Global Navigation
 *
 * Persistent top navigation bar shown on all pages.
 * Route-aware active state, role-adaptive links, accessible.
 */

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageCircle, List, MapPin, Bookmark, User,
  Menu, X, Flag,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useLocale } from '@/contexts/LocaleContext';

// ============================================================
// NAV ITEMS
// ============================================================

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
}

const SEEKER_NAV: NavItem[] = [
  { href: '/chat',      labelKey: 'nav.chat',      icon: MessageCircle },
  { href: '/directory', labelKey: 'nav.directory',  icon: List },
  { href: '/map',       labelKey: 'nav.map',        icon: MapPin },
  { href: '/saved',     labelKey: 'nav.saved',      icon: Bookmark },
  { href: '/report',    labelKey: 'nav.report',     icon: Flag },
  { href: '/profile',   labelKey: 'nav.profile',    icon: User },
];

const UTILITY_NAV = [
  { href: '/about',        labelKey: 'nav.about'        },
  { href: '/partnerships', labelKey: 'nav.get_involved' },
] as const;

// ============================================================
// COMPONENT
// ============================================================

export function AppNav() {
  const pathname = usePathname() ?? '';
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useLocale();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav className="border-b border-gray-200 bg-white" aria-label={t('nav.main_label')}>
      <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 h-14">
        {/* Brand */}
        <Link
          href="/"
          className="font-bold text-lg tracking-tight text-gray-900 hover:text-blue-600 transition-colors"
        >
          ORAN
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-1">
          {SEEKER_NAV.map(({ href, labelKey, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(labelKey)}
              </Link>
            );
          })}
          <NotificationBell />
          <span className="h-5 w-px bg-gray-200 mx-1" aria-hidden="true" />
          {UTILITY_NAV.map(({ href, labelKey }) => {
            const active = isActive(href);
            const isGetInvolved = href === '/partnerships';
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors min-h-[44px] inline-flex items-center ${
                  isGetInvolved
                    ? active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                    : active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {t(labelKey)}
              </Link>
            );
          })}
          <LanguageSwitcher />
        </div>

        {/* Notification bell (mobile) + Mobile menu toggle */}
        <div className="flex items-center gap-1 sm:hidden">
          <NotificationBell />
          <button
            type="button"
            className="p-2 rounded-md hover:bg-gray-100 min-w-[44px] min-h-[44px] flex items-center justify-center"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? t('nav.close_menu') : t('nav.open_menu')}
          >
            {mobileOpen
              ? <X className="h-5 w-5 text-gray-700" aria-hidden="true" />
              : <Menu className="h-5 w-5 text-gray-700" aria-hidden="true" />}
          </button>
        </div>

      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div id="mobile-nav" className="sm:hidden border-t border-gray-100 bg-white px-4 pb-3 pt-1">
          {SEEKER_NAV.map(({ href, labelKey, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(labelKey)}
              </Link>
            );
          })}
          <div className="my-2 border-t border-gray-100" aria-hidden="true" />
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('nav.explore')}</p>
          {UTILITY_NAV.map(({ href, labelKey }) => {
            const active = isActive(href);
            const isGetInvolved = href === '/partnerships';
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
                  isGetInvolved
                    ? active
                      ? 'bg-indigo-600 text-white'
                      : 'text-indigo-700 hover:bg-indigo-50'
                    : active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {t(labelKey)}
              </Link>
            );
          })}
          <div className="mt-2 pt-2 border-t border-gray-100">
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </nav>
  );
}

export default AppNav;
