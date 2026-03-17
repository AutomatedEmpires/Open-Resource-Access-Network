import { send } from '@/services/notifications/service';

export async function notifySavedServiceChanged(input: {
  recipientUserId: string;
  serviceId: string;
  serviceName: string;
}): Promise<string | null> {
  return send({
    recipientUserId: input.recipientUserId,
    eventType: 'saved_service_changed',
    title: `${input.serviceName} changed`,
    body: 'A service you saved or planned has changed. Re-open the live ORAN record before you rely on it.',
    resourceType: 'service',
    resourceId: input.serviceId,
    actionUrl: `/service/${input.serviceId}`,
    idempotencyKey: `saved-service-changed:${input.recipientUserId}:${input.serviceId}`,
  });
}

export async function notifySavedServiceMayBeStale(input: {
  recipientUserId: string;
  serviceId: string;
  serviceName: string;
}): Promise<string | null> {
  return send({
    recipientUserId: input.recipientUserId,
    eventType: 'saved_service_may_be_stale',
    title: `${input.serviceName} may be stale`,
    body: 'A service you saved or planned may now be stale. Re-open the current ORAN record before you travel.',
    resourceType: 'service',
    resourceId: input.serviceId,
    actionUrl: `/service/${input.serviceId}`,
    idempotencyKey: `saved-service-stale:${input.recipientUserId}:${input.serviceId}`,
  });
}

export async function notifySeekerReminderDue(input: {
  recipientUserId: string;
  planId: string;
  itemId: string;
  title: string;
}): Promise<string | null> {
  return send({
    recipientUserId: input.recipientUserId,
    eventType: 'seeker_reminder_due',
    title: `Reminder due: ${input.title}`,
    body: 'A plan reminder reached its due time. Open your plan to confirm the next action.',
    resourceType: 'plan_item',
    resourceId: input.itemId,
    actionUrl: '/plan',
    idempotencyKey: `seeker-reminder-due:${input.recipientUserId}:${input.itemId}`,
  });
}

export async function notifySeekerPlanMilestoneReached(input: {
  recipientUserId: string;
  planId: string;
  milestoneLabel: string;
}): Promise<string | null> {
  return send({
    recipientUserId: input.recipientUserId,
    eventType: 'seeker_plan_milestone_reached',
    title: `${input.milestoneLabel} milestone reached`,
    body: 'Your current plan reached a milestone. Review the dashboard to see what should happen next.',
    resourceType: 'plan',
    resourceId: input.planId,
    actionUrl: '/plan/dashboard',
    idempotencyKey: `seeker-plan-milestone:${input.recipientUserId}:${input.planId}:${input.milestoneLabel}`,
  });
}
