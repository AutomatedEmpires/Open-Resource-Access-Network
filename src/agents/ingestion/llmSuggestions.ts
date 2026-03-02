/**
 * LLM suggestions for missing fields.
 *
 * When the agent detects missing fields, it can generate LLM suggestions.
 * These are stored for human review - admins can accept, modify, or reject.
 *
 * Note: LLM suggestions only fill in gaps. They never override existing
 * verified data, and the source of each suggestion is clearly marked.
 */
import { z } from 'zod';

// ============================================================
// Field types that can have LLM suggestions
// ============================================================

export const SuggestionFieldSchema = z.enum([
  'name',
  'description',
  'eligibility_criteria',
  'service_area',
  'hours',
  'phone',
  'email',
  'website',
  'address',
  'fees',
  'languages',
  'intake_process',
  'required_documents',
  'wait_time',
  'capacity',
  'category',
  'other',
]);

export type SuggestionField = z.infer<typeof SuggestionFieldSchema>;

// ============================================================
// Suggestion status
// ============================================================

export const SuggestionStatusSchema = z.enum([
  'pending',   // Awaiting human review
  'accepted',  // Human accepted as-is
  'modified',  // Human modified the value
  'rejected',  // Human rejected
]);

export type SuggestionStatus = z.infer<typeof SuggestionStatusSchema>;

// ============================================================
// LLM Suggestion
// ============================================================

export const LlmSuggestionSchema = z.object({
  id: z.string().uuid().optional(),
  candidateId: z.string().uuid(),

  // What field this suggestion is for
  fieldName: SuggestionFieldSchema,

  // The LLM's suggestion
  suggestedValue: z.string().min(1),

  // How confident the LLM is (0-100, standard ORAN scale)
  llmConfidence: z.number().min(0).max(100),

  // What prompted this suggestion (sanitized, no PII)
  promptContext: z.string().optional(),
  sourceEvidenceRefs: z.array(z.string()).default([]),

  // Model info (for audit)
  llmModel: z.string().default('unknown'),
  llmProvider: z.string().default('azure'),

  // Human decision
  suggestionStatus: SuggestionStatusSchema,
  acceptedValue: z.string().optional(),

  // Reviewer info
  reviewedByUserId: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewNotes: z.string().optional(),

  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type LlmSuggestion = z.infer<typeof LlmSuggestionSchema>;

// ============================================================
// Factory functions
// ============================================================

export function createLlmSuggestion(
  candidateId: string,
  fieldName: SuggestionField,
  suggestedValue: string,
  llmConfidence: number,
  options: {
    promptContext?: string;
    sourceEvidenceRefs?: string[];
    llmModel?: string;
    llmProvider?: string;
  } = {}
): LlmSuggestion {
  return {
    candidateId,
    fieldName,
    suggestedValue,
    llmConfidence,
    suggestionStatus: 'pending',
    promptContext: options.promptContext,
    sourceEvidenceRefs: options.sourceEvidenceRefs ?? [],
    llmModel: options.llmModel ?? 'unknown',
    llmProvider: options.llmProvider ?? 'azure',
  };
}

// ============================================================
// Suggestion actions
// ============================================================

/**
 * Accept an LLM suggestion as-is.
 */
export function acceptSuggestion(
  suggestion: LlmSuggestion,
  userId: string,
  notes?: string
): LlmSuggestion {
  if (suggestion.suggestionStatus !== 'pending') {
    throw new Error(`Cannot accept suggestion in status: ${suggestion.suggestionStatus}`);
  }

  return {
    ...suggestion,
    suggestionStatus: 'accepted',
    acceptedValue: suggestion.suggestedValue,
    reviewedByUserId: userId,
    reviewedAt: new Date().toISOString(),
    reviewNotes: notes,
  };
}

/**
 * Modify an LLM suggestion.
 */
export function modifySuggestion(
  suggestion: LlmSuggestion,
  newValue: string,
  userId: string,
  notes?: string
): LlmSuggestion {
  if (suggestion.suggestionStatus !== 'pending') {
    throw new Error(`Cannot modify suggestion in status: ${suggestion.suggestionStatus}`);
  }

  return {
    ...suggestion,
    suggestionStatus: 'modified',
    acceptedValue: newValue,
    reviewedByUserId: userId,
    reviewedAt: new Date().toISOString(),
    reviewNotes: notes,
  };
}

/**
 * Reject an LLM suggestion.
 */
export function rejectSuggestion(
  suggestion: LlmSuggestion,
  userId: string,
  reason?: string
): LlmSuggestion {
  if (suggestion.suggestionStatus !== 'pending') {
    throw new Error(`Cannot reject suggestion in status: ${suggestion.suggestionStatus}`);
  }

  return {
    ...suggestion,
    suggestionStatus: 'rejected',
    reviewedByUserId: userId,
    reviewedAt: new Date().toISOString(),
    reviewNotes: reason,
  };
}

// ============================================================
// Query helpers
// ============================================================

/**
 * Check if a suggestion needs review.
 */
export function needsReview(suggestion: LlmSuggestion): boolean {
  return suggestion.suggestionStatus === 'pending';
}

/**
 * Get all pending suggestions for a candidate.
 */
export function getPendingSuggestions(
  suggestions: LlmSuggestion[]
): LlmSuggestion[] {
  return suggestions.filter(needsReview);
}

/**
 * Get accepted/modified values to apply to candidate.
 */
export function getAcceptedValues(
  suggestions: LlmSuggestion[]
): Map<SuggestionField, string> {
  const result = new Map<SuggestionField, string>();

  for (const s of suggestions) {
    if (s.suggestionStatus === 'accepted' || s.suggestionStatus === 'modified') {
      if (s.acceptedValue) {
        result.set(s.fieldName, s.acceptedValue);
      }
    }
  }

  return result;
}

/**
 * Group suggestions by field.
 */
export function groupByField(
  suggestions: LlmSuggestion[]
): Map<SuggestionField, LlmSuggestion[]> {
  const result = new Map<SuggestionField, LlmSuggestion[]>();

  for (const s of suggestions) {
    const existing = result.get(s.fieldName) ?? [];
    existing.push(s);
    result.set(s.fieldName, existing);
  }

  return result;
}

/**
 * Sort suggestions by confidence (highest first).
 */
export function sortByConfidence(
  suggestions: LlmSuggestion[]
): LlmSuggestion[] {
  return [...suggestions].sort((a, b) => b.llmConfidence - a.llmConfidence);
}

// ============================================================
// Field metadata
// ============================================================

/**
 * Get display info for a field.
 */
export function getFieldDisplayInfo(field: SuggestionField): {
  label: string;
  description: string;
  isRequired: boolean;
} {
  const info: Record<SuggestionField, { label: string; description: string; isRequired: boolean }> = {
    name: { label: 'Service Name', description: 'The name of the service', isRequired: true },
    description: { label: 'Description', description: 'What the service provides', isRequired: true },
    eligibility_criteria: { label: 'Eligibility', description: 'Who qualifies for this service', isRequired: false },
    service_area: { label: 'Service Area', description: 'Geographic coverage', isRequired: true },
    hours: { label: 'Hours', description: 'Operating hours', isRequired: false },
    phone: { label: 'Phone', description: 'Contact phone number', isRequired: false },
    email: { label: 'Email', description: 'Contact email', isRequired: false },
    website: { label: 'Website', description: 'Service website', isRequired: false },
    address: { label: 'Address', description: 'Physical location', isRequired: false },
    fees: { label: 'Fees', description: 'Cost information', isRequired: false },
    languages: { label: 'Languages', description: 'Languages offered', isRequired: false },
    intake_process: { label: 'Intake Process', description: 'How to apply', isRequired: false },
    required_documents: { label: 'Required Documents', description: 'Documents needed', isRequired: false },
    wait_time: { label: 'Wait Time', description: 'Typical wait time', isRequired: false },
    capacity: { label: 'Capacity', description: 'Available slots', isRequired: false },
    category: { label: 'Category', description: 'Service category', isRequired: true },
    other: { label: 'Other', description: 'Additional information', isRequired: false },
  };

  return info[field];
}

/**
 * Get all required fields.
 */
export function getRequiredFields(): SuggestionField[] {
  return ['name', 'description', 'service_area', 'category'];
}

/**
 * Get critical fields (should prioritize LLM suggestions for these).
 */
export function getCriticalFields(): SuggestionField[] {
  return ['name', 'description', 'service_area', 'category', 'phone', 'address'];
}
