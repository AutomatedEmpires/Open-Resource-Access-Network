import type { SeekerPlanItemUrgency } from '@/domain/execution';
import type { ServiceCard } from '@/services/chat/types';

export type ChatExecutionAction = 'add_to_plan' | 'set_reminder';

export interface ChatExecutionProposalDraft {
  action: ChatExecutionAction;
  service: ServiceCard;
  targetDate?: string;
  reminderAt?: string;
  urgency: SeekerPlanItemUrgency;
  summary: string;
  detail: string;
  confirmationLabel: string;
}

function resolveServiceReferenceIndex(message: string, services: ServiceCard[]): number | null {
  const patterns: Array<{ index: number; pattern: RegExp }> = [
    { index: 0, pattern: /\b(first result|first one|top result|result 1|1st result|this result|this service)\b/i },
    { index: 1, pattern: /\b(second result|second one|result 2|2nd result)\b/i },
    { index: 2, pattern: /\b(third result|third one|result 3|3rd result)\b/i },
    { index: 3, pattern: /\b(fourth result|fourth one|result 4|4th result)\b/i },
    { index: 4, pattern: /\b(fifth result|fifth one|result 5|5th result)\b/i },
  ];

  for (const candidate of patterns) {
    if (candidate.pattern.test(message) && services[candidate.index]) {
      return candidate.index;
    }
  }

  return services.length === 1 ? 0 : null;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(base.getDate() + days);
  return next;
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildReminderAtLocal(base: Date, offsetDays: number): string {
  const next = addDays(base, offsetDays);
  next.setSeconds(0, 0);

  if (offsetDays === 0) {
    next.setMinutes(0, 0, 0);
    next.setHours(Math.min(base.getHours() + 1, 20));
    if (next.getTime() <= base.getTime()) {
      next.setTime(base.getTime() + 30 * 60_000);
    }
    return next.toISOString();
  }

  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

function resolveTiming(message: string, now: Date): {
  label: string;
  targetDate: string;
  reminderAt: string;
  urgency: SeekerPlanItemUrgency;
} {
  if (message.includes('next week')) {
    const target = addDays(now, 7);
    return {
      label: 'next week',
      targetDate: toDateOnly(target),
      reminderAt: buildReminderAtLocal(now, 7),
      urgency: 'later',
    };
  }

  if (message.includes('tomorrow')) {
    const target = addDays(now, 1);
    return {
      label: 'tomorrow',
      targetDate: toDateOnly(target),
      reminderAt: buildReminderAtLocal(now, 1),
      urgency: 'this_week',
    };
  }

  if (message.includes('this week')) {
    const target = addDays(now, 3);
    return {
      label: 'this week',
      targetDate: toDateOnly(target),
      reminderAt: buildReminderAtLocal(now, 3),
      urgency: 'this_week',
    };
  }

  return {
    label: 'today',
    targetDate: toDateOnly(now),
    reminderAt: buildReminderAtLocal(now, 0),
    urgency: 'today',
  };
}

export function buildChatExecutionProposal(
  message: string,
  recentServices: ServiceCard[],
  now: Date = new Date(),
): ChatExecutionProposalDraft | null {
  const normalized = message.toLowerCase();
  const index = resolveServiceReferenceIndex(normalized, recentServices);
  if (index == null) {
    return null;
  }

  const service = recentServices[index];
  const timing = resolveTiming(normalized, now);

  if (/\b(remind me|set a reminder|add a reminder)\b/i.test(normalized)) {
    return {
      action: 'set_reminder',
      service,
      targetDate: timing.targetDate,
      reminderAt: timing.reminderAt,
      urgency: timing.urgency,
      summary: `I can set a local reminder for ${service.serviceName}.`,
      detail: `This will keep the step in your local plan and schedule a reminder for ${timing.label} on this device only.`,
      confirmationLabel: 'Set reminder',
    };
  }

  if (/\badd\b.*\b(plan|my plan)\b/i.test(normalized)) {
    return {
      action: 'add_to_plan',
      service,
      targetDate: timing.targetDate,
      urgency: timing.urgency,
      summary: `I can add ${service.serviceName} to your local plan.`,
      detail: `This will create or reuse your active plan and carry the linked ORAN record forward with a ${timing.label} timing target.`,
      confirmationLabel: 'Add to plan',
    };
  }

  return null;
}
