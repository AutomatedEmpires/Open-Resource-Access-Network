import type { ConfidenceBand } from '@/domain/types';

export type SeekerPlanStatus = 'active' | 'archived';
export type SeekerPlanItemStatus = 'todo' | 'done';
export type SeekerPlanItemUrgency = 'today' | 'this_week' | 'later' | 'backup';
export type SeekerPlanItemSource = 'manual' | 'saved_service' | 'directory_service' | 'chat_service';
export type SeekerPlanMilestone = 'immediate_survival' | 'stabilization' | 'documentation' | 'benefits' | 'employment_preparation' | 'long_term_stability';

export interface SeekerPlanServiceSnapshot {
  serviceId: string;
  serviceName: string;
  organizationName: string;
  detailHref?: string;
  address?: string | null;
  trustBand?: ConfidenceBand | null;
  capturedAt: string;
}

export interface SeekerPlanItem {
  id: string;
  title: string;
  status: SeekerPlanItemStatus;
  urgency: SeekerPlanItemUrgency;
  source: SeekerPlanItemSource;
  milestone?: SeekerPlanMilestone;
  note?: string;
  whyItMatters?: string;
  whatToAsk?: string;
  whatToBring?: string;
  fallback?: string;
  targetDate?: string;
  reminderAt?: string;
  linkedService?: SeekerPlanServiceSnapshot;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SeekerPlan {
  id: string;
  title: string;
  objective?: string;
  status: SeekerPlanStatus;
  items: SeekerPlanItem[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface SeekerPlansState {
  plans: SeekerPlan[];
  activePlanId?: string | null;
}
