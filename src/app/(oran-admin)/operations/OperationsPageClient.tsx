'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, BriefcaseBusiness, FileWarning, RefreshCw, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

interface SummaryRow {
  approvals_pending: number;
  appeals_open: number;
  reports_open: number;
  high_risk_reports_open: number;
  scopes_pending: number;
  integrity_held_services: number;
}

interface ActivityRow {
  id: string;
  submission_type: string;
  status: string;
  title: string | null;
  updated_at: string;
}

interface OperationsResponse {
  summary: SummaryRow;
  recentActivity: ActivityRow[];
}

function MetricCard({ href, label, value, tone }: { href: string; label: string; value: number; tone: string }) {
  return (
    <Link href={href} className="block rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-3xl font-bold text-gray-900">{value}</p>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>open</span>
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open workspace <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
    </Link>
  );
}

function activityHref(item: ActivityRow): string {
  switch (item.submission_type) {
    case 'appeal':
      return '/appeals';
    case 'community_report':
      return '/reports';
    default:
      return '/approvals';
  }
}

export default function OperationsPageClient() {
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/operations/summary');
      const body = (await res.json().catch(() => null)) as OperationsResponse & { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? 'Failed to load ORAN operations summary');
      }
      setData(body as OperationsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ORAN operations summary');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  return (
    <ErrorBoundary>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Operations"
        icon={<BriefcaseBusiness className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="One operator home for governance backlog, trust-and-safety decisions, pending approvals, and account controls."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Portal-wide operator work stays visible in one place</PageHeaderBadge>
            <PageHeaderBadge tone="accent">High-risk report load is called out separately</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.summary.integrity_held_services} integrity holds active` : 'Loading operations'}</PageHeaderBadge>
          </>
        )}
        actions={(
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void fetchSummary()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        )}
        className="mb-8"
      />

      {error && <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-6" />}

      {isLoading && !data ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : data ? (
        <>
          <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard href="/approvals" label="Pending approvals" value={data.summary.approvals_pending} tone="bg-slate-100 text-slate-700" />
            <MetricCard href="/appeals" label="Open appeals" value={data.summary.appeals_open} tone="bg-sky-100 text-sky-800" />
            <MetricCard href="/reports" label="Open reports" value={data.summary.reports_open} tone="bg-amber-100 text-amber-900" />
            <MetricCard href="/reports" label="High-risk reports" value={data.summary.high_risk_reports_open} tone="bg-rose-100 text-rose-800" />
            <MetricCard href="/scopes" label="Pending scope grants" value={data.summary.scopes_pending} tone="bg-indigo-100 text-indigo-800" />
            <MetricCard href="/admin-security" label="Integrity-held services" value={data.summary.integrity_held_services} tone="bg-emerald-100 text-emerald-800" />
          </section>

          <div className="grid gap-6 lg:grid-cols-5">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-3">
              <div className="flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-action-base" aria-hidden="true" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Recent operator activity</h2>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Workflow</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.recentActivity.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5">
                          <Link href={activityHref(item)} className="font-medium text-action-base hover:underline">
                            {item.title ?? item.submission_type.replace(/_/g, ' ')}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{item.status.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2.5 text-gray-500">{new Date(item.updated_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-4 lg:col-span-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Priority cues</h2>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-gray-700">
                  <li className="rounded-xl bg-amber-50 px-3 py-2">{data.summary.high_risk_reports_open} suspected-fraud reports are open and may require immediate listing holds.</li>
                  <li className="rounded-xl bg-slate-50 px-3 py-2">{data.summary.approvals_pending} approval items still need operator decisions before workflow closes.</li>
                  <li className="rounded-xl bg-emerald-50 px-3 py-2">{data.summary.integrity_held_services} services are currently withheld from trusted seeker visibility.</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Operator lanes</h2>
                </div>
                <div className="mt-4 grid gap-3 text-sm">
                  <Link href="/reports" className="rounded-xl border border-gray-200 px-3 py-3 hover:bg-slate-50">Trust and safety report review</Link>
                  <Link href="/admin-security" className="rounded-xl border border-gray-200 px-3 py-3 hover:bg-slate-50">Privileged account controls</Link>
                  <Link href="/approvals" className="rounded-xl border border-gray-200 px-3 py-3 hover:bg-slate-50">Submission approvals</Link>
                  <Link href="/scopes" className="rounded-xl border border-gray-200 px-3 py-3 hover:bg-slate-50">Scope grant governance</Link>
                  <Link href="/ingestion" className="rounded-xl border border-gray-200 px-3 py-3 hover:bg-slate-50">Ingestion oversight</Link>
                  <Link href="/triage" className="rounded-xl border border-gray-200 px-3 py-3 hover:bg-slate-50">Queue triage</Link>
                </div>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </ErrorBoundary>
  );
}
