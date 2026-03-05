import { describe, expect, it } from 'vitest';
import {
  VerificationChecklistItemSchema,
  buildDefaultChecklist,
  checklistMissingKeys,
  checklistSatisfied,
} from '@/agents/ingestion/checklist';

describe('ingestion checklist helpers', () => {
  it('builds the full default checklist with missing required items', () => {
    const checklist = buildDefaultChecklist();

    expect(checklist).toHaveLength(8);
    expect(checklist.every((item) => item.required === true)).toBe(true);
    expect(checklist.every((item) => item.status === 'missing')).toBe(true);
    expect(checklistMissingKeys(checklist)).toHaveLength(8);
    expect(checklistSatisfied(checklist)).toBe(false);
  });

  it('parses defaults and rejects unexpected fields on checklist items', () => {
    const parsed = VerificationChecklistItemSchema.parse({
      key: 'hours',
    });

    expect(parsed).toEqual({
      key: 'hours',
      required: true,
      status: 'missing',
      missingFields: [],
      evidenceRefs: [],
    });

    expect(() =>
      VerificationChecklistItemSchema.parse({
        key: 'hours',
        extra: 'not allowed',
      }),
    ).toThrow();
  });

  it('computes missing keys using required + missing status semantics', () => {
    const checklist = [
      {
        key: 'contact_method',
        required: true,
        status: 'satisfied',
        missingFields: [],
        evidenceRefs: [],
      },
      {
        key: 'hours',
        required: true,
        status: 'missing',
        missingFields: ['opens'],
        evidenceRefs: [],
      },
      {
        key: 'policy_pass',
        required: false,
        status: 'missing',
        missingFields: [],
        evidenceRefs: [],
      },
    ] as const;

    expect(checklistMissingKeys(checklist as never)).toEqual(['hours']);
    expect(checklistSatisfied(checklist as never)).toBe(false);

    const satisfiedChecklist = [
      {
        key: 'hours',
        required: true,
        status: 'satisfied',
        missingFields: [],
        evidenceRefs: [],
      },
    ];
    expect(checklistSatisfied(satisfiedChecklist as never)).toBe(true);
  });
});
