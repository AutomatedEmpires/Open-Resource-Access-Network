import type { SeekerPlan, SeekerPlanItem, SeekerPlansState } from '@/domain/execution';

export interface SeekerExecutionDashboardSummary {
  planCount: number;
  activePlan: SeekerPlan | null;
  openItems: SeekerPlanItem[];
  completedItems: SeekerPlanItem[];
  nextActions: SeekerPlanItem[];
  upcomingReminders: SeekerPlanItem[];
  dueTodayCount: number;
  overdueReminderCount: number;
  linkedServiceCount: number;
  completionRate: number;
}

function getActivePlan(state: SeekerPlansState): SeekerPlan | null {
  return state.plans.find((plan) => plan.id === state.activePlanId) ?? state.plans[0] ?? null;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareExecutionPriority(left: SeekerPlanItem, right: SeekerPlanItem, now: Date): number {
  const leftReminder = parseDate(left.reminderAt);
  const rightReminder = parseDate(right.reminderAt);

  const getPriority = (item: SeekerPlanItem, reminder: Date | null): number => {
    if (reminder && reminder.getTime() < now.getTime()) return 0;
    if (reminder && isSameLocalDay(reminder, now)) return 1;
    if (item.urgency === 'today') return 2;
    if (item.targetDate === now.toISOString().slice(0, 10)) return 3;
    if (item.urgency === 'this_week') return 4;
    if (item.urgency === 'later') return 5;
    return 6;
  };

  const priorityDelta = getPriority(left, leftReminder) - getPriority(right, rightReminder);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const leftTime = leftReminder?.getTime() ?? parseDate(left.targetDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightTime = rightReminder?.getTime() ?? parseDate(right.targetDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.updatedAt.localeCompare(right.updatedAt);
}

export function buildSeekerExecutionDashboardSummary(
  state: SeekerPlansState,
  now: Date = new Date(),
): SeekerExecutionDashboardSummary {
  const activePlan = getActivePlan(state);
  const items = activePlan?.items ?? [];
  const openItems = items
    .filter((item) => item.status !== 'done')
    .sort((left, right) => compareExecutionPriority(left, right, now));
  const completedItems = items.filter((item) => item.status === 'done');
  const linkedServiceCount = openItems.filter((item) => item.linkedService).length;

  const overdueReminderCount = openItems.filter((item) => {
    const reminder = parseDate(item.reminderAt);
    return reminder ? reminder.getTime() < now.getTime() : false;
  }).length;

  const dueTodayCount = openItems.filter((item) => {
    const reminder = parseDate(item.reminderAt);
    if (reminder && isSameLocalDay(reminder, now)) {
      return true;
    }

    return item.targetDate === now.toISOString().slice(0, 10);
  }).length;

  const upcomingReminders = openItems
    .filter((item) => {
      const reminder = parseDate(item.reminderAt);
      return reminder ? reminder.getTime() >= now.getTime() : false;
    })
    .sort((left, right) => {
      const leftTime = parseDate(left.reminderAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = parseDate(right.reminderAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .slice(0, 5);

  return {
    planCount: state.plans.filter((plan) => plan.status === 'active').length,
    activePlan,
    openItems,
    completedItems,
    nextActions: openItems.slice(0, 4),
    upcomingReminders,
    dueTodayCount,
    overdueReminderCount,
    linkedServiceCount,
    completionRate: items.length > 0 ? Math.round((completedItems.length / items.length) * 100) : 0,
  };
}
