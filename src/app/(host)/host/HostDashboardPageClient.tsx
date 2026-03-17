'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  BookOpen,
  Building2,
  ClipboardList,
  LayoutDashboard,
  Layers3,
  MapPin,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
  Wrench,
  CheckSquare2,
  FileCheck,
  Siren,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

interface DashboardSummary {
  organizations: number;
  incompleteOrganizations: number;
  services: number;
  staleServices: number;
  locations: number;
  staleLocations: number;
  teamMembers: number;
  pendingInvites: number;
  pendingReviews: number;
  claimsInFlight: number;
}

interface RecentSubmission {
  id: string;
  title: string | null;
  submission_type: string;
  status: string;
  organization_name: string | null;
  created_at: string;
}

interface HostDashboardData {
  summary: DashboardSummary;
  recentSubmissions: RecentSubmission[];
}

function MetricCard({
  label,
  value,
  href,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  icon: React.ElementType;
  tone: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-1"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
          <p className="mt-1 text-3xl font-bold text-[var(--text-primary)]">{value}</p>
        </div>
        <div className={`rounded-lg border p-2.5 ${tone}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open workspace <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </div>
    </Link>
  );
}

function QuickAction({
  href,
  label,
  description,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-1"
    >
      <div className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] p-2 text-[var(--text-secondary)]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--text-primary)]">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>
      </div>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]" aria-hidden="true" />
    </Link>
  );
}

function ActionCenterCard({
  href,
  label,
  count,
  description,
  tone = 'neutral',
}: {
  href: string;
  label: string;
  count: number;
  description: string;
  tone?: 'neutral' | 'priority';
}) {
  const highlighted = tone === 'priority' && count > 0;

  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-1 ${
        highlighted
          ? 'border-[var(--text-primary)] bg-[var(--bg-surface-alt)]'
          : 'border-[var(--border)] bg-[var(--bg-surface)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
        </div>
        <span className={`inline-flex min-w-8 items-center justify-center rounded-full px-2 py-1 text-xs font-semibold ${
          highlighted
            ? 'bg-[var(--text-primary)] text-[var(--bg-page)]'
            : 'bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]'
        }`}>
          {count}
        </span>
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open workspace <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </div>
    </Link>
  );
}

function AdvisoryCard({
  title,
  body,
  href,
  tone = 'neutral',
}: {
  title: string;
  body: string;
  href: string;
  tone?: 'neutral' | 'priority';
}) {
  const highlighted = tone === 'priority';

  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-1 ${
        highlighted
          ? 'border-[var(--text-primary)] bg-[var(--bg-surface-alt)]'
          : 'border-[var(--border)] bg-[var(--bg-surface)]'
      }`}
    >
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{body}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open workspace <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </div>
    </Link>
  );
}

function submissionHref(item: RecentSubmission): string {
  return `/resource-studio?entryId=${item.id}`;
}

export default function HostDashboardPageClient() {
  const [data, setData] = useState<HostDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/host/dashboard');
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load host dashboard');
      }
      setData((await res.json()) as HostDashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load host dashboard');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const actionCenter = data ? [
    {
      label: 'Pending reviews',
      count: data.summary.pendingReviews,
      href: '/resource-studio',
      description: 'Returned or newly submitted changes that are still waiting to clear verification.',
      tone: 'priority' as const,
    },
    {
      label: 'Stale services',
      count: data.summary.staleServices,
      href: '/services',
      description: 'Service records that have aged past the freshness threshold and should be rechecked.',
      tone: 'priority' as const,
    },
    {
      label: 'Stale locations',
      count: data.summary.staleLocations,
      href: '/locations',
      description: 'Site-level addresses or hours that may no longer reflect current operations.',
      tone: 'priority' as const,
    },
    {
      label: 'Incomplete org profile',
      count: data.summary.incompleteOrganizations,
      href: '/org/profile',
      description: 'Public trust fields still missing from the organization identity and verification record.',
      tone: 'neutral' as const,
    },
    {
      label: 'Pending invites',
      count: data.summary.pendingInvites,
      href: '/admins',
      description: 'Team access requests that are still waiting on acceptance or follow-up.',
      tone: 'neutral' as const,
    },
  ] : [];

  const workspaceNotes = data ? [
    data.summary.pendingReviews > 0
      ? `${data.summary.pendingReviews} change request${data.summary.pendingReviews === 1 ? '' : 's'} are still blocking publication or verification closure.`
      : 'No review backlog is currently blocking publication.',
    data.summary.staleServices + data.summary.staleLocations > 0
      ? `${data.summary.staleServices + data.summary.staleLocations} record${data.summary.staleServices + data.summary.staleLocations === 1 ? '' : 's'} have gone stale and should be refreshed before seekers rely on them.`
      : 'Service and location freshness is currently in a healthy range.',
    data.summary.incompleteOrganizations > 0
      ? 'Complete organization trust fields before inviting teams to publish or claim additional inventory.'
      : 'Organization trust fields are complete enough to support publication and team onboarding.',
  ] : [];
  const publicationAlerts = data ? [
    {
      title: data.summary.pendingReviews > 0 ? 'Review backlog is blocking publication' : 'Review backlog is clear',
      body: data.summary.pendingReviews > 0
        ? 'Pending review items can delay publication or leave corrections unshipped. Clear them before opening more work.'
        : 'No pending review items are blocking publication right now.',
      href: '/resource-studio',
      tone: data.summary.pendingReviews > 0 ? 'priority' as const : 'neutral' as const,
    },
    {
      title: data.summary.staleServices + data.summary.staleLocations > 0 ? 'Freshness recovery required' : 'Freshness is within range',
      body: data.summary.staleServices + data.summary.staleLocations > 0
        ? 'Stale services and locations should be refreshed before seekers depend on outdated availability or hours.'
        : 'No stale service or location records are currently overdue.',
      href: '/services',
      tone: data.summary.staleServices + data.summary.staleLocations > 0 ? 'priority' as const : 'neutral' as const,
    },
    {
      title: data.summary.pendingInvites > 0 ? 'Team access follow-up pending' : 'Team access is clean',
      body: data.summary.pendingInvites > 0
        ? 'Unaccepted invites can slow down shared maintenance and create ambiguity about who owns follow-up.'
        : 'No unresolved team invitations are blocking operations.',
      href: '/admins',
      tone: data.summary.pendingInvites > 0 ? 'priority' as const : 'neutral' as const,
    },
  ] : [];
  const auditReadiness = data ? [
    {
      title: 'Complete public trust fields',
      body: data.summary.incompleteOrganizations > 0
        ? `${data.summary.incompleteOrganizations} organization profile${data.summary.incompleteOrganizations === 1 ? '' : 's'} still need trust-critical details before publication should expand.`
        : 'Organization identity and trust fields are complete enough for publication.' ,
      href: '/org/profile',
    },
    {
      title: 'Resolve returned and pending review work',
      body: data.summary.pendingReviews > 0
        ? 'Pending review items should carry corrective action or reviewer-ready evidence before new submissions are opened.'
        : 'No review item currently requires corrective follow-up.',
      href: '/resource-studio',
    },
    {
      title: 'Keep service and location data fresh',
      body: data.summary.staleServices + data.summary.staleLocations > 0
        ? `${data.summary.staleServices + data.summary.staleLocations} record${data.summary.staleServices + data.summary.staleLocations === 1 ? '' : 's'} are stale and should be refreshed with source-backed edits.`
        : 'Freshness thresholds are currently being met across services and locations.',
      href: '/locations',
    },
  ] : [];

  return (
    <ErrorBoundary>
      <PageHeader
        eyebrow="Host workspace"
        title="Dashboard"
        icon={<LayoutDashboard className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="A single-page operational view of record freshness, pending review work, and workspace readiness."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Operational changes affect what seekers can trust</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Review backlog and stale records stay visible</PageHeaderBadge>
            <PageHeaderBadge>
              {data ? `${data.summary.pendingReviews} reviews pending` : 'Loading overview'}
            </PageHeaderBadge>
          </>
        )}
        actions={(
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void fetchDashboard()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        )}
      />

      {error && <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-6" />}

      {isLoading && !data ? (
        <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading dashboard data">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-xl" aria-hidden="true" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <Skeleton className="h-72 w-full rounded-xl lg:col-span-3" aria-hidden="true" />
            <Skeleton className="h-72 w-full rounded-xl lg:col-span-2" aria-hidden="true" />
          </div>
        </div>
      ) : data && (
        <>
          <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Organizations" value={data.summary.organizations} href="/org" icon={Building2} tone="border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]" />
            <MetricCard label="Services" value={data.summary.services} href="/services" icon={Wrench} tone="border-[var(--text-primary)] bg-[var(--text-primary)] text-white" />
            <MetricCard label="Locations" value={data.summary.locations} href="/locations" icon={MapPin} tone="border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]" />
            <MetricCard label="Team Members" value={data.summary.teamMembers} href="/admins" icon={Users} tone="border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]" />
            <MetricCard label="Claims In Flight" value={data.summary.claimsInFlight} href="/resource-studio?compose=claim" icon={Send} tone="border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]" />
          </section>

          <div className="grid gap-6 lg:grid-cols-5">
            <section className="lg:col-span-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)]">Operational Snapshot</h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">Review backlog, stale records, and profile completeness that need action.</p>
                </div>
                <ClipboardList className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: 'Pending reviews', value: data.summary.pendingReviews, note: 'Host-submitted changes awaiting verification.' },
                  { label: 'Incomplete organizations', value: data.summary.incompleteOrganizations, note: 'Profiles missing key public trust fields.' },
                  { label: 'Pending invites', value: data.summary.pendingInvites, note: 'Team members who still need to accept access.' },
                  { label: 'Stale services', value: data.summary.staleServices, note: 'Service records untouched for more than 90 days.' },
                  { label: 'Stale locations', value: data.summary.staleLocations, note: 'Location data that may need a freshness review.' },
                ].map(({ label, value, note }) => (
                  <div
                    key={label}
                    className={`rounded-lg border p-4 ${
                      value > 0 ? 'border-[var(--border)] bg-[var(--bg-surface-alt)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                    }`}
                  >
                    <p className={`text-xs font-medium uppercase tracking-wide ${
                      value > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    }`}>{label}</p>
                    <p className={`mt-1 text-2xl font-bold ${
                      value > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]'
                    }`}>{value}</p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">{note}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Recent in-flight host submissions</caption>
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-alt)]">
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Submission</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Organization</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Status</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Opened</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {data.recentSubmissions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">No active host submissions right now.</td>
                      </tr>
                    ) : data.recentSubmissions.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5 text-[var(--text-primary)]">
                          <Link href={submissionHref(item)} className="font-medium text-action-base hover:underline">
                            {item.title ?? item.submission_type.replace(/_/g, ' ')}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{item.organization_name ?? 'Pending organization'}</td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
                            {item.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                          {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="lg:col-span-2 space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)]">Action center</h2>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Direct routes into the exact work queues that can change seeker-visible accuracy, freshness, and trust.</p>
                <div className="mt-4 grid gap-3">
                  {actionCenter.map((item) => <ActionCenterCard key={item.label} {...item} />)}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <Siren className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)]">Publication alerts</h2>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">High-signal blockers that affect publication speed, freshness, or accountability.</p>
                <div className="mt-4 grid gap-3">
                  {publicationAlerts.map((item) => <AdvisoryCard key={item.title} {...item} />)}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)]">Quick actions</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  <QuickAction href="/resource-studio" label="Open resource studio" description="Start new listings, reopen drafts, and continue returned fixes through one workflow." icon={Layers3} />
                  <QuickAction href="/resource-studio?compose=listing" label="Start a listing" description="Launch the card-based listing workflow instead of opening a legacy modal." icon={Wrench} />
                  <QuickAction href="/locations" label="Refresh location details" description="Correct addresses, hours, and site details before they go stale." icon={MapPin} />
                  <QuickAction href="/admins" label="Manage team access" description="Invite members, promote admins, and clear pending invites." icon={Users} />
                  <QuickAction href="/resource-studio?compose=claim" label="Submit a claim" description="Start a new organization claim or continue one already in flight." icon={Send} />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <BellRing className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)]">Shift briefing</h2>
                </div>
                <ul className="mt-4 space-y-2">
                  {workspaceNotes.map((note) => (
                    <li
                      key={note}
                      className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] px-3 py-2.5 text-sm text-[var(--text-primary)]"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-alt)] px-3 py-3 text-sm text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    Workspace guide
                  </div>
                  <p className="mt-1 text-xs leading-5">
                    Use Resource Studio for listing and claim flow, Services and Locations for direct record maintenance, and Team for invitation recovery and access hygiene.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)]">Audit readiness</h2>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Checks that keep host-managed inventory defensible, source-backed, and review-ready.</p>
                <div className="mt-4 grid gap-3">
                  {auditReadiness.map((item) => (
                    <div key={item.title} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-4">
                      <div className="flex items-start gap-2">
                        <CheckSquare2 className="mt-0.5 h-4 w-4 shrink-0 text-action-base" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{item.body}</p>
                          <Link href={item.href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
                            Open workspace <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </ErrorBoundary>
  );
}
