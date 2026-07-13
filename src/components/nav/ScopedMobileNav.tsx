'use client';

import Link from 'next/link';
import { House, List, MapPin, MessageCircle } from 'lucide-react';
import type { ElementType } from 'react';

const MOBILE_NAV_ICONS = {
  home: House,
  chat: MessageCircle,
  directory: List,
  map: MapPin,
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

interface ScopedMobileNavProps {
  scopeLabel: string;
  pathname: string;
  items: readonly ScopedMobileNavItem[];
}

export function ScopedMobileNav({ scopeLabel, pathname, items }: ScopedMobileNavProps) {
  const isActive = (href: string) => (
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[var(--z-nav)] border-t border-slate-200/80 bg-white/95 backdrop-blur md:hidden"
      aria-label={`${scopeLabel} mobile navigation`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <span className="sr-only">Current scope: {scopeLabel}</span>
      <div className="flex h-14 w-full items-center">
        {items.map(({ href, label, icon, badge }) => {
          const active = isActive(href);
          const Icon = isMobileNavIconName(icon) ? MOBILE_NAV_ICONS[icon] : icon;
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden text-[10px] font-medium transition-colors sm:text-xs ${
                active ? 'text-action-base' : 'text-slate-400 hover:text-slate-700'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span className={`relative flex items-center justify-center rounded-full px-3 py-1 transition-colors ${
                active ? 'bg-slate-100' : ''
              }`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
                {badge !== undefined && badge !== '' && (
                  <span
                    className="absolute -right-2 -top-1.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-slate-900 px-0.5 text-[9px] font-bold leading-none text-white"
                    aria-label={`${badge} ${label.toLowerCase()}`}
                  >
                    {badge}
                  </span>
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
