import type { SeekerPlan, SeekerPlanItem, SeekerPlansState } from '@/domain/execution';
import type { EnrichedService } from '@/domain/types';

import { buildSeekerExecutionDashboardSummary } from '@/services/plans/dashboard';
import { buildSeekerExecutionProgressSummary } from '@/services/plans/progress';

export interface SeekerGroundedPlanBrief {
  headline: string;
  summary: string;
  checklist: string[];
  caution: string | null;
}

function buildSinglePlanState(plan: SeekerPlan): SeekerPlansState {
  return {
    plans: [plan],
    activePlanId: plan.id,
  };
}

function describePlanItem(item: SeekerPlanItem): string {
  const timing = item.reminderAt
    ? `Reminder set for ${new Date(item.reminderAt).toLocaleString()}`
    : item.targetDate
      ? `Target date ${item.targetDate}`
      : item.urgency === 'today'
        ? 'Marked for today'
        : item.urgency === 'this_week'
          ? 'Marked for this week'
          : item.urgency === 'backup'
            ? 'Keep as a backup option'
            : 'Keep in view later';

  return `${item.title}. ${timing}.`;
}

export function buildSeekerGroundedPlanBrief(
  plan: SeekerPlan | null,
  currentServices: EnrichedService[] = [],
  now: Date = new Date(),
): SeekerGroundedPlanBrief | null {
  if (!plan) {
    return null;
  }

  const dashboard = buildSeekerExecutionDashboardSummary(buildSinglePlanState(plan), now);
  const progress = buildSeekerExecutionProgressSummary(plan, currentServices, now);
  const primaryAction = dashboard.nextActions[0] ?? null;
  const openCount = dashboard.openItems.length;
  const completedCount = dashboard.completedItems.length;
  const activeMilestoneLabel = progress.activeMilestone?.label ?? null;
  const serviceChange = progress.recentUpdates.find((update) => update.kind === 'service_change') ?? null;

  const headline = primaryAction
    ? `Start with ${primaryAction.title}`
    : activeMilestoneLabel
      ? `${activeMilestoneLabel} is fully complete`
      : `${plan.title} is currently complete`;

  let summary = '';
  if (primaryAction && dashboard.overdueReminderCount > 0) {
    summary = `${dashboard.overdueReminderCount} reminder-backed step${dashboard.overdueReminderCount === 1 ? '' : 's'} is already due.${activeMilestoneLabel ? ` ${activeMilestoneLabel} is still the current milestone.` : ''} Start with the top open action before adding more tasks.`;
  } else if (primaryAction && activeMilestoneLabel) {
    summary = `${activeMilestoneLabel} is the current milestone, with ${openCount} open step${openCount === 1 ? '' : 's'} and ${completedCount} completed step${completedCount === 1 ? '' : 's'} in this plan.`;
  } else if (primaryAction) {
    summary = `This plan has ${openCount} open step${openCount === 1 ? '' : 's'} and ${completedCount} completed step${completedCount === 1 ? '' : 's'}. Keep the next action small and grounded in saved records.`;
  } else {
    summary = `All current steps in this plan are marked complete. Re-open linked records before depending on them again.`;
  }

  return {
    headline,
    summary,
    checklist: dashboard.nextActions.slice(0, 3).map(describePlanItem),
    caution: serviceChange?.detail ?? (dashboard.overdueReminderCount > 0
      ? 'At least one reminder is overdue on this device. Re-check the next step before it slips further.'
      : null),
  };
}
