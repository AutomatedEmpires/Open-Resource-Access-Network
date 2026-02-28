/**
 * Chat Service Types
 */

import { z } from 'zod';
import type { EnrichedService } from '@/domain/types';
import { CRISIS_RESOURCES, ELIGIBILITY_DISCLAIMER } from '@/domain/constants';

// ============================================================
// INTENT
// ============================================================

export const INTENT_CATEGORIES = [
  'food_assistance',
  'housing',
  'mental_health',
  'healthcare',
  'employment',
  'childcare',
  'transportation',
  'legal_aid',
  'utility_assistance',
  'general',
] as const;

export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

export const IntentSchema = z.object({
  category: z.enum(INTENT_CATEGORIES),
  rawQuery: z.string(),
  geoQualifier: z.string().optional(),
  populationQualifier: z.string().optional(),
  urgencyQualifier: z.enum(['urgent', 'standard']).default('standard'),
});

export type Intent = z.infer<typeof IntentSchema>;

// ============================================================
// CHAT MESSAGE
// ============================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.date().default(() => new Date()),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ============================================================
// CHAT REQUEST
// ============================================================

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().uuid(),
  userId: z.string().optional(),
  locale: z.string().default('en'),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ============================================================
// CHAT CONTEXT
// ============================================================

export interface UserProfile {
  userId: string;
  locationCity?: string;
  locationPostalCode?: string;
  categoryPreferences?: string[];
  accessibilityNeeds?: string[];
}

export interface ChatContext {
  sessionId: string;
  userId?: string;
  messageCount: number;
  userProfile?: UserProfile;
  /** Approximate location — city or postal code only */
  approximateLocation?: {
    city?: string;
    postalCode?: string;
    stateProvince?: string;
  };
}

// ============================================================
// CHAT RESPONSE
// ============================================================

export interface ServiceCard {
  serviceId: string;
  serviceName: string;
  organizationName: string;
  description?: string;
  address?: string;
  phone?: string;
  scheduleDescription?: string;
  confidenceBand: 'HIGH' | 'LIKELY' | 'POSSIBLE';
  confidenceScore: number;
  /** Always use qualifying language — never guarantee eligibility */
  eligibilityHint: string;
}

export interface ChatResponse {
  message: string;
  services: ServiceCard[];
  isCrisis: boolean;
  crisisResources?: typeof CRISIS_RESOURCES;
  intent: Intent;
  sessionId: string;
  quotaRemaining: number;
  eligibilityDisclaimer: typeof ELIGIBILITY_DISCLAIMER;
  llmSummarized: boolean;
}

// ============================================================
// QUOTA STATE
// ============================================================

export interface QuotaState {
  sessionId: string;
  messageCount: number;
  remaining: number;
  exceeded: boolean;
}

// ============================================================
// RATE LIMIT STATE
// ============================================================

export interface RateLimitState {
  key: string;
  count: number;
  windowStart: number;
  exceeded: boolean;
}

// ============================================================
// ENRICHED SERVICE → SERVICE CARD CONVERSION
// ============================================================

export function enrichedServiceToCard(enriched: EnrichedService): ServiceCard {
  const { service, organization, address, phones, schedules, confidenceScore } = enriched;

  const addressStr = address
    ? [address.address1, address.city, address.stateProvince, address.postalCode]
        .filter(Boolean)
        .join(', ')
    : undefined;

  const phone = phones[0]?.number;
  const schedule = schedules[0]?.description;

  const band = confidenceScore
    ? confidenceScore.score >= 80
      ? 'HIGH'
      : confidenceScore.score >= 60
        ? 'LIKELY'
        : 'POSSIBLE'
    : 'POSSIBLE';

  return {
    serviceId: service.id,
    serviceName: service.name,
    organizationName: organization.name,
    description: service.description ?? undefined,
    address: addressStr,
    phone,
    scheduleDescription: schedule ?? undefined,
    confidenceBand: band,
    confidenceScore: confidenceScore?.score ?? 0,
    eligibilityHint: 'You may qualify for this service. Please confirm eligibility with the provider.',
  };
}
