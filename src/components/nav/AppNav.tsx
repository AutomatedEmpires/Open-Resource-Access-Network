/**
 * ORAN Global Navigation
 *
 * Persistent top navigation bar shown on all pages.
 * Clean public-first IA: brand, primary seeker routes, account menu,
 * get involved menu, then language selector.
 */

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, List, MapPin, Menu, MessageCircle, User, X } from 'lucide-react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useLocale } from '@/contexts/LocaleContext';

interface PrimaryNavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
}

interface MenuNavItem {
  href: string;
  labelKey: string;
}

type OpenMenu = 'profile' | 'get-involved' | null;

const PRIMARY_NAV: PrimaryNavItem[] = [
  { href: '/chat', labelKey: 'nav.chat', icon: MessageCircle },
  { href: '/map', labelKey: 'nav.map', icon: MapPin },
  { href: '/directory', labelKey: 'nav.directory', icon: List },
];

const PROFILE_MENU: MenuNavItem[] = [
  { href: '/profile', labelKey: 'nav.profile' },
  { href: '/saved', labelKey: 'nav.saved' },
  { href: '/notifications', labelKey: 'nav.notifications' },
  { href: '/invitations', labelKey: 'nav.invitations' },
];

const GET_INVOLVED_MENU: MenuNavItem[] = [
  { href: '/submit-resource', labelKey: 'nav.submit_listing' },
  { href: '/partnerships/organizations', labelKey: 'nav.register_organization' },
  { href: '/partnerships/admins', labelKey: 'nav.become_community_admin' },
  { href: '/partnerships/oran-admins', labelKey: 'nav.become_oran_admin' },
];

export function AppNav() {
  const pathname = usePathname() ?? '';
  const [uiState, setUiState] = useState<{ mobileOpen: boolean; openMenu: OpenMenu }>({
    mobileOpen: false,
    openMenu: null,
  });
  const { t } = useLocale();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const isGroupActive = (items: MenuNavItem[]) => items.some((item) => isActive(item.href));

  const toggleMobile = () => {
    setUiState((prev) => ({
      mobileOpen: !prev.mobileOpen,
      openMenu: null,
    }));
  };

  const toggleMenu = (menu: Exclude<OpenMenu, null>) => {
    setUiState((prev) => ({
      ...prev,
      openMenu: prev.openMenu === menu ? null : menu,
    }));
  };

  const closeAllMenus = () => {
    setUiState(() => ({ mobileOpen: false, openMenu: null }));
  };

  return (
    <nav className="border-b border-[var(--border)] bg-white/95 backdrop-blur" aria-label={t('nav.main_label')}>
      <div className="container mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-4 lg:h-20">
        <div className="flex flex-1 items-center gap-3 sm:gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="text-2xl font-bold tracking-tight text-[var(--text-primary)] transition-colors hover:text-[var(--text-primary)] sm:text-3xl"
            >
              ORAN
            </Link>
          </div>

          <div className="hidden flex-1 items-center justify-center lg:flex">
            <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-2 py-1 shadow-sm">
              {PRIMARY_NAV.map(({ href, labelKey, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`inline-flex min-h-[50px] items-center gap-2 rounded-full px-5 py-2.5 text-base font-medium transition-colors ${
                      active
                        ? 'border border-[var(--border)] bg-gray-50 text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    {t(labelKey)}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="hidden flex-1 items-center justify-end gap-2 lg:flex">
          <span className="h-6 w-px bg-[var(--border)]" aria-hidden="true" />

          <div className="relative">
            <button
              type="button"
              onClick={() => toggleMenu('profile')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isGroupActive(PROFILE_MENU) || uiState.openMenu === 'profile'
                  ? 'border border-[var(--border)] bg-white text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
              }`}
              aria-expanded={uiState.openMenu === 'profile'}
              aria-haspopup="menu"
              aria-label={t('nav.profile_menu_aria')}
            >
              <User className="h-4 w-4" aria-hidden="true" />
              {t('nav.profile')}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${uiState.openMenu === 'profile' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {uiState.openMenu === 'profile' && (
              <div className="absolute right-0 top-full z-50 mt-2 min-w-56 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
                <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {t('nav.profile')}
                </div>
                <div className="p-1.5">
                  {PROFILE_MENU.map(({ href, labelKey }) => {
                    const active = isActive(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={closeAllMenus}
                        className={`flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-gray-50 font-semibold text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
                        }`}
                        aria-current={active ? 'page' : undefined}
                      >
                        {t(labelKey)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => toggleMenu('get-involved')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isGroupActive(GET_INVOLVED_MENU) || uiState.openMenu === 'get-involved'
                  ? 'border border-[var(--border)] bg-white text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
              }`}
              aria-expanded={uiState.openMenu === 'get-involved'}
              aria-haspopup="menu"
              aria-label={t('nav.get_involved_menu_aria')}
            >
              {t('nav.get_involved')}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${uiState.openMenu === 'get-involved' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {uiState.openMenu === 'get-involved' && (
              <div className="absolute right-0 top-full z-50 mt-2 min-w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg">
                <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {t('nav.get_involved')}
                </div>
                <div className="p-1.5">
                  {GET_INVOLVED_MENU.map(({ href, labelKey }) => {
                    const active = isActive(href);
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={closeAllMenus}
                        className={`flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-gray-50 font-semibold text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
                        }`}
                        aria-current={active ? 'page' : undefined}
                      >
                        {t(labelKey)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <LanguageSwitcher />
        </div>

        <div className="flex items-center lg:hidden">
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 hover:bg-gray-100"
            onClick={toggleMobile}
            aria-expanded={uiState.mobileOpen}
            aria-controls="mobile-nav"
            aria-label={uiState.mobileOpen ? t('nav.close_menu') : t('nav.open_menu')}
          >
            {uiState.mobileOpen
              ? <X className="h-5 w-5 text-gray-700" aria-hidden="true" />
              : <Menu className="h-5 w-5 text-gray-700" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {uiState.mobileOpen && (
        <div id="mobile-nav" className="border-t border-[var(--border)] bg-white px-4 pb-4 pt-2 lg:hidden">
          <div className="space-y-1">
            {PRIMARY_NAV.map(({ href, labelKey, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeAllMenus}
                  className={`flex min-h-[44px] items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border border-[var(--border)] bg-white text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(labelKey)}
                </Link>
              );
            })}
          </div>

          <div className="my-3 border-t border-[var(--border)]" aria-hidden="true" />

          <div className="space-y-1">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {t('nav.profile')}
            </p>
            {PROFILE_MENU.map(({ href, labelKey }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeAllMenus}
                  className={`flex min-h-[44px] items-center rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border border-[var(--border)] bg-white text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {t(labelKey)}
                </Link>
              );
            })}
          </div>

          <div className="my-3 border-t border-[var(--border)]" aria-hidden="true" />

          <div className="space-y-1">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {t('nav.get_involved')}
            </p>
            {GET_INVOLVED_MENU.map(({ href, labelKey }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeAllMenus}
                  className={`flex min-h-[44px] items-center rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border border-[var(--border)] bg-white text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {t(labelKey)}
                </Link>
              );
            })}
          </div>

          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </nav>
  );
}

export default AppNav;
