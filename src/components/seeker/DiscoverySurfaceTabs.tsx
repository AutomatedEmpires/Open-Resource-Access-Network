'use client';

import React from 'react';
import Link from 'next/link';

type SurfaceTab = {
  href: string;
  label: string;
};

interface DiscoverySurfaceTabsProps {
  items: SurfaceTab[];
  currentHref: string;
  className?: string;
}

export function DiscoverySurfaceTabs({
  items,
  currentHref,
  className = '',
}: DiscoverySurfaceTabsProps) {
  return (
    <nav
      aria-label="Discovery surfaces"
      className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100/80 p-1 ${className}`.trim()}
    >
      {items.map((item) => {
        const active = item.href === currentHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default DiscoverySurfaceTabs;
