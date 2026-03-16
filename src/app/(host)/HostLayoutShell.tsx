/**
 * Host Layout Shell — client component.
 *
 * Handles session auth-gating and nav rendering for the host portal.
 * noindex / title metadata is handled by the server layout.tsx.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Award, Building2, Wrench, MapPin, Users, Tag, LayoutDashboard, ClipboardList, Layers3 } from 'lucide-react';
import { isRoleAtLeast } from '@/services/auth/roles';
import { AccessDenied } from '@/components/ui/access-denied';
import { Skeleton } from '@/components/ui/skeleton';
import { AppFooter } from '@/components/footer';
import { PortalUserMenu } from '@/components/ui/portal-user-menu';
import HostContextStrip from '@/components/host/HostContextStrip';

const NAV_ITEMS = [
  { href: '/host', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/org/profile', label: 'Profile', icon: Award },
  { href: '/org', label: 'Organization', icon: Building2 },
  { href: '/services', label: 'Services', icon: Wrench },
  { href: '/resource-studio', label: 'Resource Studio', icon: Layers3 },
  { href: '/locations', label: 'Locations', icon: MapPin },
  { href: '/host-forms', label: 'Forms', icon: ClipboardList },
  { href: '/admins', label: 'Team', icon: Users },
  { href: '/claim', label: 'Claim', icon: Tag },
] as const;

export default function HostLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--bg-page)]" aria-busy="true" aria-label="Loading Host portal">
        <div className="sticky top-0 z-[var(--z-nav)] h-14 border-b border-[var(--border)] bg-[var(--bg-surface)]" />
        <div className="container mx-auto max-w-7xl space-y-4 px-4 py-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated' || (status === 'authenticated' && !isRoleAtLeast(session.user.role, 'host_member'))) {
    return <AccessDenied portalName="Host" requiredRole="host_member" />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      {/* Skip-to-main-content: first focusable element for keyboard / screen-reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-sky-700 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        Skip to main content
      </a>
      <header aria-label="Host portal navigation" className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border)] bg-white/95 backdrop-blur">
        <div className="container mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/host" className="shrink-0 text-2xl font-bold tracking-tight text-gray-900">
              ORAN
            </Link>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 md:inline-flex">
              Organization
            </span>
          </div>

          <div className="hidden flex-1 items-center justify-center lg:flex">
            <nav className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm" aria-label="Host navigation">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`inline-flex min-h-[50px] items-center gap-2 rounded-full px-5 py-2.5 text-base transition-colors whitespace-nowrap ${
                    isActive(href)
                      ? 'border border-slate-200 bg-slate-50 font-semibold text-slate-950'
                      : 'font-medium text-stone-500 hover:bg-stone-50 hover:text-stone-900'
                  }`}
                  aria-current={isActive(href) ? 'page' : undefined}
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="hidden lg:flex items-center">
            <PortalUserMenu />
          </div>

          <div className="flex lg:hidden items-center">
            <PortalUserMenu />
          </div>
        </div>

        {/* Mobile nav strip (below lg) — scrollable icon+label tabs */}
        <nav
          className="lg:hidden overflow-x-auto scrollbar-none border-t border-[var(--border)]"
          aria-label="Host navigation"
        >
          <div className="flex items-stretch px-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-16 px-2 py-1 text-[10px] font-medium transition-colors whitespace-nowrap border-b-2 ${
                  isActive(href)
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-stone-500 hover:text-stone-800 hover:border-stone-300'
                }`}
                aria-current={isActive(href) ? 'page' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate max-w-14">{label}</span>
              </Link>
            ))}
          </div>
        </nav>
      </header>

      <HostContextStrip />
      <main id="main-content" className="container mx-auto max-w-7xl px-4 py-6">{children}</main>
      <AppFooter />
    </div>
  );
}
