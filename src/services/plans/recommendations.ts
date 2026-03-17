import type { EnrichedService } from '@/domain/types';
import type { SeekerExecutionProgressSummary } from '@/services/plans/progress';
import type { SeekerExecutionDashboardSummary } from '@/services/plans/dashboard';
import type { SeekerPlanFeasibilitySignal } from '@/services/plans/feasibility';

export interface SeekerExecutionRecommendation {
  id: string;
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
}

export function buildSeekerExecutionRecommendations(input: {
  summary: SeekerExecutionDashboardSummary;
  progress: SeekerExecutionProgressSummary;
  feasibilitySignals?: SeekerPlanFeasibilitySignal[];
  currentServices?: EnrichedService[];
}): SeekerExecutionRecommendation[] {
  const recommendations: SeekerExecutionRecommendation[] = [];
  const firstOpenItem = input.summary.nextActions[0];
  const firstServiceChange = input.progress.recentUpdates.find((update) => update.kind === 'service_change');

  if (input.summary.overdueReminderCount > 0 && firstOpenItem) {
    recommendations.push({
      id: 'overdue-reminder',
      title: `Handle overdue follow-through for ${firstOpenItem.title}`,
      detail: 'At least one reminder is overdue. Confirm the current record first, then either act on the step or reschedule it deliberately.',
      priority: 'high',
    });
  }

  if (firstServiceChange) {
    recommendations.push({
      id: 'service-change',
      title: firstServiceChange.title,
      detail: firstServiceChange.detail,
      priority: 'high',
    });
  }

  if (input.progress.activeMilestone?.openItems[0]) {
    recommendations.push({
      id: `milestone:${input.progress.activeMilestone.milestone}`,
      title: `Advance ${input.progress.activeMilestone.label.toLowerCase()}`,
      detail: `Next milestone-linked step: ${input.progress.activeMilestone.openItems[0].title}.`,
      priority: 'medium',
    });
  }

  if ((input.feasibilitySignals?.length ?? 0) > 0) {
    recommendations.push({
      id: 'feasibility',
      title: input.feasibilitySignals![0].title,
      detail: input.feasibilitySignals![0].detail,
      priority: 'medium',
    });
  }

  if (recommendations.length === 0 && firstOpenItem) {
    recommendations.push({
      id: 'next-open-item',
      title: `Start with ${firstOpenItem.title}`,
      detail: 'No higher-risk execution signal is active, so the safest next move is the top open step already in your plan.',
      priority: 'low',
    });
  }

  return recommendations.slice(0, 3);
}
