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

  if (status === 'authenticated' && !isRoleAtLeast(session.user.role, 'host_member')) {
    return <AccessDenied portalName="Host" requiredRole="host_member" />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="container mx-auto max-w-7xl flex items-center justify-between px-4 h-14">
          <Link href="/host" className="font-bold text-gray-900 tracking-tight">
            ORAN Host
          </Link>

          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Host navigation">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive(href)
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  aria-current={isActive(href) ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </nav>
            <PortalUserMenu />
          </div>
        </div>
      </header>

      <HostContextStrip />
      <main id="main-content" className="container mx-auto max-w-7xl px-4 py-6">{children}</main>
      <AppFooter />
    </div>
  );
}
