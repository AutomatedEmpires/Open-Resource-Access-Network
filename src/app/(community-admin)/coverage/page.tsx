/**
 * /coverage — My Coverage Zone
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
  Globe2, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  XCircle, ArrowUpCircle, Building2, TrendingUp, AlarmClock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Skeleton } from '@/components/ui/skeleton';

// ============================================================
// TYPES
// ============================================================

interface CoverageSummary {
  pending: number;
  inReview: number;
  verified: number;
  rejected: number;
  escalated: number;
  total: number;
  stale: number;
}

interface ActivityDay {
  date: string;
  verified: number;
  rejected: number;
  escalated: number;
}

interface TopOrg {
  organization_id: string;
  organization_name: string;
  pending_count: number;
}

interface CoverageData {
  summary: CoverageSummary;
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
            <Globe2 className="h-6 w-6 text-blue-600" aria-hidden="true" />
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
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 mb-4 text-sm text-red-700" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
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
              label="Pending"
              value={data.summary.pending}
              icon={Clock}
              color="bg-amber-100 text-amber-600"
              href="/queue?status=pending"
            />
            <StatCard
              label="In Review"
              value={data.summary.inReview}
              icon={TrendingUp}
              color="bg-blue-100 text-blue-600"
              href="/queue?status=in_review"
            />
            <StatCard
              label="Verified"
              value={data.summary.verified}
              icon={CheckCircle2}
              color="bg-green-100 text-green-600"
              href="/queue?status=verified"
            />
            <StatCard
              label="Escalated"
              value={data.summary.escalated}
              icon={ArrowUpCircle}
              color="bg-purple-100 text-purple-600"
              href="/queue?status=escalated"
            />
          </div>

          {/* Second row: total + stale */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
            <StatCard
              label="Total Entries"
              value={data.summary.total}
              icon={Globe2}
              color="bg-gray-100 text-gray-600"
            />
            <StatCard
              label="Rejected"
              value={data.summary.rejected}
              icon={XCircle}
              color="bg-red-100 text-red-600"
              href="/queue?status=rejected"
            />
            <StatCard
              label="Stale (>14 days)"
              value={data.summary.stale}
              icon={AlarmClock}
              color={data.summary.stale > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}
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
                        <th scope="col" className="text-center py-2 text-xs font-medium text-green-600">Verified</th>
                        <th scope="col" className="text-center py-2 text-xs font-medium text-red-600">Rejected</th>
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
                            {day.verified > 0 ? (
                              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-green-100 text-green-800 text-xs font-medium">
                                {day.verified}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-2 text-center">
                            {day.rejected > 0 ? (
                              <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-red-100 text-red-800 text-xs font-medium">
                                {day.rejected}
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
