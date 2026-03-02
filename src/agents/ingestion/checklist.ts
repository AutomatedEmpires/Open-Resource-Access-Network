import { z } from 'zod';

export const ChecklistItemKeySchema = z.enum([
  'contact_method',
  'physical_address_or_virtual',
  'service_area',
  'eligibility_criteria',
  'hours',
  'source_provenance',
  'duplication_review',
  'policy_pass',
]);
export type ChecklistItemKey = z.infer<typeof ChecklistItemKeySchema>;

export const ChecklistItemStatusSchema = z.enum(['missing', 'satisfied', 'not_applicable']);
export type ChecklistItemStatus = z.infer<typeof ChecklistItemStatusSchema>;

export const VerificationChecklistItemSchema = z
  .object({
    key: ChecklistItemKeySchema,
    required: z.boolean().default(true),
    status: ChecklistItemStatusSchema.default('missing'),
    missingFields: z.array(z.string().min(1)).default([]),
    evidenceRefs: z.array(z.string().min(1)).default([]),
    notes: z.string().min(1).optional(),
  })
  .strict();
export type VerificationChecklistItem = z.infer<typeof VerificationChecklistItemSchema>;

export const VerificationChecklistSchema = z.array(VerificationChecklistItemSchema);
export type VerificationChecklist = z.infer<typeof VerificationChecklistSchema>;

export function buildDefaultChecklist(): VerificationChecklist {
  return VerificationChecklistSchema.parse([
    { key: 'contact_method' },
    { key: 'physical_address_or_virtual' },
    { key: 'service_area' },
    { key: 'eligibility_criteria' },
    { key: 'hours' },
    { key: 'source_provenance' },
    { key: 'duplication_review' },
    { key: 'policy_pass' },
  ]);
}

export function checklistMissingKeys(checklist: VerificationChecklist): ChecklistItemKey[] {
  return checklist
    .filter((i) => i.required && i.status === 'missing')
    .map((i) => i.key);
}

export function checklistSatisfied(checklist: VerificationChecklist): boolean {
  return checklistMissingKeys(checklist).length === 0;
}
