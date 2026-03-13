'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ClipboardList,
  LayoutDashboard,
  MapPin,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
  Wrench,
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
    <Link href={href} className="block rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`rounded-lg p-2.5 ${tone}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open workspace <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </div>
    </Link>
  );
}

function QuickAction({ href, label, description }: { href: string; label: string; description: string }) {
  return (
    <Link href={href} className="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md">
      <p className="text-sm font-semibold text-gray-900">{label}</p>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
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
            <MetricCard label="Organizations" value={data.summary.organizations} href="/org" icon={Building2} tone="bg-info-muted text-action-base" />
            <MetricCard label="Services" value={data.summary.services} href="/services" icon={Wrench} tone="bg-green-100 text-green-700" />
            <MetricCard label="Locations" value={data.summary.locations} href="/locations" icon={MapPin} tone="bg-amber-100 text-amber-700" />
            <MetricCard label="Team Members" value={data.summary.teamMembers} href="/admins" icon={Users} tone="bg-indigo-100 text-indigo-700" />
            <MetricCard label="Claims In Flight" value={data.summary.claimsInFlight} href="/resource-studio?compose=claim" icon={Send} tone="bg-purple-100 text-purple-700" />
          </section>

          <div className="grid gap-6 lg:grid-cols-5">
            <section className="lg:col-span-3 rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">Operational Snapshot</h2>
                  <p className="mt-1 text-sm text-gray-500">Review backlog, stale records, and profile completeness that need action.</p>
                </div>
                <ClipboardList className="h-5 w-5 text-gray-300" aria-hidden="true" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pending reviews</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{data.summary.pendingReviews}</p>
                  <p className="mt-1 text-xs text-gray-500">Host-submitted changes awaiting verification.</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Incomplete organizations</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{data.summary.incompleteOrganizations}</p>
                  <p className="mt-1 text-xs text-gray-500">Profiles missing key public trust fields.</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pending invites</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{data.summary.pendingInvites}</p>
                  <p className="mt-1 text-xs text-gray-500">Team members who still need to accept access.</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Stale services</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{data.summary.staleServices}</p>
                  <p className="mt-1 text-xs text-gray-500">Service records untouched for more than 90 days.</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Stale locations</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{data.summary.staleLocations}</p>
                  <p className="mt-1 text-xs text-gray-500">Location data that may need a freshness review.</p>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Recent in-flight host submissions</caption>
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Submission</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Organization</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500">Opened</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.recentSubmissions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No active host submissions right now.</td>
                      </tr>
                    ) : data.recentSubmissions.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5 text-gray-800">
                          <Link href={submissionHref(item)} className="font-medium text-action-base hover:underline">
                            {item.title ?? item.submission_type.replace(/_/g, ' ')}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500">{item.organization_name ?? 'Pending organization'}</td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center rounded-full bg-info-muted px-2.5 py-1 text-xs font-medium text-action-deep">
                            {item.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500">
                          {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="lg:col-span-2 space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">Quick actions</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  <QuickAction href="/resource-studio" label="Open resource studio" description="Start new listings, reopen drafts, and continue returned fixes through one workflow." />
                  <QuickAction href="/resource-studio?compose=listing" label="Start a listing" description="Launch the card-based listing workflow instead of opening a legacy modal." />
                  <QuickAction href="/locations" label="Refresh location details" description="Correct addresses, hours, and site details before they go stale." />
                  <QuickAction href="/admins" label="Manage team access" description="Invite members, promote admins, and clear pending invites." />
                  <QuickAction href="/resource-studio?compose=claim" label="Submit a claim" description="Start a new organization claim or continue one already in flight." />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">Priority cues</h2>
                </div>
                <ul className="mt-4 space-y-3 text-sm text-gray-600">
                  <li>{data.summary.pendingReviews > 0 ? `${data.summary.pendingReviews} host changes are waiting on review.` : 'No review backlog is currently blocking publication.'}</li>
                  <li>{data.summary.incompleteOrganizations > 0 ? `${data.summary.incompleteOrganizations} organization profiles still need core trust fields.` : 'Organization profiles include the expected core trust fields.'}</li>
                  <li>{data.summary.staleServices + data.summary.staleLocations > 0 ? `${data.summary.staleServices + data.summary.staleLocations} records have gone stale and should be revisited.` : 'Service and location freshness is in a healthy range.'}</li>
                </ul>
              </div>
            </section>
          </div>
        </>
      )}
    </ErrorBoundary>
  );
}
