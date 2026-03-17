import { describe, expect, it } from 'vitest';

import { createEmptyResourceSubmissionDraft } from '@/domain/resourceSubmission';
import {
  applyResourceSubmissionAssistPatch,
  previewResourceSubmissionAssist,
} from '@/services/resourceSubmissions/assistShared';

describe('resource submission assist shared helpers', () => {
  it('fills only empty canonical fields and preserves manual edits', () => {
    const draft = createEmptyResourceSubmissionDraft('listing', 'public');
    draft.organization.name = 'Manual org';
    draft.service.name = 'Manual service';

    const next = applyResourceSubmissionAssistPatch(draft, {
      organization: {
        name: 'Suggested org',
        description: 'Suggested organization description',
      },
      service: {
        name: 'Suggested service',
        description: 'Suggested service description',
      },
      taxonomy: {
        categories: ['food', 'food'],
        customTerms: ['pantry'],
      },
      evidence: {
        sourceUrl: 'https://example.org/help',
      },
    });

    expect(next.organization.name).toBe('Manual org');
    expect(next.service.name).toBe('Manual service');
    expect(next.organization.description).toBe('Suggested organization description');
    expect(next.service.description).toBe('Suggested service description');
    expect(next.taxonomy.categories).toEqual(['food']);
    expect(next.taxonomy.customTerms).toEqual(['pantry']);
    expect(next.evidence.sourceUrl).toBe('https://example.org/help');
  });

  it('reports changed fields and improved completion in preview mode', () => {
    const draft = createEmptyResourceSubmissionDraft('listing', 'public');
    const preview = previewResourceSubmissionAssist(draft, {
      organization: {
        name: 'Helping Hands',
        description: 'Community nonprofit provider',
        url: 'https://example.org',
      },
      service: {
        name: 'Food pantry',
        description: 'Weekly grocery support',
      },
      taxonomy: {
        categories: ['food'],
      },
      access: {
        eligibilityDescription: 'Open to county residents',
      },
      evidence: {
        sourceUrl: 'https://example.org/food',
        notes: 'Verified from provider website.',
      },
    });

    expect(preview.changedFields).toContain('organization.name');
    expect(preview.changedFields).toContain('service.name');
    expect(preview.cardsAfter.filter((card) => card.state === 'complete').length).toBeGreaterThan(
      preview.cardsBefore.filter((card) => card.state === 'complete').length,
    );
  });
});
