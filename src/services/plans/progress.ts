import type { SeekerPlan, SeekerPlanItem, SeekerPlanMilestone } from '@/domain/execution';
import type { EnrichedService } from '@/domain/types';

export interface SeekerExecutionMilestoneSummary {
  milestone: SeekerPlanMilestone;
  label: string;
  totalItems: number;
  completedItems: number;
  openItems: SeekerPlanItem[];
  isReached: boolean;
}

export interface SeekerExecutionUpdate {
  id: string;
  kind: 'reminder_due' | 'milestone_reached' | 'service_change' | 'step_completed';
  title: string;
  detail: string;
  occurredAt: string;
}

export interface SeekerExecutionProgressSummary {
  milestones: SeekerExecutionMilestoneSummary[];
  activeMilestone: SeekerExecutionMilestoneSummary | null;
  recentUpdates: SeekerExecutionUpdate[];
}

export const SEEKER_PLAN_MILESTONE_ORDER: readonly SeekerPlanMilestone[] = [
  'immediate_survival',
  'stabilization',
  'documentation',
  'benefits',
  'employment_preparation',
  'long_term_stability',
] as const;

export const SEEKER_PLAN_MILESTONE_LABELS: Record<SeekerPlanMilestone, string> = {
  immediate_survival: 'Immediate survival',
  stabilization: 'Stabilization',
  documentation: 'Documentation',
  benefits: 'Benefits',
  employment_preparation: 'Employment preparation',
  long_term_stability: 'Long-term stability',
};

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildServiceChangeUpdates(
  plan: SeekerPlan | null,
  currentServices: EnrichedService[],
  now: Date,
): SeekerExecutionUpdate[] {
  if (!plan || currentServices.length === 0) {
    return [];
  }

  const linkedItems = plan.items.filter((item) => item.linkedService?.serviceId);
  const servicesById = new Map(currentServices.map((service) => [service.service.id, service]));

  return linkedItems.flatMap((item) => {
    const linkedServiceId = item.linkedService?.serviceId;
    if (!linkedServiceId) {
      return [];
    }

    const liveService = servicesById.get(linkedServiceId);
    if (!liveService) {
      return [];
    }

    const updates: SeekerExecutionUpdate[] = [];
    const serviceUpdatedAt = liveService.service.updatedAt instanceof Date
      ? liveService.service.updatedAt.toISOString()
      : now.toISOString();

    if (liveService.service.integrityHoldAt) {
      updates.push({
        id: `${item.id}:integrity-hold`,
        kind: 'service_change',
        title: `${item.title} is under an ORAN integrity hold`,
        detail: 'Treat this stop as unstable until you re-open the live service record and confirm what is still available.',
        occurredAt: liveService.service.integrityHoldAt,
      });
    } else if (liveService.service.status !== 'active') {
      updates.push({
        id: `${item.id}:status`,
        kind: 'service_change',
        title: `${item.title} may no longer be active`,
        detail: 'The current live service record is no longer active. Re-open the record before relying on this step.',
        occurredAt: serviceUpdatedAt,
      });
    } else if (liveService.service.capacityStatus === 'waitlist' || liveService.service.capacityStatus === 'closed') {
      updates.push({
        id: `${item.id}:capacity`,
        kind: 'service_change',
        title: `${item.title} may have changed availability`,
        detail: `The current live record shows ${liveService.service.capacityStatus}. Confirm current availability before you travel.`,
        occurredAt: serviceUpdatedAt,
      });
    }

    return updates;
  });
}

export function buildSeekerExecutionProgressSummary(
  plan: SeekerPlan | null,
  currentServices: EnrichedService[] = [],
  now: Date = new Date(),
): SeekerExecutionProgressSummary {
  const milestoneItems = (plan?.items ?? []).filter((item): item is SeekerPlanItem & { milestone: SeekerPlanMilestone } => Boolean(item.milestone));

  const milestones = SEEKER_PLAN_MILESTONE_ORDER.map((milestone) => {
    const items = milestoneItems.filter((item) => item.milestone === milestone);
    const completedItems = items.filter((item) => item.status === 'done').length;

    return {
      milestone,
      label: SEEKER_PLAN_MILESTONE_LABELS[milestone],
      totalItems: items.length,
      completedItems,
      openItems: items.filter((item) => item.status !== 'done'),
      isReached: items.length > 0 && completedItems === items.length,
    };
  }).filter((milestone) => milestone.totalItems > 0);

  const activeMilestone = milestones.find((milestone) => !milestone.isReached) ?? milestones[milestones.length - 1] ?? null;

  const reminderUpdates = (plan?.items ?? [])
    .filter((item) => item.status !== 'done' && item.reminderAt)
    .map((item) => ({ item, reminderAt: parseDate(item.reminderAt) }))
    .filter((entry): entry is { item: SeekerPlanItem; reminderAt: Date } => entry.reminderAt !== null && entry.reminderAt.getTime() <= now.getTime())
    .map(({ item, reminderAt }) => ({
      id: `${item.id}:reminder`,
      kind: 'reminder_due' as const,
      title: `Reminder due for ${item.title}`,
      detail: 'This step has reached its reminder time on this device.',
      occurredAt: reminderAt.toISOString(),
    }));

  const completionUpdates = (plan?.items ?? [])
    .filter((item) => item.status === 'done' && item.completedAt)
    .map((item) => ({ item, completedAt: parseDate(item.completedAt) }))
    .filter((entry): entry is { item: SeekerPlanItem; completedAt: Date } => Boolean(entry.completedAt))
    .filter(({ completedAt }) => now.getTime() - completedAt.getTime() <= 7 * 86_400_000)
    .map(({ item, completedAt }) => ({
      id: `${item.id}:completed`,
      kind: 'step_completed' as const,
      title: `Completed ${item.title}`,
      detail: 'This finished step is still part of your local execution history.',
      occurredAt: completedAt.toISOString(),
    }));

  const milestoneUpdates: SeekerExecutionUpdate[] = milestones
    .filter((milestone) => milestone.isReached)
    .flatMap((milestone) => {
      const latestCompletion = milestoneItems
        .filter((item) => item.milestone === milestone.milestone)
        .map((item) => parseDate(item.completedAt)?.getTime() ?? 0)
        .reduce((latest, current) => Math.max(latest, current), 0);

      if (latestCompletion <= 0) return [];
      return [{
        id: `${milestone.milestone}:reached`,
        kind: 'milestone_reached' as const,
        title: `${milestone.label} milestone reached`,
        detail: 'All steps currently assigned to this milestone are complete.',
        occurredAt: new Date(latestCompletion).toISOString(),
      }];
    });

  const recentUpdates = [
    ...buildServiceChangeUpdates(plan, currentServices, now),
    ...reminderUpdates,
    ...milestoneUpdates,
    ...completionUpdates,
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 8);

  return {
    milestones,
    activeMilestone,
    recentUpdates,
  };
}
