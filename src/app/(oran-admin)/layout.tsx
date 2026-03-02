/**
 * ORAN Admin Layout Shell
 *
 * Minimal navigation chrome for governance surfaces.
 * Per ADR-0002: vertical shells prevent role/nav leakage.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/approvals', label: 'Approvals' },
  { href: '/rules', label: 'Rules' },
  { href: '/audit', label: 'Audit' },
  { href: '/zone-management', label: 'Zones' },
] as const;

export default function OranAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 h-14">
          <Link href="/approvals" className="font-bold text-gray-900 tracking-tight">
            ORAN Admin
          </Link>

          <nav className="flex items-center gap-1" aria-label="ORAN admin navigation">
            {NAV_ITEMS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
                aria-current={isActive(href) ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
