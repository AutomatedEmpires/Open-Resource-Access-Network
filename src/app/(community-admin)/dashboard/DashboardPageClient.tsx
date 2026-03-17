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
  ShieldCheck, Globe2, RefreshCw, BellRing, BookOpen, CheckSquare2, Siren, FileCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

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

interface ZoneContext {
  id: string | null;
  name: string | null;
  description: string | null;
  states: string[];
  counties: string[];
  hasGeometry: boolean;
  hasExplicitScope: boolean;
}

interface DashboardData {
  summary: CoverageSummary;
  recentActivity: ActivityDay[];
  assignedToMeCount: number;
  zone: ZoneContext;
}

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
      className={`relative rounded-2xl border bg-[var(--bg-surface)] p-5 transition-shadow hover:shadow-md ${
        alert && (value ?? 0) > 0
          ? 'border-error-soft ring-1 ring-error-soft'
          : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
          {value === null ? (
            <div className="mt-1 h-8 w-16 animate-pulse rounded-md bg-[var(--bg-surface-alt)]" />
          ) : (
            <p
              className={`mt-1 text-3xl font-bold ${
                alert && value > 0 ? 'text-error-deep' : 'text-[var(--text-primary)]'
              }`}
            >
              {value}
            </p>
          )}
        </div>
        <div className={`relative shrink-0 rounded-xl border border-[var(--border)] p-2.5 ${iconBg}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
          {alert && (value ?? 0) > 0 && (
            <span
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"
              aria-hidden="true"
            />
          )}
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
    <Link href={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
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
      className="group flex items-start gap-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 transition-all hover:bg-[var(--bg-surface-alt)] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      <div className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3 transition-colors group-hover:bg-[var(--bg-surface)]">
        <Icon className="h-5 w-5 text-action-base" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
          {badge != null && badge > 0 && (
            <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-surface-alt)] px-2 py-0.5 text-xs font-medium text-[var(--text-primary)]">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 self-center text-[var(--text-muted)] transition-colors group-hover:text-action-base" aria-hidden="true" />
    </Link>
  );
}

function OperationsCard({
  href,
  label,
  description,
  count,
  tone = 'neutral',
}: {
  href: string;
  label: string;
  description: string;
  count: number;
  tone?: 'neutral' | 'critical';
}) {
  const critical = tone === 'critical' && count > 0;

  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-action ${
        critical
          ? 'border-error-soft bg-error-muted/40 text-error-deep'
          : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className={`mt-1 text-xs leading-5 ${critical ? 'text-error-base' : 'text-[var(--text-secondary)]'}`}>{description}</p>
        </div>
        <span className={`inline-flex min-w-8 items-center justify-center rounded-full px-2 py-1 text-xs font-semibold ${
          critical ? 'bg-white text-error-deep' : 'border border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
        }`}>
          {count}
        </span>
      </div>
      <div className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${critical ? 'text-error-deep' : 'text-action-base'}`}>
        Open queue <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </div>
    </Link>
  );
}

function InsightCard({
  title,
  body,
  href,
  tone = 'neutral',
}: {
  title: string;
  body: string;
  href: string;
  tone?: 'neutral' | 'warning';
}) {
  const warning = tone === 'warning';

  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-action ${
        warning
          ? 'border-amber-200 bg-amber-50/70'
          : 'border-[var(--border)] bg-[var(--bg-surface)]'
      }`}
    >
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{body}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
        Open <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </div>
    </Link>
  );
}

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
        zone: ZoneContext;
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

  const operationsQueue = data ? [
    {
      label: 'Escalations',
      count: data.summary.escalated,
      href: '/queue?status=escalated',
      description: 'Records that need policy judgment, dispute handling, or ORAN escalation.',
      tone: 'critical' as const,
    },
    {
      label: 'SLA breaches',
      count: data.summary.slaBreached,
      href: '/coverage',
      description: 'Items that have exceeded expected response windows and need immediate attention.',
      tone: 'critical' as const,
    },
    {
      label: 'Assigned to me',
      count: data.assignedToMeCount,
      href: '/queue?status=__assigned_to_me__',
      description: 'Reviews you already own and should finish before taking new work.',
      tone: 'neutral' as const,
    },
    {
      label: 'Submitted backlog',
      count: data.summary.submitted,
      href: '/queue?status=submitted',
      description: 'New submissions waiting to be claimed, routed, or sent into active review.',
      tone: 'neutral' as const,
    },
  ] : [];

  const shiftNotes = data ? [
    data.summary.escalated > 0
      ? `${data.summary.escalated} escalated record${data.summary.escalated === 1 ? '' : 's'} need senior attention before routine queue work.`
      : 'No escalations are currently blocking your review lane.',
    data.summary.slaBreached > 0
      ? `${data.summary.slaBreached} submission${data.summary.slaBreached === 1 ? '' : 's'} have crossed SLA and should be triaged first.`
      : 'SLA health is currently within target for your assigned zone.',
    data.zone.hasExplicitScope
      ? `Coverage is scoped to ${data.zone.name ?? 'your assigned community area'}, so queue decisions should stay inside that review boundary.`
      : 'Scope fallback is active. Confirm zone ownership when a record appears ambiguous or cross-jurisdictional.',
  ] : [];

  const alertCenter = data ? [
    {
      title: data.summary.escalated > 0 ? 'Escalations waiting for judgment' : 'Escalation lane is clear',
      body: data.summary.escalated > 0
        ? 'Escalated records are still open. Resolve these before routine verification because they carry the highest trust and policy risk.'
        : 'No escalated records are currently holding the line. Continue with SLA and assigned queue work.',
      href: '/queue?status=escalated',
      tone: data.summary.escalated > 0 ? 'warning' as const : 'neutral' as const,
    },
    {
      title: data.summary.slaBreached > 0 ? 'SLA recovery required' : 'SLA is within target',
      body: data.summary.slaBreached > 0
        ? 'Breached submissions need same-shift action and a documented reason if they remain unresolved.'
        : 'No review item has exceeded the expected response window.',
      href: '/coverage',
      tone: data.summary.slaBreached > 0 ? 'warning' as const : 'neutral' as const,
    },
    {
      title: data.zone.hasExplicitScope ? 'Zone boundary verified' : 'Scope fallback active',
      body: data.zone.hasExplicitScope
        ? 'Coverage assignments and queue routing are grounded in an explicit zone boundary.'
        : 'Explicit geographic scope is missing. Double-check jurisdiction before approving or escalating ambiguous records.',
      href: '/coverage',
      tone: data.zone.hasExplicitScope ? 'neutral' as const : 'warning' as const,
    },
  ] : [];

  const auditChecklist = data ? [
    {
      title: 'Document review evidence',
      body: 'Every approval, denial, or escalation should be tied to stored record evidence and reviewer notes.',
      href: '/verify',
    },
    {
      title: 'Confirm scope before decision',
      body: data.zone.hasExplicitScope
        ? 'Stay inside the assigned zone unless the case is formally escalated.'
        : 'Fallback mode is active, so zone ownership must be confirmed before final action.',
      href: '/coverage',
    },
    {
      title: 'Close claimed work before taking more',
      body: data.assignedToMeCount > 0
        ? `${data.assignedToMeCount} claimed review${data.assignedToMeCount === 1 ? '' : 's'} are still open and should be closed or escalated with notes.`
        : 'No personally assigned work is blocking additional queue claims.',
      href: '/queue?status=__assigned_to_me__',
    },
  ] : [];

  return (
    <ErrorBoundary>
      <PageHeader
        eyebrow="Community Admin"
        title="Dashboard"
        icon={<LayoutDashboard className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle={(
          <>
            Welcome back, <span className="font-medium text-[var(--text-primary)]">{firstName}</span>. Here&apos;s what needs your attention.
          </>
        )}
        badges={(
          <>
            <PageHeaderBadge tone="trust">Zone decisions affect verified inventory</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Assignment and SLA cues stay visible</PageHeaderBadge>
            <PageHeaderBadge>
              {data?.zone.name ?? (data?.zone.hasExplicitScope ? 'Assigned community scope' : 'Fallback review scope')}
            </PageHeaderBadge>
          </>
        )}
        actions={(
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
        )}
        className="mb-8"
      />

      {error && (
        <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-6" />
      )}

      {data && (
        <section className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Assigned scope</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{data.zone.name ?? 'Community review coverage'}</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {data.zone.description
                  ?? (data.zone.hasExplicitScope
                    ? 'Your dashboard cards, queue entry points, and review links follow your assigned community coverage rules.'
                    : 'A specific zone assignment is not on file yet, so the dashboard is emphasizing your active workload and assignments.')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-full xl:max-w-xl">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Assigned to me</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{data.assignedToMeCount}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">States</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{data.zone.states.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Counties</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{data.zone.counties.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Boundary</p>
                <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{data.zone.hasGeometry ? 'On file' : 'Pending'}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      <section aria-label="Key metrics" className="mb-8">
        {isLoading && !data ? (
          <div role="status" className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <MetricCard
              label="Submitted"
              value={data?.summary.submitted ?? null}
              icon={Clock}
              iconBg="bg-[var(--bg-surface-alt)] text-[var(--text-primary)]"
              href="/queue?status=submitted"
            />
            <MetricCard
              label="Under Review"
              value={data?.summary.underReview ?? null}
              icon={TrendingUp}
              iconBg="bg-[var(--bg-surface-alt)] text-action-base"
              href="/queue?status=under_review"
            />
            <MetricCard
              label="Assigned to Me"
              value={data?.assignedToMeCount ?? null}
              icon={UserCheck}
              iconBg="bg-[var(--text-primary)] text-[var(--bg-page)]"
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
              label="Escalated"
              value={data?.summary.escalated ?? null}
              icon={CheckCircle2}
              iconBg="bg-[var(--bg-surface-alt)] text-[var(--text-primary)]"
              href="/queue?status=escalated"
            />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <section aria-label="Operations queue" className="space-y-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Operations Queue</h2>
              <p className="mt-1 text-sm text-gray-500">Audit-ready routing for the work that can most directly affect trust, timeliness, and coverage quality.</p>
            </div>
            {isLoading && !data ? (
              <div role="status" className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full rounded-xl" />
                ))}
              </div>
            ) : (
              operationsQueue.map((item) => <OperationsCard key={item.label} {...item} />)
            )}
          </section>

          <section aria-label="Quick actions" className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Quick Actions</h2>
            <QuickActionCard
              href="/queue"
              icon={ClipboardList}
              label="Review Queue"
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
              href="/queue?status=escalated"
              icon={AlertTriangle}
              label="Handle Escalations"
              description="Jump straight into the highest-risk records first"
              badge={data?.summary.escalated}
            />
            <QuickActionCard
              href="/coverage"
              icon={Globe2}
              label="My Coverage Zone"
              description="Stats, SLA health, and top organizations"
            />
          </section>

          <section aria-label="Notifications and guidance" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-action-base" aria-hidden="true" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Shift Briefing</h2>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {shiftNotes.map((note) => (
                <li key={note} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                  {note}
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-700">
              <div className="flex items-center gap-2 font-medium text-gray-900">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Reviewer playbook
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                Use coverage for SLA monitoring, queue for claim-and-review execution, and verify when a case needs a dedicated workspace handoff.
              </p>
            </div>
          </section>
        </div>

        <div className="space-y-6 lg:col-span-3">
          <section aria-label="Alert center" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Siren className="h-4 w-4 text-action-base" aria-hidden="true" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Alert Center</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">Operational alerts that can change trust, timeliness, or jurisdictional correctness.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {alertCenter.map((item) => <InsightCard key={item.title} {...item} />)}
            </div>
          </section>

          <section aria-label="Audit readiness" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-action-base" aria-hidden="true" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Audit Readiness</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">Decision hygiene checks to keep verification work repeatable, reviewable, and defensible.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {auditChecklist.map((item) => (
                <div key={item.title} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-start gap-2">
                    <CheckSquare2 className="mt-0.5 h-4 w-4 shrink-0 text-action-base" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="mt-1 text-xs leading-5 text-gray-600">{item.body}</p>
                      <Link href={item.href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-action-base">
                        Open workspace <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section aria-label="Recent activity">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Recent Activity <span className="normal-case font-normal text-gray-400">(last 7 days)</span></h2>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              {isLoading && !data ? (
                <div role="status" className="space-y-3 p-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : !data || data.recentActivity.length === 0 ? (
                <div role="status" className="flex flex-col items-center justify-center px-6 py-12 text-center">
                  <TrendingUp className="mb-2 h-8 w-8 text-gray-200" aria-hidden="true" />
                  <p className="text-sm text-gray-400">No decisions recorded in the last 7 days.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
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
                        <tr key={day.date} className="transition-colors hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-xs text-gray-700">
                            {new Date(`${day.date}T00:00:00`).toLocaleDateString('en-US', {
                              weekday: 'short', month: 'short', day: 'numeric',
                            })}
                          </td>
                          {([
                            { val: day.approved, bg: 'bg-green-100 text-green-800' },
                            { val: day.denied, bg: 'bg-error-muted text-error-deep' },
                            { val: day.escalated, bg: 'bg-purple-100 text-purple-800' },
                          ] as const).map(({ val, bg }, idx) => (
                            <td key={idx} className="px-4 py-2.5 text-center">
                              {val > 0 ? (
                                <span className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-xs font-medium ${bg}`}>
                                  {val}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-300">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
