'use client';

import type {
  SeekerPlan,
  SeekerPlanItem,
  SeekerPlanItemSource,
  SeekerPlanItemUrgency,
  SeekerPlanServiceSnapshot,
  SeekerPlansState,
} from '@/domain/execution';

export const SEEKER_PLANS_STORAGE_KEY = 'oran:seeker-plans';
export const SEEKER_PLANS_UPDATED_EVENT = 'oran:seeker-plans-updated';

const EMPTY_SEEKER_PLANS_STATE: SeekerPlansState = {
  plans: [],
  activePlanId: null,
};

function createExecutionId(prefix: 'plan' | 'plan-item'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUrgency(value: unknown): SeekerPlanItemUrgency {
  return value === 'today' || value === 'this_week' || value === 'later' || value === 'backup'
    ? value
    : 'this_week';
}

function normalizeSource(value: unknown): SeekerPlanItemSource {
  return value === 'manual' || value === 'saved_service' || value === 'directory_service' || value === 'chat_service'
    ? value
    : 'manual';
}

function normalizeLinkedService(value: unknown): SeekerPlanServiceSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<SeekerPlanServiceSnapshot>;
  if (
    typeof candidate.serviceId !== 'string'
    || typeof candidate.serviceName !== 'string'
    || typeof candidate.organizationName !== 'string'
    || typeof candidate.capturedAt !== 'string'
  ) {
    return undefined;
  }

  return {
    serviceId: candidate.serviceId,
    serviceName: candidate.serviceName,
    organizationName: candidate.organizationName,
    detailHref: typeof candidate.detailHref === 'string' ? candidate.detailHref : undefined,
    address: typeof candidate.address === 'string' ? candidate.address : null,
    trustBand: candidate.trustBand === 'HIGH' || candidate.trustBand === 'LIKELY' || candidate.trustBand === 'POSSIBLE'
      ? candidate.trustBand
      : null,
    capturedAt: candidate.capturedAt,
  };
}

function normalizeItem(value: unknown): SeekerPlanItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SeekerPlanItem>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.title !== 'string'
    || typeof candidate.createdAt !== 'string'
    || typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    status: candidate.status === 'done' ? 'done' : 'todo',
    urgency: normalizeUrgency(candidate.urgency),
    source: normalizeSource(candidate.source),
    note: typeof candidate.note === 'string' ? candidate.note : undefined,
    whyItMatters: typeof candidate.whyItMatters === 'string' ? candidate.whyItMatters : undefined,
    whatToAsk: typeof candidate.whatToAsk === 'string' ? candidate.whatToAsk : undefined,
    whatToBring: typeof candidate.whatToBring === 'string' ? candidate.whatToBring : undefined,
    fallback: typeof candidate.fallback === 'string' ? candidate.fallback : undefined,
    targetDate: typeof candidate.targetDate === 'string' ? candidate.targetDate : undefined,
    reminderAt: typeof candidate.reminderAt === 'string' ? candidate.reminderAt : undefined,
    linkedService: normalizeLinkedService(candidate.linkedService),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : undefined,
  };
}

function normalizePlan(value: unknown): SeekerPlan | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SeekerPlan>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.title !== 'string'
    || typeof candidate.createdAt !== 'string'
    || typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    objective: typeof candidate.objective === 'string' ? candidate.objective : undefined,
    status: candidate.status === 'archived' ? 'archived' : 'active',
    items: Array.isArray(candidate.items)
      ? candidate.items.map(normalizeItem).filter((item): item is SeekerPlanItem => Boolean(item))
      : [],
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    archivedAt: typeof candidate.archivedAt === 'string' ? candidate.archivedAt : undefined,
  };
}

function normalizePlansState(value: unknown): SeekerPlansState {
  if (!value || typeof value !== 'object') {
    return EMPTY_SEEKER_PLANS_STATE;
  }

  const candidate = value as Partial<SeekerPlansState>;
  const plans = Array.isArray(candidate.plans)
    ? candidate.plans.map(normalizePlan).filter((plan): plan is SeekerPlan => Boolean(plan))
    : [];
  const activePlanId = typeof candidate.activePlanId === 'string' ? candidate.activePlanId : null;

  return {
    plans,
    activePlanId: plans.some((plan) => plan.id === activePlanId)
      ? activePlanId
      : plans[0]?.id ?? null,
  };
}

function emitSeekerPlansUpdated(state: SeekerPlansState): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(SEEKER_PLANS_UPDATED_EVENT, {
    detail: {
      activePlanId: state.activePlanId ?? null,
      planCount: state.plans.length,
      activeItemCount: state.plans.find((plan) => plan.id === state.activePlanId)?.items.length ?? 0,
    },
  }));
}

export function readStoredSeekerPlansState(): SeekerPlansState {
  if (typeof window === 'undefined') {
    return EMPTY_SEEKER_PLANS_STATE;
  }

  try {
    const raw = localStorage.getItem(SEEKER_PLANS_STORAGE_KEY);
    if (!raw) {
      return EMPTY_SEEKER_PLANS_STATE;
    }

    return normalizePlansState(JSON.parse(raw));
  } catch {
    return EMPTY_SEEKER_PLANS_STATE;
  }
}

export function writeStoredSeekerPlansState(state: SeekerPlansState): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(SEEKER_PLANS_STORAGE_KEY, JSON.stringify(state));
    emitSeekerPlansUpdated(state);
  } catch {
    // Ignore quota and serialization errors.
  }
}

export function getActiveSeekerPlan(state: SeekerPlansState): SeekerPlan | null {
  return state.plans.find((plan) => plan.id === state.activePlanId) ?? state.plans[0] ?? null;
}

export function createSeekerPlan(title: string, objective?: string): { state: SeekerPlansState; plan: SeekerPlan | null } {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return { state: readStoredSeekerPlansState(), plan: null };
  }

  const current = readStoredSeekerPlansState();
  const now = new Date().toISOString();
  const plan: SeekerPlan = {
    id: createExecutionId('plan'),
    title: trimmedTitle,
    objective: objective?.trim() || undefined,
    status: 'active',
    items: [],
    createdAt: now,
    updatedAt: now,
  };

  const nextState: SeekerPlansState = {
    plans: [plan, ...current.plans],
    activePlanId: plan.id,
  };
  writeStoredSeekerPlansState(nextState);
  return { state: nextState, plan };
}

export function setActiveSeekerPlan(planId: string): SeekerPlansState {
  const current = readStoredSeekerPlansState();
  const nextState: SeekerPlansState = {
    ...current,
    activePlanId: current.plans.some((plan) => plan.id === planId) ? planId : current.activePlanId ?? null,
  };
  writeStoredSeekerPlansState(nextState);
  return nextState;
}

export function addManualPlanItem(
  planId: string,
  input: {
    title: string;
    note?: string;
    urgency?: SeekerPlanItemUrgency;
    targetDate?: string;
    reminderAt?: string;
    whyItMatters?: string;
    whatToAsk?: string;
    whatToBring?: string;
    fallback?: string;
  },
): { state: SeekerPlansState; item: SeekerPlanItem | null } {
  const trimmedTitle = input.title.trim();
  if (!trimmedTitle) {
    return { state: readStoredSeekerPlansState(), item: null };
  }

  const current = readStoredSeekerPlansState();
  const plan = current.plans.find((entry) => entry.id === planId && entry.status === 'active');
  if (!plan) {
    return { state: current, item: null };
  }

  const now = new Date().toISOString();
  const item: SeekerPlanItem = {
    id: createExecutionId('plan-item'),
    title: trimmedTitle,
    status: 'todo',
    urgency: input.urgency ?? 'this_week',
    source: 'manual',
    note: input.note?.trim() || undefined,
    whyItMatters: input.whyItMatters?.trim() || undefined,
    whatToAsk: input.whatToAsk?.trim() || undefined,
    whatToBring: input.whatToBring?.trim() || undefined,
    fallback: input.fallback?.trim() || undefined,
    targetDate: input.targetDate?.trim() || undefined,
    reminderAt: input.reminderAt?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  const nextState: SeekerPlansState = {
    ...current,
    plans: current.plans.map((entry) => entry.id === planId
      ? {
          ...entry,
          items: [item, ...entry.items],
          updatedAt: now,
        }
      : entry),
    activePlanId: planId,
  };
  writeStoredSeekerPlansState(nextState);
  return { state: nextState, item };
}

export function addServicePlanItem(
  planId: string,
  linkedService: SeekerPlanServiceSnapshot,
  input?: {
    note?: string;
    urgency?: SeekerPlanItemUrgency;
    targetDate?: string;
    reminderAt?: string;
    source?: SeekerPlanItemSource;
  },
): { state: SeekerPlansState; item: SeekerPlanItem | null; alreadyExists: boolean } {
  const current = readStoredSeekerPlansState();
  const plan = current.plans.find((entry) => entry.id === planId && entry.status === 'active');
  if (!plan) {
    return { state: current, item: null, alreadyExists: false };
  }

  const existing = plan.items.find((item) => item.linkedService?.serviceId === linkedService.serviceId && item.status !== 'done');
  if (existing) {
    return { state: current, item: existing, alreadyExists: true };
  }

  const now = new Date().toISOString();
  const item: SeekerPlanItem = {
    id: createExecutionId('plan-item'),
    title: linkedService.serviceName,
    status: 'todo',
    urgency: input?.urgency ?? 'this_week',
    source: input?.source ?? 'saved_service',
    note: input?.note?.trim() || undefined,
    targetDate: input?.targetDate?.trim() || undefined,
    reminderAt: input?.reminderAt?.trim() || undefined,
    linkedService,
    createdAt: now,
    updatedAt: now,
  };

  const nextState: SeekerPlansState = {
    ...current,
    plans: current.plans.map((entry) => entry.id === planId
      ? {
          ...entry,
          items: [item, ...entry.items],
          updatedAt: now,
        }
      : entry),
    activePlanId: planId,
  };
  writeStoredSeekerPlansState(nextState);
  return { state: nextState, item, alreadyExists: false };
}

export function updateSeekerPlanItem(
  planId: string,
  itemId: string,
  patch: Partial<Omit<SeekerPlanItem, 'id' | 'createdAt' | 'linkedService' | 'source'>>,
): SeekerPlansState {
  const current = readStoredSeekerPlansState();
  const now = new Date().toISOString();

  const nextState: SeekerPlansState = {
    ...current,
    plans: current.plans.map((plan) => {
      if (plan.id !== planId) {
        return plan;
      }

      let changed = false;
      const items = plan.items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        changed = true;
        return {
          ...item,
          title: typeof patch.title === 'string' ? patch.title.trim() || item.title : item.title,
          note: typeof patch.note === 'string' ? patch.note.trim() || undefined : item.note,
          urgency: patch.urgency ?? item.urgency,
          whyItMatters: typeof patch.whyItMatters === 'string' ? patch.whyItMatters.trim() || undefined : item.whyItMatters,
          whatToAsk: typeof patch.whatToAsk === 'string' ? patch.whatToAsk.trim() || undefined : item.whatToAsk,
          whatToBring: typeof patch.whatToBring === 'string' ? patch.whatToBring.trim() || undefined : item.whatToBring,
          fallback: typeof patch.fallback === 'string' ? patch.fallback.trim() || undefined : item.fallback,
          targetDate: typeof patch.targetDate === 'string' ? patch.targetDate.trim() || undefined : item.targetDate,
          reminderAt: typeof patch.reminderAt === 'string' ? patch.reminderAt.trim() || undefined : item.reminderAt,
          updatedAt: now,
        };
      });

      return changed ? { ...plan, items, updatedAt: now } : plan;
    }),
  };

  writeStoredSeekerPlansState(nextState);
  return nextState;
}

export function toggleSeekerPlanItemComplete(planId: string, itemId: string): SeekerPlansState {
  const current = readStoredSeekerPlansState();
  const now = new Date().toISOString();

  const nextState: SeekerPlansState = {
    ...current,
    plans: current.plans.map((plan) => {
      if (plan.id !== planId) {
        return plan;
      }

      let changed = false;
      const items = plan.items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        changed = true;
        const nextDone = item.status !== 'done';
        return {
          ...item,
          status: nextDone ? 'done' : 'todo',
          completedAt: nextDone ? now : undefined,
          updatedAt: now,
        };
      });

      return changed ? { ...plan, items, updatedAt: now } : plan;
    }),
  };

  writeStoredSeekerPlansState(nextState);
  return nextState;
}

export function deleteSeekerPlanItem(planId: string, itemId: string): SeekerPlansState {
  const current = readStoredSeekerPlansState();
  const now = new Date().toISOString();

  const nextState: SeekerPlansState = {
    ...current,
    plans: current.plans.map((plan) => {
      if (plan.id !== planId) {
        return plan;
      }

      const items = plan.items.filter((item) => item.id !== itemId);
      return items.length !== plan.items.length ? { ...plan, items, updatedAt: now } : plan;
    }),
  };

  writeStoredSeekerPlansState(nextState);
  return nextState;
}

export function archiveSeekerPlan(planId: string): SeekerPlansState {
  const current = readStoredSeekerPlansState();
  const now = new Date().toISOString();

  const nextPlans = current.plans.map((plan) => plan.id === planId
    ? {
        ...plan,
        status: 'archived' as const,
        archivedAt: now,
        updatedAt: now,
      }
    : plan);
  const nextActivePlan = nextPlans.find((plan) => plan.status === 'active' && plan.id !== planId)?.id ?? null;
  const nextState: SeekerPlansState = {
    plans: nextPlans,
    activePlanId: nextActivePlan,
  };

  writeStoredSeekerPlansState(nextState);
  return nextState;
}
