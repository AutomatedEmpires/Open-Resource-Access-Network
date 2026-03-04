/**
 * Tag confirmation workflow — Tag-level admin review queue.
 *
 * This module defines the STORE-BACKED tag confirmation schema, used by
 * TagConfirmationStore (stores.ts) and the admin approval workflow.
 *
 * DISAMBIGUATION: confirmations.ts defines a separate, lighter TagConfirmation
 * type used by the publish readiness gate. Both exist intentionally:
 *   - tagConfirmations.ts (this file): persistence layer, admin UI, rich schema
 *   - confirmations.ts: publish pipeline, field suggestions, batch operations
 *
 * When the agent extracts a tag with low confidence, it goes to
 * a confirmation queue for human review. Admins can:
 * - Confirm: Accept the suggestion
 * - Modify: Change the value
 * - Reject: Remove the tag
 */
import { z } from 'zod';
import type { ResourceTagType } from './tags';
import { ResourceTagTypeSchema } from './tags';
import {
  type ConfidenceTier,
  getConfidenceTier,
  getTierDisplayInfo as getCanonicalTierDisplayInfo,
} from '@/domain/confidence';

// ============================================================
// Confirmation Status
// ============================================================

export const TagConfirmationStatusSchema = z.enum([
  'pending',       // Awaiting human review
  'confirmed',     // Human agreed with suggestion
  'modified',      // Human changed the value
  'rejected',      // Human rejected the suggestion
  'auto_approved', // High confidence, auto-approved
]);

export type TagConfirmationStatus = z.infer<typeof TagConfirmationStatusSchema>;

// ============================================================
// Confidence Tier (visual color) — canonical type from @/domain/confidence
// ============================================================

export const ConfidenceTierSchema = z.enum(['green', 'yellow', 'orange', 'red']);
export type { ConfidenceTier };

// ============================================================
// Tag Confirmation
// ============================================================

export const TagConfirmationSchema = z.object({
  id: z.string().uuid().optional(),
  candidateId: z.string().uuid(),

  // Reference to original tag (if persisted)
  resourceTagId: z.string().uuid().optional(),

  // Tag details - uses same schema as ResourceTag
  tagType: ResourceTagTypeSchema,
  suggestedValue: z.string().min(1),
  suggestedConfidence: z.number().int().min(0).max(100),

  // Derived confidence tier (for color display)
  confidenceTier: ConfidenceTierSchema,

  // Agent's reasoning
  agentReasoning: z.string().optional(),
  evidenceRefs: z.array(z.string()).default([]),

  // Human decision
  confirmationStatus: TagConfirmationStatusSchema,
  confirmedValue: z.string().optional(),
  confirmedConfidence: z.number().int().min(0).max(100).optional(),

  // Reviewer info
  reviewedByUserId: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewNotes: z.string().optional(),

  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type TagConfirmation = z.infer<typeof TagConfirmationSchema>;

// ============================================================
// Helper functions
// ============================================================

/**
 * Calculate confidence tier from score.
 */
/**
 * Calculate confidence tier from score.
 * @deprecated Use getConfidenceTier from @/domain/confidence directly.
 */
export function getConfidenceTierFromScore(score: number): ConfidenceTier {
  return getConfidenceTier(score);
}

/**
 * Get display info for confidence tier.
 * @deprecated Use getTierDisplayInfo from @/domain/confidence directly.
 */
export function getTierDisplayInfo(tier: ConfidenceTier): {
  color: string;
  label: string;
  description: string;
} {
  const info = getCanonicalTierDisplayInfo(tier);
  return {
    color: info.color,
    label: info.label,
    description: info.description,
  };
}

// ============================================================
// Factory functions
// ============================================================

export function createTagConfirmation(
  candidateId: string,
  tagType: ResourceTagType,
  suggestedValue: string,
  suggestedConfidence: number,
  options: {
    resourceTagId?: string;
    agentReasoning?: string;
    evidenceRefs?: string[];
  } = {}
): TagConfirmation {
  const tier = getConfidenceTierFromScore(suggestedConfidence);

  return {
    candidateId,
    tagType,
    suggestedValue,
    suggestedConfidence,
    confidenceTier: tier,
    confirmationStatus: tier === 'green' ? 'auto_approved' : 'pending',
    agentReasoning: options.agentReasoning,
    evidenceRefs: options.evidenceRefs ?? [],
    resourceTagId: options.resourceTagId,
    // If auto-approved, copy suggested value to confirmed
    ...(tier === 'green' ? {
      confirmedValue: suggestedValue,
      confirmedConfidence: suggestedConfidence,
    } : {}),
  };
}

// ============================================================
// Confirmation actions
// ============================================================

/**
 * Confirm a tag suggestion (accept as-is).
 */
export function confirmTag(
  confirmation: TagConfirmation,
  userId: string,
  notes?: string
): TagConfirmation {
  if (confirmation.confirmationStatus !== 'pending') {
    throw new Error(`Cannot confirm tag in status: ${confirmation.confirmationStatus}`);
  }

  return {
    ...confirmation,
    confirmationStatus: 'confirmed',
    confirmedValue: confirmation.suggestedValue,
    confirmedConfidence: confirmation.suggestedConfidence,
    reviewedByUserId: userId,
    reviewedAt: new Date().toISOString(),
    reviewNotes: notes,
  };
}

/**
 * Modify a tag suggestion (change the value).
 */
export function modifyTag(
  confirmation: TagConfirmation,
  newValue: string,
  userId: string,
  options: {
    confidence?: number;
    notes?: string;
  } = {}
): TagConfirmation {
  if (confirmation.confirmationStatus !== 'pending') {
    throw new Error(`Cannot modify tag in status: ${confirmation.confirmationStatus}`);
  }

  return {
    ...confirmation,
    confirmationStatus: 'modified',
    confirmedValue: newValue,
    confirmedConfidence: options.confidence ?? 100, // Human-confirmed = high confidence
    reviewedByUserId: userId,
    reviewedAt: new Date().toISOString(),
    reviewNotes: options.notes,
  };
}

/**
 * Reject a tag suggestion.
 */
export function rejectTag(
  confirmation: TagConfirmation,
  userId: string,
  reason?: string
): TagConfirmation {
  if (confirmation.confirmationStatus !== 'pending') {
    throw new Error(`Cannot reject tag in status: ${confirmation.confirmationStatus}`);
  }

  return {
    ...confirmation,
    confirmationStatus: 'rejected',
    reviewedByUserId: userId,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reason,
  };
}

// ============================================================
// Query helpers
// ============================================================

/**
 * Check if a tag needs human review.
 */
export function needsReview(confirmation: TagConfirmation): boolean {
  return confirmation.confirmationStatus === 'pending';
}

/**
 * Get all pending confirmations for a candidate.
 */
export function getPendingConfirmations(
  confirmations: TagConfirmation[]
): TagConfirmation[] {
  return confirmations.filter(needsReview);
}

/**
 * Count pending confirmations by tier.
 */
export function countPendingByTier(
  confirmations: TagConfirmation[]
): Record<ConfidenceTier, number> {
  const pending = getPendingConfirmations(confirmations);
  return {
    green: pending.filter(c => c.confidenceTier === 'green').length,
    yellow: pending.filter(c => c.confidenceTier === 'yellow').length,
    orange: pending.filter(c => c.confidenceTier === 'orange').length,
    red: pending.filter(c => c.confidenceTier === 'red').length,
  };
}

/**
 * Get confirmed tags (for final tagging).
 */
export function getConfirmedTags(
  confirmations: TagConfirmation[]
): Array<{ tagType: ResourceTagType; value: string; confidence: number }> {
  return confirmations
    .filter(c =>
      c.confirmationStatus === 'confirmed' ||
      c.confirmationStatus === 'modified' ||
      c.confirmationStatus === 'auto_approved'
    )
    .map(c => ({
      tagType: c.tagType as ResourceTagType,
      value: c.confirmedValue ?? c.suggestedValue,
      confidence: c.confirmedConfidence ?? c.suggestedConfidence,
    }));
}

/**
 * Check if all critical tags are confirmed.
 * Critical tags are low-confidence (orange/red) tags.
 */
export function allCriticalTagsConfirmed(
  confirmations: TagConfirmation[]
): boolean {
  const criticalTags = confirmations.filter(
    c => c.confidenceTier === 'orange' || c.confidenceTier === 'red'
  );
  return criticalTags.every(c => c.confirmationStatus !== 'pending');
}

/**
 * Sort confirmations by priority (lowest confidence first).
 */
export function sortByPriority(
  confirmations: TagConfirmation[]
): TagConfirmation[] {
  const tierOrder: Record<ConfidenceTier, number> = {
    red: 0,
    orange: 1,
    yellow: 2,
    green: 3,
  };

  return [...confirmations].sort((a, b) => {
    // First by tier (red first)
    const tierDiff = tierOrder[a.confidenceTier] - tierOrder[b.confidenceTier];
    if (tierDiff !== 0) return tierDiff;

    // Then by confidence score (lower first)
    return a.suggestedConfidence - b.suggestedConfidence;
  });
}
