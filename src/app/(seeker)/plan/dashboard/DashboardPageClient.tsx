'use client';

import Link from 'next/link';
import React, { startTransition, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BellRing, Bookmark, CalendarClock, CheckCircle2, LayoutDashboard, ListTodo } from 'lucide-react';

import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import type { EnrichedService } from '@/domain/types';
import { readStoredSeekerProfile, SEEKER_PROFILE_UPDATED_EVENT } from '@/services/profile/clientContext';
import { readStoredProfilePreferences, PROFILE_PREFERENCES_UPDATED_EVENT } from '@/services/profile/syncPreference';
import { readStoredSavedServiceCount, SAVED_SERVICES_UPDATED_EVENT } from '@/services/saved/client';
import { readStoredSeekerPlansState, SEEKER_PLANS_UPDATED_EVENT } from '@/services/plans/client';
import { buildSeekerExecutionDashboardSummary } from '@/services/plans/dashboard';
import { buildSeekerPlanFeasibilitySignals } from '@/services/plans/feasibility';
import { buildSeekerExecutionProgressSummary } from '@/services/plans/progress';
import { buildSeekerExecutionRecommendations } from '@/services/plans/recommendations';
import { buildSeekerGroundedPlanBrief } from '@/services/plans/summary';
import { getLinkedServiceExecutionWarnings } from '@/services/plans/snapshotTrust';

interface BatchServiceResponse {
  results: EnrichedService[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function fetchServicesByIds(ids: string[]): Promise<EnrichedService[]> {
  if (ids.length === 0) {
    return [];
  }

  const params = new URLSearchParams({ ids: ids.join(',') });
  const res = await fetch(`/api/services?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error('Failed to load current service records');
  }

  const json = (await res.json()) as BatchServiceResponse;
  return json.results;
}

function formatReminder(value?: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export default function DashboardPageClient({
  routeFeasibilityEnabled = false,
}: {
  routeFeasibilityEnabled?: boolean;
}) {
  const [plansState, setPlansState] = useState(() => readStoredSeekerPlansState());
  const [savedCount, setSavedCount] = useState(() => readStoredSavedServiceCount());
  const [profile, setProfile] = useState(() => readStoredSeekerProfile());
  const [preferences, setPreferences] = useState(() => readStoredProfilePreferences());
  const [feasibilityServices, setFeasibilityServices] = useState<EnrichedService[]>([]);
  const [isLoadingFeasibility, setIsLoadingFeasibility] = useState(false);
  const [feasibilityError, setFeasibilityError] = useState<string | null>(null);

  useEffect(() => {
    const syncPlans = () => setPlansState(readStoredSeekerPlansState());
    const syncSaved = () => setSavedCount(readStoredSavedServiceCount());
    const syncProfile = () => setProfile(readStoredSeekerProfile());
    const syncPreferences = () => setPreferences(readStoredProfilePreferences());

    window.addEventListener(SEEKER_PLANS_UPDATED_EVENT, syncPlans as EventListener);
    window.addEventListener(SAVED_SERVICES_UPDATED_EVENT, syncSaved as EventListener);
    window.addEventListener(SEEKER_PROFILE_UPDATED_EVENT, syncProfile as EventListener);
    window.addEventListener(PROFILE_PREFERENCES_UPDATED_EVENT, syncPreferences as EventListener);
    window.addEventListener('storage', syncPlans);
    window.addEventListener('storage', syncSaved);
    window.addEventListener('storage', syncProfile);
    window.addEventListener('storage', syncPreferences);

    return () => {
      window.removeEventListener(SEEKER_PLANS_UPDATED_EVENT, syncPlans as EventListener);
      window.removeEventListener(SAVED_SERVICES_UPDATED_EVENT, syncSaved as EventListener);
      window.removeEventListener(SEEKER_PROFILE_UPDATED_EVENT, syncProfile as EventListener);
      window.removeEventListener(PROFILE_PREFERENCES_UPDATED_EVENT, syncPreferences as EventListener);
      window.removeEventListener('storage', syncPlans);
      window.removeEventListener('storage', syncSaved);
      window.removeEventListener('storage', syncProfile);
      window.removeEventListener('storage', syncPreferences);
    };
  }, []);

  const summary = useMemo(() => buildSeekerExecutionDashboardSummary(plansState), [plansState]);
  const cityLabel = preferences.approximateCity?.trim();
  const profileHeadline = profile.profileHeadline?.trim();
  const activeLinkedServiceIds = useMemo(() => {
    const ids = (summary.activePlan?.items ?? [])
      .map((item) => item.linkedService?.serviceId?.trim())
      .filter((serviceId): serviceId is string => typeof serviceId === 'string' && UUID_PATTERN.test(serviceId));

    return Array.from(new Set(ids));
  }, [summary.activePlan]);
  const feasibilitySignals = useMemo(
    () => buildSeekerPlanFeasibilitySignals(summary.activePlan?.items ?? [], feasibilityServices),
    [feasibilityServices, summary.activePlan],
  );
  const progress = useMemo(
    () => buildSeekerExecutionProgressSummary(summary.activePlan, feasibilityServices),
    [feasibilityServices, summary.activePlan],
  );
  const recommendations = useMemo(
    () => buildSeekerExecutionRecommendations({ summary, progress, feasibilitySignals, currentServices: feasibilityServices }),
    [feasibilitySignals, feasibilityServices, progress, summary],
  );
  const groundedBrief = useMemo(
    () => buildSeekerGroundedPlanBrief(summary.activePlan, feasibilityServices),
    [feasibilityServices, summary.activePlan],
  );

  useEffect(() => {
    if (!routeFeasibilityEnabled || activeLinkedServiceIds.length === 0) {
      startTransition(() => {
        setFeasibilityServices([]);
        setFeasibilityError(null);
        setIsLoadingFeasibility(false);
      });
      return;
    }

    let cancelled = false;
    startTransition(() => {
      setIsLoadingFeasibility(true);
      setFeasibilityError(null);
    });

    void fetchServicesByIds(activeLinkedServiceIds)
      .then((services) => {
        if (cancelled) {
          return;
        }

        setFeasibilityServices(services);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setFeasibilityServices([]);
        setFeasibilityError(error instanceof Error ? error.message : 'Failed to load current service records');
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingFeasibility(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeLinkedServiceIds, routeFeasibilityEnabled]);

  return (
    <div className="bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_28%,#ffffff_100%)]">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow="Seeker"
          title="Execution dashboard"
          icon={<LayoutDashboard className="h-6 w-6" aria-hidden="true" />}
          subtitle={summary.activePlan
            ? 'A local-first view of what is in motion now: your current plan, due reminders, and the next grounded actions to take.'
            : 'This view becomes your execution dashboard once you start a plan and add reminder-backed next steps.'}
          badges={[
            <PageHeaderBadge key="local">Local-first</PageHeaderBadge>,
            <PageHeaderBadge key="grounded">Grounded in stored records</PageHeaderBadge>,
            summary.activePlan ? <PageHeaderBadge key="items">{summary.openItems.length} open steps</PageHeaderBadge> : null,
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Current focus</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                  {summary.activePlan ? summary.activePlan.title : 'No active plan yet'}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                  {summary.activePlan
                    ? summary.activePlan.objective ?? profileHeadline ?? 'Keep the next actions grounded, visible, and easy to review before you move.'
                    : 'Build a plan from saved or chat-linked services first. Once you do, this dashboard will surface due reminders, progress, and the next concrete actions.'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-700">
                <LayoutDashboard className="h-6 w-6" aria-hidden="true" />
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Completion</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{summary.completionRate}%</p>
                <p className="mt-2 text-sm text-slate-600">{summary.completedItems.length} done of {summary.openItems.length + summary.completedItems.length}</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Due today</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{summary.dueTodayCount}</p>
                <p className="mt-2 text-sm text-slate-600">Steps and reminders that should stay in view today.</p>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Saved support</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{savedCount}</p>
                <p className="mt-2 text-sm text-slate-600">{summary.linkedServiceCount} open steps still point to saved ORAN records.</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/plan">Open plan workspace</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/saved">Review saved options</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Execution guardrails</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
              <p>Plans and reminders stay local on this device in the current slice.</p>
              <p>Linked service facts remain snapshots of stored ORAN records rather than generated provider claims.</p>
              <p>Eligibility is still conditional: you may qualify, and you should confirm with the provider.</p>
              <p>Crisis routing remains separate and preemptive over any execution workspace.</p>
            </div>
            {(cityLabel || profileHeadline) ? (
              <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Local context</p>
                {cityLabel ? <p className="mt-3 text-sm font-medium text-slate-900">Near {cityLabel} (approx.)</p> : null}
                {profileHeadline ? <p className="mt-2 text-sm text-slate-600">{profileHeadline}</p> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Grounded brief</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">What this plan says right now</h2>
              </div>
              <CheckCircle2 className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            {groundedBrief ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-sm font-semibold text-slate-950">{groundedBrief.headline}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{groundedBrief.summary}</p>
                  {groundedBrief.caution ? (
                    <p className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                      {groundedBrief.caution}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Immediate checklist</p>
                  <div className="mt-4 space-y-3">
                    {groundedBrief.checklist.length > 0 ? groundedBrief.checklist.map((entry) => (
                      <div key={entry} className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                        {entry}
                      </div>
                    )) : (
                      <div className="rounded-[18px] border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                        No open steps are left in the active plan right now.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                Start a plan first. The grounded brief appears only when there is local execution state to summarize honestly.
              </div>
            )}
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Recommended now</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Deterministic next-step guidance</h2>
              </div>
              <CheckCircle2 className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {recommendations.length > 0 ? recommendations.map((recommendation) => (
                <div key={recommendation.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-950">{recommendation.title}</p>
                    <span className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{recommendation.priority}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{recommendation.detail}</p>
                </div>
              )) : (
                <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 lg:col-span-3">
                  Add a plan with a few actionable steps first. Recommendations appear only when the local execution state supports them honestly.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Next actions</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">What should stay in front of you now</h2>
              </div>
              <ListTodo className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <div className="mt-5 space-y-3">
              {summary.nextActions.length > 0 ? summary.nextActions.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-slate-950">{item.title}</p>
                      {item.linkedService ? (
                        <p className="mt-1 text-xs text-slate-500">Linked service: {item.linkedService.serviceName} · {item.linkedService.organizationName}</p>
                      ) : null}
                    </div>
                    <span className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                      {item.urgency.replace('_', ' ')}
                    </span>
                  </div>
                  {item.reminderAt ? <p className="mt-3 text-xs text-slate-500">Reminder: {formatReminder(item.reminderAt)}</p> : null}
                  {item.targetDate ? <p className="mt-1 text-xs text-slate-500">Target date: {item.targetDate}</p> : null}
                  {getLinkedServiceExecutionWarnings(item.linkedService).map((warning) => (
                    <p key={warning} className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      {warning}
                    </p>
                  ))}
                </div>
              )) : (
                <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                  No next actions yet. Start by adding a step or a saved service into your plan workspace.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Upcoming reminders</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Local timing you can act on</h2>
              </div>
              <BellRing className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <div className="mt-5 space-y-3">
              {summary.upcomingReminders.length > 0 ? summary.upcomingReminders.map((item) => (
                <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-950">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatReminder(item.reminderAt)}</p>
                    </div>
                    <CalendarClock className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  </div>
                </div>
              )) : (
                <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                  No reminders are scheduled yet. Use the plan item editor to create one locally on this device.
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Overdue</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{summary.overdueReminderCount}</p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Completed</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{summary.completedItems.length}</p>
              </div>
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Plans</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{summary.planCount}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href="/chat">
                  Ask chat for another grounded option
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/saved">
                  Review saved support
                  <Bookmark className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Milestones</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Where this plan is moving</h2>
              </div>
              <CheckCircle2 className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <div className="mt-5 space-y-3">
              {progress.milestones.length > 0 ? progress.milestones.map((milestone) => (
                <div key={milestone.milestone} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-950">{milestone.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{milestone.completedItems} of {milestone.totalItems} steps complete</p>
                    </div>
                    <span className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      {milestone.isReached ? 'Reached' : progress.activeMilestone?.milestone === milestone.milestone ? 'Current' : 'In progress'}
                    </span>
                  </div>
                  {milestone.openItems[0] ? (
                    <p className="mt-3 text-sm leading-6 text-slate-600">Next step: {milestone.openItems[0].title}</p>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-600">All current steps in this milestone are complete.</p>
                  )}
                </div>
              )) : (
                <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                  No milestone labels yet. Use the plan item editor to mark which steps support survival, stabilization, documentation, benefits, employment preparation, or long-term stability.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Recent changes</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">What changed and what to recheck</h2>
              </div>
              <BellRing className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <div className="mt-5 space-y-3">
              {progress.recentUpdates.length > 0 ? progress.recentUpdates.map((update) => (
                <div key={update.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-950">{update.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{update.detail}</p>
                  <p className="mt-2 text-xs text-slate-500">{formatReminder(update.occurredAt)}</p>
                </div>
              )) : (
                <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                  No recent execution changes yet. Completed steps, due reminders, milestone completion, and live service risk changes will surface here.
                </div>
              )}
            </div>
          </div>
        </div>

        {routeFeasibilityEnabled ? (
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Approximate route cues</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Sequence stops only when current records support it</h2>
              </div>
              <CheckCircle2 className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              These cues use only linked ORAN service records for the active plan. Timing and distance stay approximate, so confirm directly with the provider before you travel.
            </p>

            <div className="mt-5 space-y-3">
              {isLoadingFeasibility ? (
                <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                  Loading current record-grounded route cues for your active plan.
                </div>
              ) : feasibilityError ? (
                <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-5 text-sm leading-6 text-amber-900">
                  Unable to load current service records for route cues right now. Keep using the plan, and confirm hours or location directly before you go.
                </div>
              ) : feasibilitySignals.length > 0 ? feasibilitySignals.map((signal) => (
                <div key={`${signal.itemId}:${signal.title}`} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-950">{signal.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{signal.detail}</p>
                </div>
              )) : (
                <div className="rounded-[24px] border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                  No route-feasibility cues are available yet. Add linked service steps with stored hours or location detail, then confirm directly before travel.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
