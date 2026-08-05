/**
 * ORAN Global Navigation
 *
 * Shared application header used across public, seeker, host, community admin,
 * and ORAN admin surfaces.
 */

'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  Bookmark,
  ChevronDown,
  List,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Rows3,
  User,
  X,
} from 'lucide-react';

import type { OranRole } from '@/domain/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useCrisisModal } from '@/components/crisis/CrisisContext';
import { useOranAuth } from '@/services/auth/client';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NotificationBell } from './NotificationBell';

function useOptionalAuth() {
  try {
    return useOranAuth();
  } catch {
    return {
      data: null,
      status: 'unauthenticated' as const,
      signOut: async () => undefined,
    };
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
          'nav.chat': 'Find help',
          'nav.directory': 'Browse services',
          'nav.map': 'Map',
          'nav.scroll': 'Resource feed',
          'nav.profile': 'Profile',
          'nav.account': 'Account',
          'nav.saved': 'Saved',
          'nav.crisis': 'Crisis',
          'footer.crisis_resources_aria': 'Open crisis resources and emergency hotlines',
          'nav.notifications': 'Notifications',
          'nav.invitations': 'Organization invitations',
          'nav.sign_out': 'Sign out',
          'nav.sign_in': 'Sign in',
          'nav.profile_menu_aria': 'Open account menu',
          'nav.close_menu': 'Close menu',
          'nav.open_menu': 'Open menu',
          'nav.explore': 'More ways to browse',
          'nav.more': 'More',
          'nav.for_providers': 'For providers',
          'nav.submit_or_correct': 'Submit or correct a resource',
          'nav.volunteer_to_review': 'Volunteer to review resources',
          'nav.your_services': 'Your services',
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

interface LocalizedLinkItem {
  href: string;
  labelKey: string;
}

interface ActionMenuItem {
  kind: 'action';
  id: 'sign-out';
  label: string;
}

type MenuItem = LinkMenuItem | ActionMenuItem;

const PRIMARY_NAV: PrimaryNavItem[] = [
  { href: '/chat', labelKey: 'nav.chat', icon: MessageCircle },
  { href: '/directory', labelKey: 'nav.directory', icon: List },
  { href: '/map', labelKey: 'nav.map', icon: MapPin },
];

const MOBILE_CORE_NAV: PrimaryNavItem[] = [
  ...PRIMARY_NAV,
  { href: '/saved', labelKey: 'nav.saved', icon: Bookmark },
];

const MOBILE_DISCOVERY_NAV: PrimaryNavItem[] = [
  { href: '/scroll', labelKey: 'nav.scroll', icon: Rows3 },
];

const MOBILE_MORE_LINKS: LocalizedLinkItem[] = [
  { href: '/partnerships/organizations', labelKey: 'nav.for_providers' },
  { href: '/submit-resource', labelKey: 'nav.submit_or_correct' },
  { href: '/partnerships/admins', labelKey: 'nav.volunteer_to_review' },
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

  if (/^\/(chat|directory|map|scroll|saved|profile|notifications|invitations|report|submit-resource|service)(?:\/|$)/.test(pathname)) {
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
      { kind: 'link', href: '/notifications', label: t('nav.notifications') },
      { kind: 'action', id: 'sign-out', label: t('nav.sign_out') },
    ];
  }

  if (role === 'community_admin') {
    return [
      { kind: 'link', href: '/dashboard', label: 'Admin workspace' },
      { kind: 'link', href: '/queue', label: 'Review queue' },
      { kind: 'link', href: '/coverage', label: 'Coverage' },
      { kind: 'link', href: '/notifications', label: t('nav.notifications') },
      { kind: 'action', id: 'sign-out', label: t('nav.sign_out') },
    ];
  }

  if (role === 'oran_admin') {
    return [
      { kind: 'link', href: '/operations', label: 'Admin workspace' },
      { kind: 'link', href: '/approvals', label: 'Approvals' },
      { kind: 'link', href: '/audit', label: 'Audit trail' },
      { kind: 'link', href: '/notifications', label: t('nav.notifications') },
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

  return [
    { kind: 'link', href: '/saved', label: t('nav.saved') },
    { kind: 'link', href: '/profile', label: t('nav.profile') },
    { kind: 'link', href: signInHref, label: t('nav.sign_in') },
  ];
}

export function AppNav() {
  const pathname = usePathname() ?? '';
  const { data: session, signOut } = useOptionalAuth();
  const [uiState, setUiState] = useState({ mobileOpen: false, profileOpen: false });
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const { t, hasLocaleProvider } = useOptionalLocale();
  const { openCrisis } = useCrisisModal();

  const currentRole = session?.user?.role;
  const isAuthenticated = Boolean(session?.user);
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
  const isProviderActive = isActive('/partnerships/organizations');

  const toggleMobile = () => {
    setUiState((current) => ({
      mobileOpen: !current.mobileOpen,
      profileOpen: false,
    }));
  };

  const toggleProfile = () => {
    setUiState((current) => ({ ...current, profileOpen: !current.profileOpen }));
  };

  const closeAllMenus = () => {
    setUiState({ mobileOpen: false, profileOpen: false });
  };

  const handleSignOut = () => {
    closeAllMenus();
    void signOut({ redirectUrl: '/' });
  };

  const handleNavigationKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;

    if (uiState.profileOpen) {
      event.preventDefault();
      closeAllMenus();
      accountTriggerRef.current?.focus();
      return;
    }

    if (uiState.mobileOpen) {
      event.preventDefault();
      closeAllMenus();
      mobileTriggerRef.current?.focus();
    }
  };

  return (
    <nav
      className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border)] bg-white/95 backdrop-blur"
      aria-label={t('nav.main_label')}
      onKeyDown={handleNavigationKeyDown}
    >
      <div className="app-nav-grid mx-auto flex h-16 max-w-none items-center gap-3 px-4 2xl:px-6">
        <div className="flex min-w-0 items-center gap-2.5 lg:justify-self-start" data-testid="nav-brand-scope">
          <Link
            href="/"
            className="shrink-0 text-2xl font-bold tracking-tight text-[var(--text-primary)]"
          >
            ORAN
          </Link>

          {scopeBadge ? (
            <Link
              href={scopeBadge.href}
              className="inline-flex min-h-8 max-w-32 items-center truncate rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)] sm:max-w-none"
              aria-label={`Current scope: ${scopeBadge.label}`}
            >
              {scopeBadge.label}
            </Link>
          ) : null}
        </div>

        <div className="hidden items-center gap-1 whitespace-nowrap lg:flex lg:justify-self-center" data-testid="desktop-primary-nav">
          {PRIMARY_NAV.map(({ href, labelKey, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
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

        <div
          className="hidden h-full min-w-0 items-center justify-end gap-1 whitespace-nowrap 2xl:flex 2xl:justify-self-end"
          data-testid="desktop-nav-actions"
        >
          <NotificationBell />

          {!isAuthenticated ? (
            <>
              <Link
                href="/saved"
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                  isActive('/saved')
                    ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                }`}
                aria-current={isActive('/saved') ? 'page' : undefined}
              >
                <Bookmark className="h-4 w-4" aria-hidden="true" />
                {t('nav.saved')}
              </Link>
              <Link
                href="/profile"
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                  isActive('/profile')
                    ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                }`}
                aria-current={isActive('/profile') ? 'page' : undefined}
              >
                <User className="h-4 w-4" aria-hidden="true" />
                {t('nav.profile')}
              </Link>
            </>
          ) : null}

          <Link
            href="/partnerships/organizations"
            className={`inline-flex min-h-[44px] items-center rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
              isProviderActive
                ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
            }`}
            aria-current={isProviderActive ? 'page' : undefined}
          >
            {t('nav.for_providers')}
          </Link>

          {hasLocaleProvider ? <LanguageSwitcher /> : null}

          {isAuthenticated ? (
            <div className="relative flex h-full items-center">
              <button
                ref={accountTriggerRef}
                type="button"
                onClick={toggleProfile}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isProfileActive || uiState.profileOpen
                    ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                }`}
                aria-expanded={uiState.profileOpen}
                aria-controls="account-disclosure"
                aria-label={t('nav.profile_menu_aria')}
              >
                <User className="h-4 w-4" aria-hidden="true" />
                {t('nav.account')}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${uiState.profileOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>

              {uiState.profileOpen ? (
                <div
                  id="account-disclosure"
                  className="absolute right-0 top-full z-50 mt-2 min-w-60 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-xl"
                  aria-label={t('nav.account')}
                >
                  <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                    {scopeBadge?.label ?? t('nav.account')}
                  </div>
                  <div className="p-1.5">
                    {profileMenuItems.map((item) => {
                      if (item.kind === 'action') {
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={handleSignOut}
                            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
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
                          className={`flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm transition-colors ${
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
              ) : null}
            </div>
          ) : (
            <Link
              href={signInHref}
              className="inline-flex min-h-11 items-center rounded-lg bg-[var(--text-primary)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-navy)]"
            >
              {t('nav.sign_in')}
            </Link>
          )}
        </div>

        <div className="ml-auto flex items-center 2xl:hidden" data-testid="compact-nav-actions">
          <button
            type="button"
            onClick={openCrisis}
            className="hidden min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 md:inline-flex 2xl:hidden"
            aria-haspopup="dialog"
            aria-label={t('footer.crisis_resources_aria')}
            data-tablet-crisis-control
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t('nav.crisis')}
          </button>
          <button
            ref={mobileTriggerRef}
            type="button"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 hover:bg-[var(--bg-surface-alt)]"
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

      {uiState.mobileOpen ? (
        <div id="mobile-nav" className="app-nav-mobile-panel overflow-y-auto border-t border-[var(--border)] bg-white px-4 pb-5 pt-3 2xl:hidden">
          {scopeBadge ? (
            <div className="mb-3 flex items-center">
              <Link
                href={scopeBadge.href}
                onClick={closeAllMenus}
                className="inline-flex min-h-8 items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]"
              >
                {scopeBadge.label}
              </Link>
            </div>
          ) : null}

          <div className="space-y-1">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {t('nav.explore')}
            </p>
            {MOBILE_CORE_NAV.map(({ href, labelKey, icon: Icon }) => {
              const active = isActive(href);
              const duplicatedByScopedNav = href === '/chat' || href === '/directory' || href === '/saved';
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeAllMenus}
                  className={`${duplicatedByScopedNav ? 'app-nav-scoped-duplicate ' : ''}flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(labelKey)}
                </Link>
              );
            })}
            {MOBILE_DISCOVERY_NAV.map(({ href, labelKey, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeAllMenus}
                  className={`flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
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
              {isAuthenticated ? t('nav.account') : t('nav.your_services')}
            </p>
            {profileMenuItems.filter((item) => item.kind !== 'link' || item.href !== '/saved').map((item) => {
              if (item.kind === 'action') {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={handleSignOut}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
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
                  className={`flex min-h-[44px] items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
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
              {t('nav.more')}
            </p>
            {MOBILE_MORE_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeAllMenus}
                className="flex min-h-[44px] items-center rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>

          {hasLocaleProvider ? (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <LanguageSwitcher />
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

export default AppNav;
