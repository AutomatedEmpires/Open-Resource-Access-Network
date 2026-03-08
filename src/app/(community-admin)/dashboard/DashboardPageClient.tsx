/**
 * /dashboard — Community Admin Dashboard
 *
 * Landing page surfacing key metrics at a glance:
 *   – Pending / Under Review / Assigned to Me / SLA Breached / Approved
 * Plus quick-action cards and a recent-activity mini-table.
 * Data is fetched from two existing endpoints:
 *   GET /api/community/coverage  — summary stats + recent activity
 *   GET /api/community/queue?assignedToMe=true&limit=1 — "assigned to me" total
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  LayoutDashboard, Clock, UserCheck, AlertTriangle,
  CheckCircle2, TrendingUp, ArrowRight, ClipboardList,
  ShieldCheck, Globe2, RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { Skeleton } from '@/components/ui/skeleton';

// ============================================================
// TYPES
// ============================================================

interface CoverageSummary {
  submitted: number;
  underReview: number;
  approved: number;
  escalated: number;
  slaBreached: number;
}

interface ActivityDay {
  date: string;
  approved: number;
  denied: number;
  escalated: number;
}

interface DashboardData {
  summary: CoverageSummary;
  recentActivity: ActivityDay[];
  assignedToMeCount: number;
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function MetricCard({
  label,
  value,
  icon: Icon,
  iconBg,
  href,
  alert,
}: {
  label: string;
  value: number | null;
  icon: React.ElementType;
  iconBg: string;
  href?: string;
  alert?: boolean;
}) {
  const inner = (
    <div
      className={`relative bg-white rounded-xl border p-5 transition-shadow hover:shadow-md ${
        alert && (value ?? 0) > 0
          ? 'border-error-soft ring-1 ring-error-soft'
          : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 truncate">{label}</p>
          {value === null ? (
            <div className="mt-1 h-8 w-16 animate-pulse rounded-md bg-gray-100" />
          ) : (
            <p
              className={`mt-1 text-3xl font-bold ${
                alert && value > 0 ? 'text-error-deep' : 'text-gray-900'
              }`}
            >
              {value}
            </p>
          )}
        </div>
        <div className={`shrink-0 rounded-lg p-2.5 ${iconBg}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      {href && (
        <div className="mt-3 flex items-center gap-1 text-xs font-medium text-action-base">
          View in queue <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-action rounded-xl">
      {inner}
    </Link>
  ) : inner;
}

function QuickActionCard({
  href,
  icon: Icon,
  label,
  description,
  badge,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  description: string;
  badge?: number | null;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 hover:shadow-md hover:border-action-soft transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      <div className="shrink-0 rounded-lg bg-info-muted p-3 group-hover:bg-action-soft transition-colors">
        <Icon className="h-5 w-5 text-action-base" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{label}</p>
          {badge != null && badge > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-gray-300 shrink-0 self-center group-hover:text-action-base transition-colors" aria-hidden="true" />
    </Link>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function DashboardPageClient() {
  const { data: session } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [coverageRes, assignedRes] = await Promise.all([
        fetch('/api/community/coverage'),
        fetch('/api/community/queue?assignedToMe=true&limit=1'),
      ]);

      if (!coverageRes.ok) {
        const body = (await coverageRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load coverage data');
      }
      const coverage = (await coverageRes.json()) as {
        summary: CoverageSummary;
        recentActivity: ActivityDay[];
      };

      let assignedToMeCount = 0;
      if (assignedRes.ok) {
        const assigned = (await assignedRes.json()) as { total?: number };
        assignedToMeCount = assigned.total ?? 0;
      }

      setData({ ...coverage, assignedToMeCount });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';

  return (
    <ErrorBoundary>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-action-base" aria-hidden="true" />
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome back, <span className="font-medium text-gray-700">{firstName}</span>. Here&apos;s what needs your attention.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 shrink-0"
          onClick={() => void fetchData()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error && (
        <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-6" />
      )}

      {/* Key metrics */}
      <section aria-label="Key metrics" className="mb-8">
        {isLoading && !data ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <MetricCard
              label="Submitted"
              value={data?.summary.submitted ?? null}
              icon={Clock}
              iconBg="bg-amber-100 text-amber-600"
              href="/queue?status=submitted"
            />
            <MetricCard
              label="Under Review"
              value={data?.summary.underReview ?? null}
              icon={TrendingUp}
              iconBg="bg-info-muted text-action-base"
              href="/queue?status=under_review"
            />
            <MetricCard
              label="Assigned to Me"
              value={data?.assignedToMeCount ?? null}
              icon={UserCheck}
              iconBg="bg-green-100 text-green-600"
              href="/queue?status=__assigned_to_me__"
            />
            <MetricCard
              label="SLA Breached"
              value={data?.summary.slaBreached ?? null}
              icon={AlertTriangle}
              iconBg="bg-error-muted text-error-base"
              href="/coverage"
              alert
            />
            <MetricCard
              label="Approved"
              value={data?.summary.approved ?? null}
              icon={CheckCircle2}
              iconBg="bg-green-100 text-green-600"
              href="/queue?status=approved"
            />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Quick actions */}
        <section aria-label="Quick actions" className="lg:col-span-2 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Quick Actions</h2>
          <QuickActionCard
            href="/queue"
            icon={ClipboardList}
            label="Verification Queue"
            description="Triage and claim pending submissions"
            badge={data?.summary.submitted}
          />
          <QuickActionCard
            href="/queue?status=__assigned_to_me__"
            icon={ShieldCheck}
            label="Continue a Review"
            description="Continue a submission you've already claimed"
          />
          <QuickActionCard
            href="/coverage"
            icon={Globe2}
            label="My Coverage Zone"
            description="Stats, SLA health, and top organizations"
          />
        </section>

        {/* Recent activity */}
        <section aria-label="Recent activity" className="lg:col-span-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Recent Activity <span className="normal-case font-normal text-gray-400">(last 7 days)</span></h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {isLoading && !data ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !data || data.recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <TrendingUp className="h-8 w-8 text-gray-200 mb-2" aria-hidden="true" />
                <p className="text-sm text-gray-400">No decisions recorded in the last 30 days.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Recent verification decisions by day</caption>
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                    <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-green-600">Approved</th>
                    <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-error-base">Denied</th>
                    <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-purple-600">Escalated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.recentActivity.slice(0, 7).map((day) => (
                    <tr key={day.date} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-gray-700 text-xs">
                        {new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                        })}
                      </td>
                      {([
                        { val: day.approved,  bg: 'bg-green-100 text-green-800' },
                        { val: day.denied,    bg: 'bg-error-muted text-error-deep' },
                        { val: day.escalated, bg: 'bg-purple-100 text-purple-800' },
                      ] as const).map(({ val, bg }, idx) => (
                        <td key={idx} className="px-4 py-2.5 text-center">
                          {val > 0 ? (
                            <span className={`inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full text-xs font-medium ${bg}`}>
                              {val}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data && data.recentActivity.length > 7 && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                <Link href="/coverage" className="text-xs text-action-base hover:underline inline-flex items-center gap-1">
                  View all activity in Coverage <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </ErrorBoundary>
  );
}
