/**
 * ORAN Global Navigation
 *
 * Shared application header used across public, seeker, host, community admin,
 * and ORAN admin surfaces.
 */

'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { ChevronDown, List, LogOut, MapPin, Menu, MessageCircle, User, X } from 'lucide-react';
import type { OranRole } from '@/domain/types';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useLocale } from '@/contexts/LocaleContext';

function useOptionalSession() {
  try {
    return useSession();
  } catch {
    return { data: null };
  }
}

function useOptionalLocale() {
  try {
    return { ...useLocale(), hasLocaleProvider: true };
  } catch {
    return {
      hasLocaleProvider: false,
      t: (key: string) => {
        const fallbackLabels: Record<string, string> = {
          'nav.main_label': 'Main navigation',
          'nav.chat': 'Chat',
          'nav.directory': 'Directory',
          'nav.map': 'Map',
          'nav.profile': 'Profile',
          'nav.saved': 'Saved',
          'nav.notifications': 'Notifications',
          'nav.invitations': 'Invitations',
          'nav.sign_out': 'Sign out',
          'nav.sign_in': 'Sign in',
          'nav.profile_menu_aria': 'Profile menu',
          'nav.close_menu': 'Close menu',
          'nav.open_menu': 'Open menu',
          'nav.explore': 'Explore',
          'nav.work_with_us': 'Work with us',
        };
        return fallbackLabels[key] ?? key;
      },
    };
  }
}

interface PrimaryNavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
}

interface LinkMenuItem {
  kind: 'link';
  href: string;
  label: string;
}

interface ActionMenuItem {
  kind: 'action';
  id: 'sign-out';
  label: string;
}

type MenuItem = LinkMenuItem | ActionMenuItem;
type OpenMenu = 'profile' | 'work-with-us' | null;

const PRIMARY_NAV: PrimaryNavItem[] = [
  { href: '/chat', labelKey: 'nav.chat', icon: MessageCircle },
  { href: '/directory', labelKey: 'nav.directory', icon: List },
  { href: '/map', labelKey: 'nav.map', icon: MapPin },
];

const WORK_WITH_US_MENU: LinkMenuItem[] = [
  { kind: 'link', href: '/submit-resource', label: 'Submit a Listing' },
  { kind: 'link', href: '/partnerships/organizations', label: 'Register an Organization' },
  { kind: 'link', href: '/partnerships/admins', label: 'Become a Community Admin' },
  { kind: 'link', href: '/partnerships/oran-admins', label: 'Become an ORAN Admin' },
];

function getScopeBadge(role: OranRole | undefined, pathname: string): { label: string; href: string } | null {
  if (role === 'host_member' || role === 'host_admin') {
    return { label: 'Organization', href: '/host' };
  }

  if (role === 'community_admin') {
    return { label: 'Admin', href: '/dashboard' };
  }

  if (role === 'oran_admin') {
    return { label: 'Admin', href: '/operations' };
  }

  if (role === 'seeker') {
    return { label: 'Seeker', href: '/chat' };
  }

  if (/^\/(chat|directory|map|saved|profile|notifications|invitations|report|submit-resource|service)(?:\/|$)/.test(pathname)) {
    return { label: 'Seeker', href: '/chat' };
  }

  return null;
}

function getProfileMenuItems(role: OranRole | undefined, signInHref: string, t: (key: string) => string): MenuItem[] {
  if (role === 'host_member' || role === 'host_admin') {
    return [
      { kind: 'link', href: '/host', label: 'Organization workspace' },
      { kind: 'link', href: '/org/profile', label: 'Organization profile' },
      { kind: 'link', href: '/admins', label: 'Team access' },
      { kind: 'action', id: 'sign-out', label: t('nav.sign_out') },
    ];
  }

  if (role === 'community_admin') {
    return [
      { kind: 'link', href: '/dashboard', label: 'Admin workspace' },
      { kind: 'link', href: '/queue', label: 'Review queue' },
      { kind: 'link', href: '/coverage', label: 'Coverage' },
      { kind: 'action', id: 'sign-out', label: t('nav.sign_out') },
    ];
  }

  if (role === 'oran_admin') {
    return [
      { kind: 'link', href: '/operations', label: 'Admin workspace' },
      { kind: 'link', href: '/approvals', label: 'Approvals' },
      { kind: 'link', href: '/audit', label: 'Audit trail' },
      { kind: 'action', id: 'sign-out', label: t('nav.sign_out') },
    ];
  }

  if (role === 'seeker') {
    return [
      { kind: 'link', href: '/profile', label: t('nav.profile') },
      { kind: 'link', href: '/saved', label: t('nav.saved') },
      { kind: 'link', href: '/notifications', label: t('nav.notifications') },
      { kind: 'link', href: '/invitations', label: t('nav.invitations') },
      { kind: 'action', id: 'sign-out', label: t('nav.sign_out') },
    ];
  }

  return [{ kind: 'link', href: signInHref, label: t('nav.sign_in') }];
}

export function AppNav() {
  const pathname = usePathname() ?? '';
  const { data: session } = useOptionalSession();
  const [uiState, setUiState] = useState<{ mobileOpen: boolean; openMenu: OpenMenu }>({
    mobileOpen: false,
    openMenu: null,
  });
  const { t, hasLocaleProvider } = useOptionalLocale();

  const currentRole = session?.user?.role;
  const signInHref = pathname
    ? `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`
    : '/auth/signin';

  const scopeBadge = useMemo(() => getScopeBadge(currentRole, pathname), [currentRole, pathname]);
  const profileMenuItems = useMemo(
    () => getProfileMenuItems(currentRole, signInHref, t),
    [currentRole, signInHref, t],
  );

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const isProfileActive = profileMenuItems.some((item) => item.kind === 'link' && isActive(item.href));
  const isWorkWithUsActive = WORK_WITH_US_MENU.some((item) => isActive(item.href));

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
    setUiState({ mobileOpen: false, openMenu: null });
  };

  const handleSignOut = () => {
    closeAllMenus();
    void signOut({ callbackUrl: '/' });
  };

  return (
    <nav className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border)] bg-white/95 backdrop-blur" aria-label={t('nav.main_label')}>
      <div className="container relative mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-3 px-4 lg:h-20 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5 lg:gap-3">
          <Link
            href="/"
            className="shrink-0 text-2xl font-bold tracking-tight text-[var(--text-primary)] transition-colors hover:text-[var(--text-primary)] sm:text-3xl"
          >
            ORAN
          </Link>

          {scopeBadge ? (
            <Link
              href={scopeBadge.href}
              className="inline-flex min-h-[32px] max-w-[8.5rem] items-center truncate rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] shadow-sm transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)] sm:max-w-none sm:text-[11px]"
              aria-label={`Current scope: ${scopeBadge.label}`}
            >
              {scopeBadge.label}
            </Link>
          ) : null}
        </div>

        <div className="absolute left-1/2 hidden -translate-x-1/2 lg:flex">
          <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-2 py-1 shadow-sm">
            {PRIMARY_NAV.map(({ href, labelKey, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`inline-flex min-h-[50px] items-center gap-2 rounded-full px-5 py-2.5 text-base font-medium transition-colors ${
                    active
                      ? 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
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

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleMenu('profile')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isProfileActive || uiState.openMenu === 'profile'
                  ? 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                  : 'border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
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
              <div className="absolute right-0 top-full z-50 mt-2 min-w-56 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-lg">
                <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {scopeBadge?.label ?? t('nav.profile')}
                </div>
                <div className="p-1.5">
                  {profileMenuItems.map((item) => {
                    if (item.kind === 'action') {
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={handleSignOut}
                          className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
                        >
                          <LogOut className="h-4 w-4" aria-hidden="true" />
                          {item.label}
                        </button>
                      );
                    }

                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeAllMenus}
                        className={`flex min-h-[44px] items-center rounded-xl px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-[var(--bg-surface-alt)] font-semibold text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                        }`}
                        aria-current={active ? 'page' : undefined}
                      >
                        {item.label}
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
              onClick={() => toggleMenu('work-with-us')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isWorkWithUsActive || uiState.openMenu === 'work-with-us'
                  ? 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                  : 'border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
              }`}
              aria-expanded={uiState.openMenu === 'work-with-us'}
              aria-haspopup="menu"
              aria-label={t('nav.get_involved_menu_aria')}
            >
              {t('nav.work_with_us')}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${uiState.openMenu === 'work-with-us' ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {uiState.openMenu === 'work-with-us' && (
              <div className="absolute right-0 top-full z-50 mt-2 min-w-64 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-lg">
                <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {t('nav.work_with_us')}
                </div>
                <div className="p-1.5">
                  {WORK_WITH_US_MENU.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeAllMenus}
                        className={`flex min-h-[44px] items-center rounded-xl px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-[var(--bg-surface-alt)] font-semibold text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                        }`}
                        aria-current={active ? 'page' : undefined}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {hasLocaleProvider ? <LanguageSwitcher /> : null}
        </div>

        <div className="flex items-center lg:hidden">
          <button
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 hover:bg-[var(--bg-surface-alt)]"
            onClick={toggleMobile}
            aria-expanded={uiState.mobileOpen}
            aria-controls="mobile-nav"
            aria-label={uiState.mobileOpen ? t('nav.close_menu') : t('nav.open_menu')}
          >
            {uiState.mobileOpen
              ? <X className="h-5 w-5 text-[var(--text-primary)]" aria-hidden="true" />
              : <Menu className="h-5 w-5 text-[var(--text-primary)]" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {uiState.mobileOpen && (
        <div id="mobile-nav" className="border-t border-[var(--border)] bg-white px-4 pb-4 pt-3 lg:hidden">
          {scopeBadge ? (
            <div className="mb-3 flex items-center">
              <Link
                href={scopeBadge.href}
                onClick={closeAllMenus}
                className="inline-flex min-h-[32px] items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] shadow-sm"
              >
                {scopeBadge.label}
              </Link>
            </div>
          ) : null}

          <div className="space-y-1">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {t('nav.explore')}
            </p>
            {PRIMARY_NAV.map(({ href, labelKey, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeAllMenus}
                  className={`flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
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
              {scopeBadge?.label ?? t('nav.profile')}
            </p>
            {profileMenuItems.map((item) => {
              if (item.kind === 'action') {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={handleSignOut}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </button>
                );
              }

              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeAllMenus}
                  className={`flex min-h-[44px] items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="my-3 border-t border-[var(--border)]" aria-hidden="true" />

          <div className="space-y-1">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {t('nav.work_with_us')}
            </p>
            {WORK_WITH_US_MENU.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeAllMenus}
                  className={`flex min-h-[44px] items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="mt-3 border-t border-[var(--border)] pt-3">
            {hasLocaleProvider ? <LanguageSwitcher /> : null}
          </div>
        </div>
      )}
    </nav>
  );
}

export default AppNav;
