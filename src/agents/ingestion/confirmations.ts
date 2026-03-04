/**
 * Tag Confirmation Contracts — Publish pipeline integration.
 *
 * This module defines the PUBLISH-PIPELINE tag confirmation schema, used by
 * the publish readiness gate (publish.ts) and batch admin workflows.
 *
 * DISAMBIGUATION: tagConfirmations.ts defines a separate, richer TagConfirmation
 * type used by the persistence layer (TagConfirmationStore) and admin approval UI.
 * Both exist intentionally:
 *   - confirmations.ts (this file): publish pipeline, field suggestions, batch ops
 *   - tagConfirmations.ts: persistence layer, admin UI, store-backed schema
 *
 * Color-coded by confidence: green (≥80), yellow (60-79), orange (40-59), red (<40).
 *
 * @module agents/ingestion/confirmations
 */

import { z } from 'zod';
import type { ConfidenceTier } from '@/domain/confidence';
import { getConfidenceTier } from '@/domain/confidence';

// ============================================================
// TAG CONFIRMATION
// ============================================================

export const TagType = z.enum([
  'category',
  'geographic',
  'audience',
  'program',
  'eligibility',
  'service_area',
  'language',
  'custom',
]);
export type TagType = z.infer<typeof TagType>;

export const TagConfirmationStatus = z.enum([
  'pending',
  'confirmed',
  'rejected',
  'modified',
]);
export type TagConfirmationStatus = z.infer<typeof TagConfirmationStatus>;

/**
 * A tag suggestion from the agent that needs admin confirmation.
 */
export const TagConfirmationSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),

  // What the agent suggests
  tagType: TagType,
  suggestedValue: z.string(),
  suggestedLabel: z.string().nullable(),

  // Agent's confidence (0-100)
  agentConfidence: z.number().int().min(0).max(100).default(50),

  // Evidence supporting this suggestion
  evidenceText: z.string().nullable(),
  evidenceSelector: z.string().nullable(),
  evidenceUrl: z.string().url().nullable(),

  // Confirmation status
  status: TagConfirmationStatus.default('pending'),

  // Admin's response
  confirmedValue: z.string().nullable(),
  confirmedByUserId: z.string().nullable(),
  confirmedAt: z.date().nullable(),
  rejectionReason: z.string().nullable(),

  // Auto-confirmation flag
  isAutoConfirmed: z.boolean().default(false),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TagConfirmation = z.infer<typeof TagConfirmationSchema>;

/**
 * Get the confidence color for a tag confirmation.
 */
export function getTagConfidenceColor(tag: TagConfirmation): ConfidenceTier {
  return getConfidenceTier(tag.agentConfidence);
}

/**
 * Check if a tag requires manual confirmation.
 * High-confidence tags (green) can be auto-confirmed; others need human review.
 */
export function requiresManualConfirmation(tag: TagConfirmation): boolean {
  const tier = getConfidenceTier(tag.agentConfidence);
  // Only green tags can be auto-confirmed, and only for certain tag types
  if (tier === 'green') {
    // Category and geographic tags always need confirmation
    // (they're critical for discovery)
    return ['category', 'geographic'].includes(tag.tagType);
  }
  return true;
}

// ============================================================
// TAG CONFIRMATION ACTIONS
// ============================================================

/**
 * Create a new tag confirmation request.
 */
export function createTagConfirmation(
  candidateId: string,
  tagType: TagType,
  suggestedValue: string,
  agentConfidence: number,
  options: {
    suggestedLabel?: string;
    evidenceText?: string;
    evidenceSelector?: string;
    evidenceUrl?: string;
  } = {}
): Omit<TagConfirmation, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    candidateId,
    tagType,
    suggestedValue,
    suggestedLabel: options.suggestedLabel ?? null,
    agentConfidence,
    evidenceText: options.evidenceText ?? null,
    evidenceSelector: options.evidenceSelector ?? null,
    evidenceUrl: options.evidenceUrl ?? null,
    status: 'pending',
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
  };
}

/**
 * Confirm a tag (admin approves).
 */
export function confirmTag(
  tag: TagConfirmation,
  userId: string,
  confirmedValue?: string
): TagConfirmation {
  if (tag.status !== 'pending') {
    throw new Error(`Cannot confirm tag with status: ${tag.status}`);
  }
  return {
    ...tag,
    status: 'confirmed',
    confirmedValue: confirmedValue ?? tag.suggestedValue,
    confirmedByUserId: userId,
    confirmedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Auto-confirm a high-confidence tag.
 */
export function autoConfirmTag(tag: TagConfirmation): TagConfirmation {
  if (tag.status !== 'pending') {
    throw new Error(`Cannot auto-confirm tag with status: ${tag.status}`);
  }
  if (getConfidenceTier(tag.agentConfidence) !== 'green') {
    throw new Error('Only green-tier tags can be auto-confirmed');
  }
  return {
    ...tag,
    status: 'confirmed',
    confirmedValue: tag.suggestedValue,
    confirmedByUserId: null,
    confirmedAt: new Date(),
    isAutoConfirmed: true,
    updatedAt: new Date(),
  };
}

/**
 * Reject a tag (admin disagrees).
 */
export function rejectTag(
  tag: TagConfirmation,
  userId: string,
  reason: string
): TagConfirmation {
  if (tag.status !== 'pending') {
    throw new Error(`Cannot reject tag with status: ${tag.status}`);
  }
  return {
    ...tag,
    status: 'rejected',
    confirmedByUserId: userId,
    confirmedAt: new Date(),
    rejectionReason: reason,
    updatedAt: new Date(),
  };
}

/**
 * Modify a tag (admin corrects the value).
 */
export function modifyTag(
  tag: TagConfirmation,
  userId: string,
  newValue: string,
  newLabel?: string
): TagConfirmation {
  if (tag.status !== 'pending') {
    throw new Error(`Cannot modify tag with status: ${tag.status}`);
  }
  return {
    ...tag,
    status: 'modified',
    confirmedValue: newValue,
    suggestedLabel: newLabel ?? tag.suggestedLabel,
    confirmedByUserId: userId,
    confirmedAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================
// FIELD SUGGESTION
// ============================================================

export const SuggestableField = z.enum([
  'organization_name',
  'service_name',
  'description',
  'phone',
  'email',
  'website_url',
  'address_line1',
  'address_city',
  'address_state',
  'address_postal',
  'hours_text',
  'eligibility_text',
  'service_area_text',
  'intake_process',
  'fees',
  'languages',
]);
export type SuggestableField = z.infer<typeof SuggestableField>;

export const SuggestionSource = z.enum([
  'llm',
  'cross_reference',
  'pattern_match',
  'manual',
]);
export type SuggestionSource = z.infer<typeof SuggestionSource>;

export const FieldSuggestionStatus = z.enum([
  'pending',
  'accepted',
  'rejected',
  'modified',
]);
export type FieldSuggestionStatus = z.infer<typeof FieldSuggestionStatus>;

/**
 * LLM-generated suggestion for a missing or incomplete field.
 */
export const FieldSuggestionSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),

  // Which field
  fieldName: SuggestableField,

  // Current value (may be null or incomplete)
  currentValue: z.string().nullable(),

  // LLM suggestion
  suggestedValue: z.string(),
  suggestionSource: SuggestionSource.default('llm'),

  // Confidence
  suggestionConfidence: z.number().int().min(0).max(100).default(50),

  // Evidence / reasoning
  reasoning: z.string().nullable(),
  evidenceRefs: z.array(z.string()).default([]),

  // Resolution
  status: FieldSuggestionStatus.default('pending'),
  finalValue: z.string().nullable(),
  resolvedByUserId: z.string().nullable(),
  resolvedAt: z.date().nullable(),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type FieldSuggestion = z.infer<typeof FieldSuggestionSchema>;

/**
 * Get confidence color for a field suggestion.
 */
export function getFieldSuggestionColor(
  suggestion: FieldSuggestion
): ConfidenceTier {
  return getConfidenceTier(suggestion.suggestionConfidence);
}

// ============================================================
// FIELD SUGGESTION ACTIONS
// ============================================================

/**
 * Create a field suggestion.
 */
export function createFieldSuggestion(
  candidateId: string,
  fieldName: SuggestableField,
  suggestedValue: string,
  options: {
    currentValue?: string;
    suggestionSource?: SuggestionSource;
    suggestionConfidence?: number;
    reasoning?: string;
    evidenceRefs?: string[];
  } = {}
): Omit<FieldSuggestion, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    candidateId,
    fieldName,
    currentValue: options.currentValue ?? null,
    suggestedValue,
    suggestionSource: options.suggestionSource ?? 'llm',
    suggestionConfidence: options.suggestionConfidence ?? 50,
    reasoning: options.reasoning ?? null,
    evidenceRefs: options.evidenceRefs ?? [],
    status: 'pending',
    finalValue: null,
    resolvedByUserId: null,
    resolvedAt: null,
  };
}

/**
 * Accept a field suggestion (admin agrees).
 */
export function acceptFieldSuggestion(
  suggestion: FieldSuggestion,
  userId: string
): FieldSuggestion {
  if (suggestion.status !== 'pending') {
    throw new Error(`Cannot accept suggestion with status: ${suggestion.status}`);
  }
  return {
    ...suggestion,
    status: 'accepted',
    finalValue: suggestion.suggestedValue,
    resolvedByUserId: userId,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Reject a field suggestion (admin disagrees).
 */
export function rejectFieldSuggestion(
  suggestion: FieldSuggestion,
  userId: string
): FieldSuggestion {
  if (suggestion.status !== 'pending') {
    throw new Error(`Cannot reject suggestion with status: ${suggestion.status}`);
  }
  return {
    ...suggestion,
    status: 'rejected',
    resolvedByUserId: userId,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Modify a field suggestion (admin edits the value).
 */
export function modifyFieldSuggestion(
  suggestion: FieldSuggestion,
  userId: string,
  editedValue: string
): FieldSuggestion {
  if (suggestion.status !== 'pending') {
    throw new Error(`Cannot modify suggestion with status: ${suggestion.status}`);
  }
  return {
    ...suggestion,
    status: 'modified',
    finalValue: editedValue,
    resolvedByUserId: userId,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================
// STORE INTERFACES
// ============================================================

/**
 * Store interface for tag confirmation operations.
 */
export interface TagConfirmationStore {
  create(
    tag: Omit<TagConfirmation, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<TagConfirmation>;
  getByCandidate(candidateId: string): Promise<TagConfirmation[]>;
  getPending(candidateId: string): Promise<TagConfirmation[]>;
  getPendingByColor(
    candidateId: string,
    color: ConfidenceTier
  ): Promise<TagConfirmation[]>;
  update(id: string, updates: Partial<TagConfirmation>): Promise<void>;
  countByStatus(
    candidateId: string
  ): Promise<Record<TagConfirmationStatus, number>>;
}

/**
 * Store interface for field suggestion operations.
 */
export interface FieldSuggestionStore {
  create(
    suggestion: Omit<FieldSuggestion, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<FieldSuggestion>;
  getByCandidate(candidateId: string): Promise<FieldSuggestion[]>;
  getPending(candidateId: string): Promise<FieldSuggestion[]>;
  update(id: string, updates: Partial<FieldSuggestion>): Promise<void>;
}

// ============================================================
// BATCH OPERATIONS (for one-click workflows)
// ============================================================

/**
 * Bulk confirm all green-tier tags for a candidate.
 * Returns count of tags auto-confirmed.
 */
export function bulkAutoConfirmGreenTags(
  tags: TagConfirmation[]
): { confirmed: TagConfirmation[]; skipped: TagConfirmation[] } {
  const confirmed: TagConfirmation[] = [];
  const skipped: TagConfirmation[] = [];

  for (const tag of tags) {
    if (tag.status !== 'pending') {
      skipped.push(tag);
      continue;
    }

    const tier = getConfidenceTier(tag.agentConfidence);
    if (tier === 'green' && !requiresManualConfirmation(tag)) {
      confirmed.push(autoConfirmTag(tag));
    } else {
      skipped.push(tag);
    }
  }

  return { confirmed, skipped };
}

/**
 * Get summary of pending confirmations by color.
 */
export function getPendingTagSummary(
  tags: TagConfirmation[]
): Record<ConfidenceTier, number> {
  const summary: Record<ConfidenceTier, number> = {
    green: 0,
    yellow: 0,
    orange: 0,
    red: 0,
  };

  for (const tag of tags) {
    if (tag.status === 'pending') {
      const tier = getTagConfidenceColor(tag);
      summary[tier]++;
    }
  }

  return summary;
}

/**
 * Check if there are any blocking (red) tags pending.
 */
export function hasBlockingPendingTags(tags: TagConfirmation[]): boolean {
  return tags.some(
    (tag) =>
      tag.status === 'pending' && getConfidenceTier(tag.agentConfidence) === 'red'
  );
}

/**
 * Get the most urgent tags to confirm (sorted by impact).
 *
 * Priority:
 * 1. Category tags (critical for discovery)
 * 2. Geographic tags (critical for routing)
 * 3. Red tags (lowest confidence)
 * 4. Orange tags
 * 5. Yellow tags
 * 6. Green tags (may auto-confirm)
 */
export function sortTagsByUrgency(tags: TagConfirmation[]): TagConfirmation[] {
  const typeOrder: Record<TagType, number> = {
    category: 0,
    geographic: 1,
    audience: 2,
    program: 3,
    eligibility: 4,
    service_area: 5,
    language: 6,
    custom: 7,
  };

  const tierOrder: Record<ConfidenceTier, number> = {
    red: 0,
    orange: 1,
    yellow: 2,
    green: 3,
  };

  return [...tags]
    .filter((tag) => tag.status === 'pending')
    .sort((a, b) => {
      // Critical tags first
      const aIsCritical = ['category', 'geographic'].includes(a.tagType);
      const bIsCritical = ['category', 'geographic'].includes(b.tagType);
      if (aIsCritical !== bIsCritical) {
        return aIsCritical ? -1 : 1;
      }

      // Lower confidence first (more urgent)
      const aTier = tierOrder[getConfidenceTier(a.agentConfidence)];
      const bTier = tierOrder[getConfidenceTier(b.agentConfidence)];
      if (aTier !== bTier) {
        return aTier - bTier;
      }

      // By tag type
      return typeOrder[a.tagType] - typeOrder[b.tagType];
    });
}
