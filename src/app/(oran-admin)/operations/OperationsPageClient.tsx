'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, BriefcaseBusiness, FileWarning, RefreshCw, ShieldCheck, Users, Workflow } from 'lucide-react';

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
    <Link href={href} className="block rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 transition-shadow hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-3xl font-bold text-[var(--text-primary)]">{value}</p>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>open</span>
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open workspace <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
    </Link>
  );
}

function LaneCard({
  href,
  label,
  description,
  count,
}: {
  href: string;
  label: string;
  description: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-4 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
        </div>
        <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs font-semibold text-[var(--text-primary)]">
          {count} open
        </span>
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open lane <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
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

  const controlDeck = data ? [
    {
      label: 'Trust and safety',
      description: data.summary.high_risk_reports_open > 0
        ? `${data.summary.high_risk_reports_open} high-risk report${data.summary.high_risk_reports_open === 1 ? '' : 's'} may need immediate listing holds.`
        : 'No high-risk report is currently blocking operator flow.',
      href: '/reports',
    },
    {
      label: 'Governance approvals',
      description: data.summary.approvals_pending + data.summary.scopes_pending > 0
        ? `${data.summary.approvals_pending + data.summary.scopes_pending} approval and scope decision${data.summary.approvals_pending + data.summary.scopes_pending === 1 ? '' : 's'} still need action.`
        : 'Approval and scope decision queues are currently clear.',
      href: '/approvals',
    },
    {
      label: 'Platform integrity',
      description: data.summary.integrity_held_services > 0
        ? `${data.summary.integrity_held_services} service${data.summary.integrity_held_services === 1 ? '' : 's'} remain withheld from trusted seeker visibility.`
        : 'No services are currently held out of trusted discovery.',
      href: '/admin-security',
    },
  ] : [];

  const operatorLanes = data ? [
    {
      label: 'Trust and safety report review',
      description: 'Resolve report investigations, policy decisions, and seeker-impacting trust cases.',
      href: '/reports',
      count: data.summary.reports_open,
    },
    {
      label: 'Submission approvals',
      description: 'Close approval decisions that are still preventing workflow completion.',
      href: '/approvals',
      count: data.summary.approvals_pending,
    },
    {
      label: 'Scope grant governance',
      description: 'Review sensitive scope changes and confirm least-privilege access intent.',
      href: '/scopes',
      count: data.summary.scopes_pending,
    },
    {
      label: 'Queue triage',
      description: 'Route escalations and review bottlenecks before they spread across the portal.',
      href: '/triage',
      count: data.summary.appeals_open + data.summary.high_risk_reports_open,
    },
  ] : [];

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
            <MetricCard href="/appeals" label="Open appeals" value={data.summary.appeals_open} tone="border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]" />
            <MetricCard href="/reports" label="Open reports" value={data.summary.reports_open} tone="border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]" />
            <MetricCard href="/reports" label="High-risk reports" value={data.summary.high_risk_reports_open} tone="bg-error-subtle text-error-deep" />
            <MetricCard href="/scopes" label="Pending scope grants" value={data.summary.scopes_pending} tone="border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)]" />
            <MetricCard href="/admin-security" label="Integrity-held services" value={data.summary.integrity_held_services} tone="border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]" />
          </section>

          <section className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">Control center</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">The three platform-wide lanes that should be checked before moving into lower-priority work.</p>
              </div>
              <Workflow className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {controlDeck.map((item) => (
                <Link key={item.label} href={item.href} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-4 transition-shadow hover:shadow-md">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{item.description}</p>
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
                    Open lane <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-5">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 lg:col-span-3">
              <div className="flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-action-base" aria-hidden="true" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">Recent operator activity</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Use the last touched items to resume work without hopping through every operator queue.</p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-alt)]">
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Workflow</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {data.recentActivity.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5">
                          <Link href={activityHref(item)} className="font-medium text-action-base hover:underline">
                            {item.title ?? item.submission_type.replace(/_/g, ' ')}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{item.status.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2.5 text-[var(--text-muted)]">{new Date(item.updated_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-4 lg:col-span-2">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-error-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">Priority cues</h2>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">High-signal conditions that can change platform trust, visibility, or operator access.</p>
                <ul className="mt-4 space-y-2 text-sm text-[var(--text-secondary)]">
                  <li className="rounded-xl bg-error-subtle px-3 py-2">{data.summary.high_risk_reports_open} suspected-fraud reports are open and may require immediate listing holds.</li>
                  <li className="rounded-xl bg-[var(--bg-surface-alt)] px-3 py-2">{data.summary.approvals_pending} approval items still need operator decisions before workflow closes.</li>
                  <li className="rounded-xl bg-[var(--bg-surface-alt)] px-3 py-2">{data.summary.integrity_held_services} services are currently withheld from trusted seeker visibility.</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">Operator lanes</h2>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Each lane maps to a discrete operator responsibility instead of an undifferentiated list of admin tools.</p>
                <div className="mt-4 grid gap-3 text-sm">
                  {operatorLanes.map((lane) => <LaneCard key={lane.label} {...lane} />)}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-action-base" aria-hidden="true" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">System watch</h2>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Follow the areas most likely to change downstream discovery quality or operator safety.</p>
                <div className="mt-4 grid gap-3 text-sm">
                  <Link href="/admin-security" className="rounded-xl border border-[var(--border)] px-3 py-3 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]">Privileged account controls and integrity holds</Link>
                  <Link href="/ingestion" className="rounded-xl border border-[var(--border)] px-3 py-3 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]">Ingestion oversight, replay state, and source readiness</Link>
                  <Link href="/discovery-preview" className="rounded-xl border border-[var(--border)] px-3 py-3 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]">Discovery preview before platform-facing changes propagate</Link>
                </div>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </ErrorBoundary>
  );
}
