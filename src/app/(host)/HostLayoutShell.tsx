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
import { Award, Building2, Wrench, MapPin, Users, Tag, LayoutDashboard, ClipboardList, Layers3, ArrowRight } from 'lucide-react';
import { isRoleAtLeast } from '@/services/auth/roles';
import { AccessDenied } from '@/components/ui/access-denied';
import { Skeleton } from '@/components/ui/skeleton';
import AppNav from '@/components/nav/AppNav';
import { AppFooter } from '@/components/footer';
import HostContextStrip from '@/components/host/HostContextStrip';

const NAV_SECTIONS = [
  {
    heading: 'Workspace core',
    description: 'Overview, studio, and claim flow for daily publishing work.',
    items: [
      { href: '/host', label: 'Dashboard', icon: LayoutDashboard, description: 'Operational summary and recovery work.' },
      { href: '/resource-studio', label: 'Resource Studio', icon: Layers3, description: 'Unified listing and claim workspace.' },
      { href: '/claim', label: 'Claim', icon: Tag, description: 'Open or continue organization claims.' },
      { href: '/host-forms', label: 'Forms', icon: ClipboardList, description: 'Track inbound host form work.' },
    ],
  },
  {
    heading: 'Record maintenance',
    description: 'Maintain organization identity, services, and location accuracy.',
    items: [
      { href: '/org/profile', label: 'Profile', icon: Award, description: 'Trust, profile, and verification fields.' },
      { href: '/org', label: 'Organization', icon: Building2, description: 'Organization-level public record management.' },
      { href: '/services', label: 'Services', icon: Wrench, description: 'Service inventory and freshness maintenance.' },
      { href: '/locations', label: 'Locations', icon: MapPin, description: 'Address, hours, and site-level updates.' },
      { href: '/admins', label: 'Team', icon: Users, description: 'Access, invites, and role hygiene.' },
    ],
  },
] as const;

const PRIMARY_LINKS: ReadonlyArray<(typeof NAV_SECTIONS)[number]['items'][number]> = [
  NAV_SECTIONS[0].items[0],
  NAV_SECTIONS[0].items[1],
  NAV_SECTIONS[1].items[2],
  NAV_SECTIONS[1].items[4],
];

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

  if (
    status === 'unauthenticated'
    || (status === 'authenticated' && session.user.accountStatus === 'frozen')
    || (status === 'authenticated' && !isRoleAtLeast(session.user.role, 'host_member'))
  ) {
    return <AccessDenied portalName="Host" requiredRole="host_member" />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      {/* Skip-to-main-content: first focusable element for keyboard / screen-reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-[var(--bg-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--text-primary)] focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--text-primary)]"
      >
        Skip to main content
      </a>
      <AppNav />

      <nav
        aria-label="Host workspace navigation"
        className="sticky top-[4.5rem] z-[calc(var(--z-nav)-1)] border-b border-[var(--border)] bg-white/95 backdrop-blur lg:top-20"
      >
        <div className="container mx-auto px-4 py-3">
          <div className="grid gap-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">Workspace navigation</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Move between publishing, maintenance, and team recovery flows without horizontal overflow.</p>
              </div>
              <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]">
                Mobile-first
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PRIMARY_LINKS.map(({ href, label, icon: Icon, description }) => (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-2xl border p-4 shadow-sm transition-colors ${
                    isActive(href)
                      ? 'border-[var(--text-primary)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-alt)]'
                  }`}
                  aria-current={isActive(href) ? 'page' : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-white">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <p className="mt-3 text-sm font-semibold">{label}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="hidden lg:grid lg:gap-3">
            {NAV_SECTIONS.map((section) => (
              <div key={section.heading} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-sm">
                <div className="mb-3 px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{section.heading}</h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{section.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {section.items.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                        isActive(href)
                          ? 'border-[var(--text-primary)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]'
                      }`}
                      aria-current={isActive(href) ? 'page' : undefined}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>

      <HostContextStrip />
      <main id="main-content" className="container mx-auto max-w-7xl px-4 py-6">{children}</main>
      <AppFooter />
    </div>
  );
}
