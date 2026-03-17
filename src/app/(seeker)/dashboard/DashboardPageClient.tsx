'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BellRing, Bookmark, CalendarClock, CheckCircle2, LayoutDashboard, ListTodo } from 'lucide-react';

import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { readStoredSeekerProfile, SEEKER_PROFILE_UPDATED_EVENT } from '@/services/profile/clientContext';
import { readStoredProfilePreferences, PROFILE_PREFERENCES_UPDATED_EVENT } from '@/services/profile/syncPreference';
import { readStoredSavedServiceCount, SAVED_SERVICES_UPDATED_EVENT } from '@/services/saved/client';
import { readStoredSeekerPlansState, SEEKER_PLANS_UPDATED_EVENT } from '@/services/plans/client';
import { buildSeekerExecutionDashboardSummary } from '@/services/plans/dashboard';

function formatReminder(value?: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export default function DashboardPageClient() {
  const [plansState, setPlansState] = useState(() => readStoredSeekerPlansState());
  const [savedCount, setSavedCount] = useState(() => readStoredSavedServiceCount());
  const [profile, setProfile] = useState(() => readStoredSeekerProfile());
  const [preferences, setPreferences] = useState(() => readStoredProfilePreferences());

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
      </section>
    </div>
  );
}