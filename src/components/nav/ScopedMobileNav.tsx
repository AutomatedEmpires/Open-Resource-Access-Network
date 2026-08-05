'use client';

import Link from 'next/link';
import { AlertTriangle, Bookmark, House, List, MapPin, MessageCircle, Rows3, UserRound } from 'lucide-react';
import type { ElementType } from 'react';
import { useCrisisModal } from '@/components/crisis/CrisisContext';
import { useLocale } from '@/contexts/LocaleContext';

const FALLBACK_LABELS: Record<string, string> = {
  'nav.home': 'Home',
  'nav.chat': 'Find help',
  'nav.browse': 'Browse',
  'nav.directory': 'Browse',
  'nav.saved': 'Saved',
  'nav.crisis': 'Crisis',
  'footer.crisis_resources_aria': 'Open crisis resources and emergency hotlines',
};

function useOptionalLocale() {
  try {
    return { ...useLocale() };
  } catch {
    return { t: (key: string) => FALLBACK_LABELS[key] ?? key };
  }
}

const MOBILE_NAV_ICONS = {
  home: House,
  chat: MessageCircle,
  directory: List,
  map: MapPin,
  scroll: Rows3,
  profile: UserRound,
  saved: Bookmark,
} as const;

export type MobileNavIconName = keyof typeof MOBILE_NAV_ICONS;

function isMobileNavIconName(icon: ElementType | MobileNavIconName): icon is MobileNavIconName {
  return typeof icon === 'string' && icon in MOBILE_NAV_ICONS;
}

export interface ScopedMobileNavItem {
  href: string;
  label: string;
  icon: ElementType | MobileNavIconName;
  badge?: string | number;
}

/** Seeker mobile navigation is intentionally invariant across seeker routes. */
export const SEEKER_MOBILE_NAV_ITEMS = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/chat', label: 'Find help', icon: 'chat' },
  { href: '/directory', label: 'Browse', icon: 'directory' },
  { href: '/saved', label: 'Saved', icon: 'saved' },
] as const satisfies readonly ScopedMobileNavItem[];

const SEEKER_DESTINATIONS = new Set<string>(SEEKER_MOBILE_NAV_ITEMS.map(({ href }) => href));
const SEEKER_LABEL_KEYS: Record<string, string> = {
  '/': 'nav.home',
  '/chat': 'nav.chat',
  '/directory': 'nav.browse',
  '/saved': 'nav.saved',
};

interface ScopedMobileNavProps {
  scopeLabel: string;
  pathname: string;
  items: readonly ScopedMobileNavItem[];
}

export function ScopedMobileNav({ scopeLabel, pathname, items }: ScopedMobileNavProps) {
  const { openCrisis } = useCrisisModal();
  const { t: localeT } = useOptionalLocale();
  const t = (key: string) => {
    const translated = localeT(key);
    return translated === key ? (FALLBACK_LABELS[key] ?? key) : translated;
  };
  const isSeekerDiscoveryNav = items.length === SEEKER_MOBILE_NAV_ITEMS.length
    && items.every(({ href }) => SEEKER_DESTINATIONS.has(href));
  const isActive = (href: string) => (
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[var(--z-nav)] border-t border-white/70 bg-white/95 shadow-lg backdrop-blur-xl md:hidden"
      aria-label={`${scopeLabel} mobile navigation`}
      data-scoped-mobile-nav
      data-seeker-discovery-nav={isSeekerDiscoveryNav ? '' : undefined}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <span className="sr-only">Current scope: {scopeLabel}</span>
      <div className="flex h-14 w-full items-center">
        {items.map(({ href, label, icon, badge }) => {
          const active = isActive(href);
          const Icon = isMobileNavIconName(icon) ? MOBILE_NAV_ICONS[icon] : icon;
          const labelKey = SEEKER_LABEL_KEYS[href];
          const visibleLabel = isSeekerDiscoveryNav && labelKey ? t(labelKey) : label;
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden text-[10px] font-bold transition-colors sm:text-xs ${
                active ? 'text-[var(--brand-cobalt)]' : 'text-[var(--text-muted)] hover:text-[var(--brand-cobalt)]'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span className={`relative flex items-center justify-center rounded-full px-3 py-1 transition-colors ${
                active ? 'bg-gradient-brand-deep text-white shadow-md' : ''
              }`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
                {badge !== undefined && badge !== '' && (
                  <span
                    className="absolute -right-2 -top-1.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--brand-navy)] px-0.5 text-[9px] font-bold leading-none text-white"
                    aria-label={`${badge} ${visibleLabel.toLowerCase()}`}
                  >
                    {badge}
                  </span>
                )}
              </span>
              {visibleLabel}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={openCrisis}
          className="relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden text-[10px] font-bold text-red-700 transition-colors hover:bg-red-50 sm:text-xs"
          aria-haspopup="dialog"
          aria-label={t('footer.crisis_resources_aria')}
        >
          <span className="flex items-center justify-center rounded-full px-3 py-1">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          {t('nav.crisis')}
        </button>
      </div>
    </nav>
  );
}
