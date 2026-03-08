/**
 * /coverage — My Coverage Zone
 *
 * Enhanced with FormAlert for error display.
 *
 * Dashboard showing verification stats, recent activity, and
 * organization breakdown for the community admin's zone.
 * Wired to GET /api/community/coverage.
 *
 * Note: coverage_zones table does not exist yet (see AGENT_PROMPT_SQL.md).
 * When it ships, this page will show zone boundary + per-zone filters.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Globe2, RefreshCw, CheckCircle2, Clock,
  XCircle, ArrowUpCircle, Building2, TrendingUp, AlarmClock,
  RotateCcw, MinusCircle, FileStack, ShieldAlert,
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
  pendingSecondApproval: number;
  approved: number;
  denied: number;
  escalated: number;
  returned: number;
  withdrawn: number;
  total: number;
  stale: number;
  slaBreached: number;
}

interface ActivityDay {
  date: string;
  approved: number;
  denied: number;
  escalated: number;
}

interface TopOrg {
  organization_id: string;
  organization_name: string;
  pending_count: number;
}

interface CoverageData {
  summary: CoverageSummary;
  byType: Record<string, number>;
  recentActivity: ActivityDay[];
  topOrganizations: TopOrg[];
}

// ============================================================
// STAT CARD
// ============================================================

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  href,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  href?: string;
}) {
  const content = (
    <div className={`bg-white rounded-lg border border-gray-200 p-5 hover:shadow-sm transition-shadow ${href ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`rounded-lg p-3 ${color}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

// ============================================================
// COMPONENT
// ============================================================

export default function CommunityAdminCoveragePage() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoverage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/community/coverage');
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load coverage data');
      }
      const json = (await res.json()) as CoverageData;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load coverage data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCoverage();
  }, [fetchCoverage]);

  return (
    <ErrorBoundary>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Globe2 className="h-6 w-6 text-action-base" aria-hidden="true" />
            My Coverage Zone
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Verification metrics and activity overview for your zone.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => void fetchCoverage()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <FormAlert variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      {/* Loading state */}
      {isLoading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && (
        <>
          {/* Summary stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Submitted"
              value={data.summary.submitted}
              icon={Clock}
              color="bg-amber-100 text-amber-600"
              href="/queue?status=submitted"
            />
            <StatCard
              label="Under Review"
              value={data.summary.underReview}
              icon={TrendingUp}
              color="bg-info-muted text-action-base"
              href="/queue?status=under_review"
            />
            <StatCard
              label="Approved"
              value={data.summary.approved}
              icon={CheckCircle2}
              color="bg-green-100 text-green-600"
              href="/queue?status=approved"
            />
            <StatCard
              label="Escalated"
              value={data.summary.escalated}
              icon={ArrowUpCircle}
              color="bg-purple-100 text-purple-600"
              href="/queue?status=escalated"
            />
          </div>

          {/* Second row: total + stale + sla + denied */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Total Entries"
              value={data.summary.total}
              icon={Globe2}
              color="bg-gray-100 text-gray-600"
              href="/queue"
            />
            <StatCard
              label="Denied"
              value={data.summary.denied}
              icon={XCircle}
              color="bg-error-muted text-error-base"
              href="/queue?status=denied"
            />
            <StatCard
              label="Stale (>14 days)"
              value={data.summary.stale}
              icon={AlarmClock}
              color={data.summary.stale > 0 ? 'bg-error-muted text-error-base' : 'bg-gray-100 text-gray-400'}
            />
            <StatCard
              label="SLA Breached"
              value={data.summary.slaBreached}
              icon={ShieldAlert}
              color={data.summary.slaBreached > 0 ? 'bg-error-muted text-error-deep' : 'bg-gray-100 text-gray-400'}
            />
          </div>

          {/* Third row: in-flight pipeline statuses */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            <StatCard
              label="Pending 2nd Approval"
              value={data.summary.pendingSecondApproval}
              icon={ArrowUpCircle}
              color="bg-indigo-100 text-indigo-600"
              href="/queue?status=pending_second_approval"
            />
            <StatCard
              label="Returned"
              value={data.summary.returned}
              icon={RotateCcw}
              color="bg-amber-100 text-amber-600"
              href="/queue?status=returned"
            />
            <StatCard
              label="Withdrawn"
              value={data.summary.withdrawn}
              icon={MinusCircle}
              color="bg-gray-100 text-gray-500"
              href="/queue?status=withdrawn"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent activity */}
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" aria-hidden="true" />
                Recent Activity (30 days)
              </h2>
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No recent decisions recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Recent verification activity by day with verified, rejected, and escalated totals.</caption>
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th scope="col" className="text-left py-2 text-xs font-medium text-gray-500">Date</th>
                        <th scope="col" className="text-center py-2 text-xs font-medium text-green-600">Approved</th>
                        <th scope="col" className="text-center py-2 text-xs font-medium text-error-base">Denied</th>
                        <th scope="col" className="text-center py-2 text-xs font-medium text-purple-600">Escalated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.recentActivity.map((day) => (
                        <tr key={day.date}>
                          <td className="py-2 text-gray-700">
                            {new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric',
                            })}
                          </td>
                          <td className="py-2 text-center">
                            {day.approved > 0 ? (
                              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-green-100 text-green-800 text-xs font-medium">
                                {day.approved}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-2 text-center">
                            {day.denied > 0 ? (
                              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-error-muted text-error-deep text-xs font-medium">
                                {day.denied}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-2 text-center">
                            {day.escalated > 0 ? (
                              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-purple-100 text-purple-800 text-xs font-medium">
                                {day.escalated}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Top orgs needing review */}
            <section className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Building2 className="h-4 w-4" aria-hidden="true" />
                Organizations Needing Review
              </h2>
              {data.topOrganizations.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">All caught up — no pending reviews.</p>
              ) : (
                <div className="space-y-3">
                  {data.topOrganizations.map((org) => (
                    <div
                      key={org.organization_id}
                      className="flex items-center justify-between border border-gray-100 rounded-md p-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
                        <span className="text-sm text-gray-800 truncate">{org.organization_name}</span>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-medium shrink-0 ml-2">
                        {org.pending_count} pending
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Submission Types breakdown */}
          {data.byType && Object.keys(data.byType).length > 0 && (
            <section className="bg-white rounded-lg border border-gray-200 p-5 mt-6">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <FileStack className="h-4 w-4" aria-hidden="true" />
                Submission Types
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {Object.entries(data.byType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => {
                    const pct = data.summary.total > 0 ? Math.round((count / data.summary.total) * 100) : 0;
                    const label = type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                    return (
                      <div key={type} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs font-medium text-gray-500 truncate" title={label}>{label}</p>
                        <p className="mt-1 text-2xl font-bold text-gray-900">{count}</p>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
                          <div
                            className="h-1.5 rounded-full bg-action-base transition-all"
                            style={{ width: `${pct}%` }}
                            aria-label={`${pct}% of total`}
                          />
                        </div>
                        <p className="mt-1 text-xs text-gray-400">{pct}% of total</p>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          {/* Coverage zone placeholder */}
          <section className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center mt-6">
            <Globe2 className="h-10 w-10 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="text-gray-500 font-medium">Coverage Zone Map</p>
            <p className="text-sm text-gray-400 mt-1">
              Zone boundary visualization will be available once coverage zone management is enabled.
            </p>
          </section>
        </>
      )}
    </ErrorBoundary>
  );
}
