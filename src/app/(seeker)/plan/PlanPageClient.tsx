'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ListTodo,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSeekerFeatureFlags } from '@/components/seeker/SeekerFeatureFlags';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import type { SeekerPlan, SeekerPlanItem, SeekerPlanItemUrgency, SeekerPlanMilestone } from '@/domain/execution';
import type { EnrichedService } from '@/domain/types';
import { buildPlanServiceSnapshotFromEnrichedService } from '@/services/plans/snapshots';
import { SEEKER_PLAN_MILESTONE_LABELS } from '@/services/plans/progress';
import {
  addManualPlanItem,
  addServicePlanItem,
  archiveSeekerPlan,
  createSeekerPlanFromTemplate,
  deleteSeekerPlanItem,
  getActiveSeekerPlan,
  readStoredSeekerPlansState,
  SEEKER_PLANS_UPDATED_EVENT,
  setActiveSeekerPlan,
  toggleSeekerPlanItemComplete,
  createSeekerPlan,
  updateSeekerPlanItem,
} from '@/services/plans/client';
import { getLinkedServiceExecutionWarnings } from '@/services/plans/snapshotTrust';
import { SEEKER_PLAN_TEMPLATES, type SeekerPlanTemplate } from '@/services/plans/templates';
import { readStoredSavedServiceIds, SAVED_SERVICES_UPDATED_EVENT } from '@/services/saved/client';

interface BatchServiceResponse {
  results: EnrichedService[];
}

const URGENCY_LABELS: Record<SeekerPlanItemUrgency, string> = {
  today: 'Today',
  this_week: 'This week',
  later: 'Later',
  backup: 'Backup',
};

interface PlanItemEditorState {
  id: string;
  title: string;
  note: string;
  urgency: SeekerPlanItemUrgency;
  milestone: SeekerPlanMilestone | '';
  targetDate: string;
  reminderAtLocal: string;
  whyItMatters: string;
  whatToAsk: string;
  whatToBring: string;
  fallback: string;
}

function toLocalDateTimeInputValue(value?: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromLocalDateTimeInputValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildPlanItemEditorState(item: SeekerPlanItem): PlanItemEditorState {
  return {
    id: item.id,
    title: item.title,
    note: item.note ?? '',
    urgency: item.urgency,
    milestone: item.milestone ?? '',
    targetDate: item.targetDate ?? '',
    reminderAtLocal: toLocalDateTimeInputValue(item.reminderAt),
    whyItMatters: item.whyItMatters ?? '',
    whatToAsk: item.whatToAsk ?? '',
    whatToBring: item.whatToBring ?? '',
    fallback: item.fallback ?? '',
  };
}

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
    throw new Error('Failed to load saved services');
  }

  const json = (await res.json()) as BatchServiceResponse;
  return json.results;
}

function PlanCard({
  plan,
  isActive,
  onSelect,
  onArchive,
}: {
  plan: SeekerPlan;
  isActive: boolean;
  onSelect: (planId: string) => void;
  onArchive: (planId: string) => void;
}) {
  const completedCount = plan.items.filter((item) => item.status === 'done').length;

  return (
    <div className={`rounded-[24px] border p-4 shadow-sm transition-colors ${isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
      <button type="button" onClick={() => onSelect(plan.id)} className="w-full text-left">
        <p className="text-sm font-semibold">{plan.title}</p>
        <p className={`mt-1 text-xs ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
          {plan.items.length} item{plan.items.length === 1 ? '' : 's'} · {completedCount} complete
        </p>
      </button>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => onArchive(plan.id)}
          className={`inline-flex min-h-[40px] items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${isActive ? 'text-slate-300 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Archive
        </button>
      </div>
    </div>
  );
}

export default function PlanPageClient() {
  const { reminderEnabled } = useSeekerFeatureFlags();
  const [plansState, setPlansState] = useState(() => readStoredSeekerPlansState());
  const [savedServices, setSavedServices] = useState<EnrichedService[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newPlanObjective, setNewPlanObjective] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualTargetDate, setManualTargetDate] = useState('');
  const [manualUrgency, setManualUrgency] = useState<SeekerPlanItemUrgency>('this_week');
  const [manualMilestone, setManualMilestone] = useState<SeekerPlanMilestone | ''>('');
  const [editingItem, setEditingItem] = useState<PlanItemEditorState | null>(null);

  const syncPlanState = useCallback(() => {
    setPlansState(readStoredSeekerPlansState());
  }, []);

  const loadSavedServices = useCallback(async () => {
    const savedIds = readStoredSavedServiceIds();
    if (savedIds.length === 0) {
      setSavedServices([]);
      setSavedError(null);
      setIsLoadingSaved(false);
      return;
    }

    setIsLoadingSaved(true);
    setSavedError(null);
    try {
      const services = await fetchServicesByIds(savedIds);
      setSavedServices(services);
    } catch (error) {
      setSavedError(error instanceof Error ? error.message : 'Unable to load saved services.');
    } finally {
      setIsLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedServices();
  }, [loadSavedServices]);

  useEffect(() => {
    const refreshSaved = () => { void loadSavedServices(); };
    window.addEventListener(SEEKER_PLANS_UPDATED_EVENT, syncPlanState as EventListener);
    window.addEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshSaved as EventListener);
    window.addEventListener('storage', syncPlanState);

    return () => {
      window.removeEventListener(SEEKER_PLANS_UPDATED_EVENT, syncPlanState as EventListener);
      window.removeEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshSaved as EventListener);
      window.removeEventListener('storage', syncPlanState);
    };
  }, [loadSavedServices, syncPlanState]);

  const activePlan = useMemo(() => getActiveSeekerPlan(plansState), [plansState]);
  const activeItems = useMemo(() => activePlan?.items ?? [], [activePlan]);
  const openItems = activeItems.filter((item) => item.status !== 'done');
  const completedItems = activeItems.filter((item) => item.status === 'done');
  const upcomingReminders = useMemo(
    () => activeItems
      .filter((item) => item.status !== 'done' && item.reminderAt)
      .sort((left, right) => new Date(left.reminderAt ?? '').getTime() - new Date(right.reminderAt ?? '').getTime()),
    [activeItems],
  );
  const linkedServiceIds = new Set(activeItems.map((item) => item.linkedService?.serviceId).filter(Boolean));
  const importableSavedServices = savedServices.filter((service) => !linkedServiceIds.has(service.service.id));

  const handleCreatePlan = () => {
    const created = createSeekerPlan(newPlanTitle || 'Current plan', newPlanObjective);
    if (!created.plan) {
      return;
    }

    setPlansState(created.state);
    setNewPlanTitle('');
    setNewPlanObjective('');
  };

  const handleCreateTemplatePlan = (template: SeekerPlanTemplate) => {
    const created = createSeekerPlanFromTemplate(template);
    if (!created.plan) {
      return;
    }

    setPlansState(created.state);
  };

  const handleCreateManualItem = () => {
    if (!activePlan) {
      return;
    }

    const result = addManualPlanItem(activePlan.id, {
      title: manualTitle,
      note: manualNote,
      targetDate: manualTargetDate,
      urgency: manualUrgency,
      milestone: manualMilestone || undefined,
    });
    if (!result.item) {
      return;
    }

    setPlansState(result.state);
    setManualTitle('');
    setManualNote('');
    setManualTargetDate('');
    setManualUrgency('this_week');
    setManualMilestone('');
  };

  const handleImportSavedService = (service: EnrichedService) => {
    if (!activePlan) {
      return;
    }

    const result = addServicePlanItem(
      activePlan.id,
      buildPlanServiceSnapshotFromEnrichedService(service, `/service/${service.service.id}`),
      { source: 'saved_service' },
    );
    setPlansState(result.state);
  };

  const handleOpenItemEditor = (item: SeekerPlanItem) => {
    setEditingItem(buildPlanItemEditorState(item));
  };

  const handleSaveItemDetails = () => {
    if (!activePlan || !editingItem) {
      return;
    }

    const nextState = updateSeekerPlanItem(activePlan.id, editingItem.id, {
      title: editingItem.title,
      note: editingItem.note,
      urgency: editingItem.urgency,
      milestone: editingItem.milestone || undefined,
      targetDate: editingItem.targetDate,
      reminderAt: fromLocalDateTimeInputValue(editingItem.reminderAtLocal),
      whyItMatters: editingItem.whyItMatters,
      whatToAsk: editingItem.whatToAsk,
      whatToBring: editingItem.whatToBring,
      fallback: editingItem.fallback,
    });

    setPlansState(nextState);
    setEditingItem(null);
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6 md:py-8">
      <PageHeader
        eyebrow="Execution workspace"
        title="Plan"
        subtitle="Turn saved services and your own next steps into a local-first action plan grounded in stored ORAN records."
        badges={[
          <PageHeaderBadge key="local">Local-first</PageHeaderBadge>,
          <PageHeaderBadge key="retrieval">Verified-record linked</PageHeaderBadge>,
          activePlan ? <PageHeaderBadge key="items">{activeItems.length} active items</PageHeaderBadge> : null,
        ].filter(Boolean)}
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-4">
        <aside className="space-y-4 xl:col-span-1">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Plan set</p>
            <div className="mt-4 space-y-3">
              {plansState.plans.filter((plan) => plan.status === 'active').length > 0 ? (
                plansState.plans.filter((plan) => plan.status === 'active').map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    isActive={activePlan?.id === plan.id}
                    onSelect={(planId) => setPlansState(setActiveSeekerPlan(planId))}
                    onArchive={(planId) => setPlansState(archiveSeekerPlan(planId))}
                  />
                ))
              ) : (
                <p className="rounded-[20px] border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                  No plans yet. Create one to start tracking next steps, timing, and backups.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Create plan</p>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={newPlanTitle}
                onChange={(event) => setNewPlanTitle(event.target.value)}
                placeholder="Current plan"
                className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <textarea
                value={newPlanObjective}
                onChange={(event) => setNewPlanObjective(event.target.value)}
                rows={3}
                placeholder="What are you trying to stabilize or complete?"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <Button type="button" onClick={handleCreatePlan} className="w-full gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create plan
              </Button>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Starter paths</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">Operator-curated starting structures for common stabilization moves. They create local plan steps only and do not add provider facts.</p>
              </div>
              <ListTodo className="h-5 w-5 text-slate-500" aria-hidden="true" />
            </div>

            <div className="mt-4 space-y-3">
              {SEEKER_PLAN_TEMPLATES.map((template) => (
                <div key={template.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-950">{template.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{template.description}</p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Emergency kit</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {template.emergencyKit.map((item) => (
                      <span key={item} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600">
                        {item}
                      </span>
                    ))}
                  </div>
                  <Button type="button" variant="outline" onClick={() => handleCreateTemplatePlan(template)} className="mt-4 w-full gap-2">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Use starter path
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-6 xl:col-span-3">
          {activePlan ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Open now</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">{openItems.length}</p>
                  <p className="mt-1 text-sm text-slate-600">Tasks still waiting for action or follow-through.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Completed</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">{completedItems.length}</p>
                  <p className="mt-1 text-sm text-slate-600">Finished steps kept in the same plan for continuity.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Linked services</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">{activeItems.filter((item) => item.linkedService).length}</p>
                  <p className="mt-1 text-sm text-slate-600">Plan items still anchored to stored ORAN service records.</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Active plan</p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-950">{activePlan.title}</h2>
                    {activePlan.objective ? (
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{activePlan.objective}</p>
                    ) : null}
                  </div>
                  <Link
                    href="/saved"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white"
                  >
                    Open saved workspace
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-3">
                <div className="space-y-6 xl:col-span-2">
                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Manual step</p>
                        <h3 className="mt-2 text-lg font-semibold text-slate-950">Add your own next action</h3>
                      </div>
                      <ListTodo className="h-5 w-5 text-slate-500" aria-hidden="true" />
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <input
                        type="text"
                        value={manualTitle}
                        onChange={(event) => setManualTitle(event.target.value)}
                        placeholder="Call provider intake"
                        className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      <select
                        value={manualUrgency}
                        onChange={(event) => setManualUrgency(event.target.value as SeekerPlanItemUrgency)}
                        className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        {Object.entries(URGENCY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <select
                        value={manualMilestone}
                        onChange={(event) => setManualMilestone(event.target.value as SeekerPlanMilestone | '')}
                        className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        <option value="">No milestone yet</option>
                        {Object.entries(SEEKER_PLAN_MILESTONE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <textarea
                        value={manualNote}
                        onChange={(event) => setManualNote(event.target.value)}
                        rows={3}
                        placeholder="What needs to happen, or what you need to bring or confirm"
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 md:col-span-2"
                      />
                      <input
                        type="date"
                        value={manualTargetDate}
                        onChange={(event) => setManualTargetDate(event.target.value)}
                        className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      <Button type="button" onClick={handleCreateManualItem} className="gap-2">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add step
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Plan items</p>
                        <h3 className="mt-2 text-lg font-semibold text-slate-950">Work the plan</h3>
                      </div>
                      <CalendarClock className="h-5 w-5 text-slate-500" aria-hidden="true" />
                    </div>

                    <div className="mt-4 space-y-3">
                      {activeItems.length > 0 ? activeItems.map((item) => (
                        <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className={`text-sm font-semibold ${item.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-950'}`}>{item.title}</p>
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                  {URGENCY_LABELS[item.urgency]}
                                </span>
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                  {item.source === 'manual' ? 'Manual' : 'Linked service'}
                                </span>
                                {item.milestone ? (
                                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                    {SEEKER_PLAN_MILESTONE_LABELS[item.milestone]}
                                  </span>
                                ) : null}
                              </div>
                              {item.note ? <p className="mt-2 text-sm leading-6 text-slate-600">{item.note}</p> : null}
                              {item.targetDate ? <p className="mt-2 text-xs text-slate-500">Target date: {item.targetDate}</p> : null}
                              {reminderEnabled && item.reminderAt ? (
                                <p className="mt-2 text-xs text-slate-500">
                                  Reminder: {new Date(item.reminderAt).toLocaleString()}
                                </p>
                              ) : null}
                              {item.whyItMatters ? (
                                <div className="mt-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why it matters</p>
                                  <p className="mt-2 text-sm leading-6 text-slate-700">{item.whyItMatters}</p>
                                </div>
                              ) : null}
                              {(item.whatToAsk || item.whatToBring || item.fallback) ? (
                                <div className="mt-3 grid gap-3 md:grid-cols-3">
                                  {item.whatToAsk ? (
                                    <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What to ask</p>
                                      <p className="mt-2 text-sm leading-6 text-slate-700">{item.whatToAsk}</p>
                                    </div>
                                  ) : null}
                                  {item.whatToBring ? (
                                    <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What to bring</p>
                                      <p className="mt-2 text-sm leading-6 text-slate-700">{item.whatToBring}</p>
                                    </div>
                                  ) : null}
                                  {item.fallback ? (
                                    <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Backup if it fails</p>
                                      <p className="mt-2 text-sm leading-6 text-slate-700">{item.fallback}</p>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {item.linkedService ? (
                                <div className="mt-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked record</p>
                                  <p className="mt-2 text-sm font-semibold text-slate-950">{item.linkedService.serviceName}</p>
                                  <p className="mt-1 text-xs text-slate-500">{item.linkedService.organizationName}</p>
                                  {item.linkedService.address ? <p className="mt-2 text-xs text-slate-500">{item.linkedService.address}</p> : null}
                                  {getLinkedServiceExecutionWarnings(item.linkedService).map((warning) => (
                                    <p key={warning} className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                      {warning}
                                    </p>
                                  ))}
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {item.linkedService.detailHref ? (
                                      <Link
                                        href={item.linkedService.detailHref}
                                        className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-white"
                                      >
                                        Open service
                                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                      </Link>
                                    ) : null}
                                    {item.linkedService.trustBand ? (
                                      <span className="inline-flex min-h-[40px] items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                                        Trust: {item.linkedService.trustBand}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => handleOpenItemEditor(item)}>
                                {reminderEnabled ? 'Edit details & reminder' : 'Edit details'}
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => setPlansState(toggleSeekerPlanItemComplete(activePlan.id, item.id))}>
                                {item.status === 'done' ? 'Reopen' : 'Complete'}
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => setPlansState(deleteSeekerPlanItem(activePlan.id, item.id))}>
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                          Add a manual step or import a saved service to start sequencing real work.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <aside className="space-y-6 xl:col-span-1">
                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Import from saved</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-950">Promising services into next actions</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">Saved stays your working set. Plan turns those verified options into time-bound action.</p>

                    <div className="mt-4 space-y-3">
                      {isLoadingSaved ? (
                        <p className="text-sm text-slate-500">Loading saved services…</p>
                      ) : savedError ? (
                        <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
                            <p>{savedError}</p>
                          </div>
                        </div>
                      ) : importableSavedServices.length > 0 ? (
                        importableSavedServices.slice(0, 8).map((service) => (
                          <div key={service.service.id} className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                            <p className="text-sm font-semibold text-slate-950">{service.service.name}</p>
                            <p className="mt-1 text-xs text-slate-500">{service.organization.name}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => handleImportSavedService(service)}>
                                Add to active plan
                              </Button>
                              <Link
                                href={`/service/${service.service.id}`}
                                className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                              >
                                View record
                                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                              </Link>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[22px] border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                          Either you have no saved services yet, or everything saved is already linked into this plan.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Execution guardrails</p>
                    <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
                      <p>Plans are local-first on this device and do not replace crisis routing.</p>
                      <p>Linked service items stay grounded in stored ORAN records and keep eligibility caution in force.</p>
                      {reminderEnabled ? <p>Reminders are local-only in this phase and help you keep your own timing without creating server-side seeker history.</p> : null}
                      <p>Use backups for lower-confidence or time-sensitive options you may need if the first stop fails.</p>
                    </div>
                  </div>

                  {reminderEnabled ? (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Upcoming reminders</p>
                      <div className="mt-4 space-y-3">
                        {upcomingReminders.length > 0 ? upcomingReminders.slice(0, 5).map((item) => (
                          <div key={item.id} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-sm font-medium text-slate-950">{item.title}</p>
                            <p className="mt-1 text-xs text-slate-500">{item.reminderAt ? new Date(item.reminderAt).toLocaleString() : ''}</p>
                          </div>
                        )) : (
                          <div className="rounded-[20px] border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                            No reminders scheduled yet. Use the item editor to set one locally on this device.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {completedItems.length > 0 ? (
                    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Completed</p>
                      <div className="mt-4 space-y-3">
                        {completedItems.slice(0, 5).map((item) => (
                          <div key={item.id} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-sm font-medium text-slate-600 line-through">{item.title}</p>
                            {item.completedAt ? <p className="mt-1 text-xs text-slate-500">Completed {new Date(item.completedAt).toLocaleDateString()}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </aside>
              </div>
            </>
          ) : (
            <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 h-5 w-5 flex-shrink-0 text-slate-500" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Create your first plan</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">A plan is where saved services become actual next steps. Start with a short objective, then add manual tasks or pull in verified service records from saved.</p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="max-w-2xl rounded-[28px] border border-slate-200 bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
            <DialogTitle className="text-xl font-semibold text-slate-900">Edit plan item</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              Refine the action, what to confirm, what to bring, and your fallback without breaking the linked service record.
            </DialogDescription>
          </DialogHeader>

          {editingItem ? (
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Title</label>
                  <input
                    type="text"
                    value={editingItem.title}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, title: event.target.value } : current)}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Urgency</label>
                  <select
                    value={editingItem.urgency}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, urgency: event.target.value as SeekerPlanItemUrgency } : current)}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    {Object.entries(URGENCY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Milestone</label>
                  <select
                    value={editingItem.milestone}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, milestone: event.target.value as SeekerPlanMilestone | '' } : current)}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    <option value="">No milestone yet</option>
                    {Object.entries(SEEKER_PLAN_MILESTONE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Target date</label>
                  <input
                    type="date"
                    value={editingItem.targetDate}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, targetDate: event.target.value } : current)}
                    className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>

                {reminderEnabled ? (
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Reminder time</label>
                    <input
                      type="datetime-local"
                      value={editingItem.reminderAtLocal}
                      onChange={(event) => setEditingItem((current) => current ? { ...current, reminderAtLocal: event.target.value } : current)}
                      className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <p className="mt-2 text-xs text-slate-500">Reminder scheduling is local-first in this phase and stays on this device.</p>
                  </div>
                ) : null}

                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Plan note</label>
                  <textarea
                    value={editingItem.note}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, note: event.target.value } : current)}
                    rows={3}
                    placeholder="What needs to happen next"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Why it matters</label>
                  <textarea
                    value={editingItem.whyItMatters}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, whyItMatters: event.target.value } : current)}
                    rows={3}
                    placeholder="Why this step matters right now"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">What to ask</label>
                  <textarea
                    value={editingItem.whatToAsk}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, whatToAsk: event.target.value } : current)}
                    rows={4}
                    placeholder="Questions to confirm with the provider"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">What to bring</label>
                  <textarea
                    value={editingItem.whatToBring}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, whatToBring: event.target.value } : current)}
                    rows={4}
                    placeholder="IDs, paperwork, or proof to keep ready"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Backup if it fails</label>
                  <textarea
                    value={editingItem.fallback}
                    onChange={(event) => setEditingItem((current) => current ? { ...current, fallback: event.target.value } : current)}
                    rows={3}
                    placeholder="What you will do if this step falls through"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSaveItemDetails}>
                  Save details
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
