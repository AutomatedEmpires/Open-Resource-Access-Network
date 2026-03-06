/**
 * Unit tests for tag confirmation and field suggestion contracts
 */

import { describe, it, expect } from 'vitest';
import {
  TagConfirmationSchema,
  FieldSuggestionSchema,
  getTagConfidenceColor,
  requiresManualConfirmation,
  createTagConfirmation,
  confirmTag,
  autoConfirmTag,
  rejectTag,
  modifyTag,
  acceptFieldSuggestion,
  rejectFieldSuggestion,
  modifyFieldSuggestion,
  getFieldSuggestionColor,
  bulkAutoConfirmGreenTags,
  getPendingTagSummary,
  hasBlockingPendingTags,
  sortTagsByUrgency,
  type TagConfirmation,
  type FieldSuggestion,
} from '../confirmations';

describe('TagConfirmation schema', () => {
  it('validates a complete tag confirmation', () => {
    const validTag = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      candidateId: '550e8400-e29b-41d4-a716-446655440001',
      tagType: 'category',
      suggestedValue: 'food_pantry',
      suggestedLabel: 'Food Pantry',
      agentConfidence: 85,
      evidenceText: 'We provide free food to families in need',
      evidenceSelector: '#main-content p:first-child',
      evidenceUrl: 'https://example.gov/services',
      status: 'pending',
      confirmedValue: null,
      confirmedByUserId: null,
      confirmedAt: null,
      rejectionReason: null,
      isAutoConfirmed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => TagConfirmationSchema.parse(validTag)).not.toThrow();
  });

  it('applies defaults for optional fields', () => {
    const minimal = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      candidateId: '550e8400-e29b-41d4-a716-446655440001',
      tagType: 'category',
      suggestedValue: 'food_pantry',
      suggestedLabel: null,
      evidenceText: null,
      evidenceSelector: null,
      evidenceUrl: null,
      confirmedValue: null,
      confirmedByUserId: null,
      confirmedAt: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const parsed = TagConfirmationSchema.parse(minimal);
    expect(parsed.agentConfidence).toBe(50);
    expect(parsed.status).toBe('pending');
    expect(parsed.isAutoConfirmed).toBe(false);
  });

  it('enforces confidence bounds 0-100', () => {
    const tooHigh = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      candidateId: '550e8400-e29b-41d4-a716-446655440001',
      tagType: 'category',
      suggestedValue: 'food',
      suggestedLabel: null,
      agentConfidence: 150,
      evidenceText: null,
      evidenceSelector: null,
      evidenceUrl: null,
      confirmedValue: null,
      confirmedByUserId: null,
      confirmedAt: null,
      rejectionReason: null,
      isAutoConfirmed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => TagConfirmationSchema.parse(tooHigh)).toThrow();
  });
});

describe('getTagConfidenceColor', () => {
  const makeTag = (confidence: number): TagConfirmation => ({
    id: '1',
    candidateId: '2',
    tagType: 'category',
    suggestedValue: 'food',
    suggestedLabel: null,
    agentConfidence: confidence,
    evidenceText: null,
    evidenceSelector: null,
    evidenceUrl: null,
    status: 'pending',
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('returns green for confidence >= 80', () => {
    expect(getTagConfidenceColor(makeTag(80))).toBe('green');
    expect(getTagConfidenceColor(makeTag(100))).toBe('green');
  });

  it('returns yellow for confidence 60-79', () => {
    expect(getTagConfidenceColor(makeTag(60))).toBe('yellow');
    expect(getTagConfidenceColor(makeTag(79))).toBe('yellow');
  });

  it('returns orange for confidence 40-59', () => {
    expect(getTagConfidenceColor(makeTag(40))).toBe('orange');
    expect(getTagConfidenceColor(makeTag(59))).toBe('orange');
  });

  it('returns red for confidence < 40', () => {
    expect(getTagConfidenceColor(makeTag(39))).toBe('red');
    expect(getTagConfidenceColor(makeTag(0))).toBe('red');
  });
});

describe('requiresManualConfirmation', () => {
  const makeTag = (tagType: TagConfirmation['tagType'], confidence: number): TagConfirmation => ({
    id: '1',
    candidateId: '2',
    tagType,
    suggestedValue: 'test',
    suggestedLabel: null,
    agentConfidence: confidence,
    evidenceText: null,
    evidenceSelector: null,
    evidenceUrl: null,
    status: 'pending',
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('requires manual confirmation for category tags even at high confidence', () => {
    expect(requiresManualConfirmation(makeTag('category', 95))).toBe(true);
  });

  it('requires manual confirmation for geographic tags even at high confidence', () => {
    expect(requiresManualConfirmation(makeTag('geographic', 95))).toBe(true);
  });

  it('allows auto-confirm for program tags at high confidence', () => {
    expect(requiresManualConfirmation(makeTag('program', 85))).toBe(false);
  });

  it('requires manual confirmation for low confidence tags', () => {
    expect(requiresManualConfirmation(makeTag('program', 50))).toBe(true);
  });
});

describe('createTagConfirmation', () => {
  it('creates a pending tag confirmation', () => {
    const tag = createTagConfirmation(
      'candidate-123',
      'category',
      'food_pantry',
      85,
      {
        suggestedLabel: 'Food Pantry',
        evidenceText: 'We provide food assistance',
      }
    );
    expect(tag.status).toBe('pending');
    expect(tag.candidateId).toBe('candidate-123');
    expect(tag.tagType).toBe('category');
    expect(tag.suggestedValue).toBe('food_pantry');
    expect(tag.agentConfidence).toBe(85);
    expect(tag.evidenceText).toBe('We provide food assistance');
  });
});

describe('tag confirmation state transitions', () => {
  const baseTag: TagConfirmation = {
    id: '1',
    candidateId: '2',
    tagType: 'category',
    suggestedValue: 'food_pantry',
    suggestedLabel: 'Food Pantry',
    agentConfidence: 85,
    evidenceText: null,
    evidenceSelector: null,
    evidenceUrl: null,
    status: 'pending',
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('confirmTag transitions pending -> confirmed', () => {
    const confirmed = confirmTag(baseTag, 'admin-123');
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedByUserId).toBe('admin-123');
    expect(confirmed.confirmedAt).toBeDefined();
    expect(confirmed.confirmedValue).toBe(baseTag.suggestedValue);
  });

  it('confirmTag can override the value', () => {
    const confirmed = confirmTag(baseTag, 'admin-123', 'food_bank');
    expect(confirmed.confirmedValue).toBe('food_bank');
  });

  it('confirmTag throws if not pending', () => {
    const alreadyConfirmed = { ...baseTag, status: 'confirmed' as const };
    expect(() => confirmTag(alreadyConfirmed, 'admin-123')).toThrow();
  });

  it('autoConfirmTag sets isAutoConfirmed flag', () => {
    const autoConfirmed = autoConfirmTag(baseTag);
    expect(autoConfirmed.status).toBe('confirmed');
    expect(autoConfirmed.isAutoConfirmed).toBe(true);
    expect(autoConfirmed.confirmedByUserId).toBeNull();
  });

  it('autoConfirmTag throws for non-green tier tags', () => {
    const lowConfidence = { ...baseTag, agentConfidence: 50 };
    expect(() => autoConfirmTag(lowConfidence)).toThrow();
  });

  it('rejectTag transitions pending -> rejected with reason', () => {
    const rejected = rejectTag(baseTag, 'admin-123', 'Incorrect category');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Incorrect category');
    expect(rejected.confirmedByUserId).toBe('admin-123');
  });

  it('modifyTag transitions pending -> modified with new value', () => {
    const modified = modifyTag(baseTag, 'admin-123', 'food_bank', 'Food Bank');
    expect(modified.status).toBe('modified');
    expect(modified.confirmedValue).toBe('food_bank');
    expect(modified.suggestedLabel).toBe('Food Bank');
  });
});

describe('FieldSuggestion schema', () => {
  it('validates a complete field suggestion', () => {
    const validSuggestion = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      candidateId: '550e8400-e29b-41d4-a716-446655440001',
      fieldName: 'phone',
      currentValue: null,
      suggestedValue: '(555) 123-4567',
      suggestionSource: 'llm',
      suggestionConfidence: 70,
      reasoning: 'Found phone number in contact section',
      evidenceRefs: ['https://example.gov/contact'],
      status: 'pending',
      finalValue: null,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => FieldSuggestionSchema.parse(validSuggestion)).not.toThrow();
  });

  it('enforces valid field names', () => {
    const invalid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      candidateId: '550e8400-e29b-41d4-a716-446655440001',
      fieldName: 'invalid_field',
      currentValue: null,
      suggestedValue: 'test',
      suggestionSource: 'llm',
      suggestionConfidence: 70,
      reasoning: null,
      evidenceRefs: [],
      status: 'pending',
      finalValue: null,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => FieldSuggestionSchema.parse(invalid)).toThrow();
  });
});

describe('field suggestion state transitions', () => {
  const baseSuggestion: FieldSuggestion = {
    id: '1',
    candidateId: '2',
    fieldName: 'phone',
    currentValue: null,
    suggestedValue: '(555) 123-4567',
    suggestionSource: 'llm',
    suggestionConfidence: 70,
    reasoning: null,
    evidenceRefs: [],
    status: 'pending',
    finalValue: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('acceptFieldSuggestion transitions pending -> accepted', () => {
    const accepted = acceptFieldSuggestion(baseSuggestion, 'admin-123');
    expect(accepted.status).toBe('accepted');
    expect(accepted.finalValue).toBe(baseSuggestion.suggestedValue);
    expect(accepted.resolvedByUserId).toBe('admin-123');
    expect(accepted.resolvedAt).toBeDefined();
  });

  it('rejectFieldSuggestion transitions pending -> rejected', () => {
    const rejected = rejectFieldSuggestion(baseSuggestion, 'admin-123');
    expect(rejected.status).toBe('rejected');
    expect(rejected.finalValue).toBeNull();
    expect(rejected.resolvedByUserId).toBe('admin-123');
  });

  it('modifyFieldSuggestion transitions pending -> modified with edited value', () => {
    const modified = modifyFieldSuggestion(baseSuggestion, 'admin-123', '(555) 999-8888');
    expect(modified.status).toBe('modified');
    expect(modified.finalValue).toBe('(555) 999-8888');
  });

  it('throws when trying to modify non-pending suggestion', () => {
    const accepted = { ...baseSuggestion, status: 'accepted' as const };
    expect(() => modifyFieldSuggestion(accepted, 'admin-123', 'new value')).toThrow();
  });
});

describe('getFieldSuggestionColor', () => {
  const makeSuggestion = (confidence: number): FieldSuggestion => ({
    id: '1',
    candidateId: '2',
    fieldName: 'phone',
    currentValue: null,
    suggestedValue: 'test',
    suggestionSource: 'llm',
    suggestionConfidence: confidence,
    reasoning: null,
    evidenceRefs: [],
    status: 'pending',
    finalValue: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('returns correct color tiers', () => {
    expect(getFieldSuggestionColor(makeSuggestion(85))).toBe('green');
    expect(getFieldSuggestionColor(makeSuggestion(65))).toBe('yellow');
    expect(getFieldSuggestionColor(makeSuggestion(45))).toBe('orange');
    expect(getFieldSuggestionColor(makeSuggestion(30))).toBe('red');
  });
});

describe('bulkAutoConfirmGreenTags', () => {
  const makeTag = (id: string, tagType: TagConfirmation['tagType'], confidence: number): TagConfirmation => ({
    id,
    candidateId: '2',
    tagType,
    suggestedValue: 'test',
    suggestedLabel: null,
    agentConfidence: confidence,
    evidenceText: null,
    evidenceSelector: null,
    evidenceUrl: null,
    status: 'pending',
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('auto-confirms green non-critical tags', () => {
    const tags = [
      makeTag('1', 'program', 85), // Should auto-confirm
      makeTag('2', 'category', 90), // Should skip (critical)
      makeTag('3', 'language', 95), // Should auto-confirm
    ];
    const result = bulkAutoConfirmGreenTags(tags);
    expect(result.confirmed.length).toBe(2);
    expect(result.confirmed[0].id).toBe('1');
    expect(result.confirmed[1].id).toBe('3');
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].id).toBe('2');
  });

  it('skips non-green tags', () => {
    const tags = [
      makeTag('1', 'program', 50), // Yellow
      makeTag('2', 'program', 30), // Red
    ];
    const result = bulkAutoConfirmGreenTags(tags);
    expect(result.confirmed.length).toBe(0);
    expect(result.skipped.length).toBe(2);
  });
});

describe('getPendingTagSummary', () => {
  const makeTag = (confidence: number, status: TagConfirmation['status'] = 'pending'): TagConfirmation => ({
    id: '1',
    candidateId: '2',
    tagType: 'category',
    suggestedValue: 'test',
    suggestedLabel: null,
    agentConfidence: confidence,
    evidenceText: null,
    evidenceSelector: null,
    evidenceUrl: null,
    status,
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('counts pending tags by color tier', () => {
    const tags = [
      makeTag(85), // green
      makeTag(90), // green
      makeTag(65), // yellow
      makeTag(45), // orange
      makeTag(30), // red
      makeTag(80, 'confirmed'), // should not count
    ];
    const summary = getPendingTagSummary(tags);
    expect(summary.green).toBe(2);
    expect(summary.yellow).toBe(1);
    expect(summary.orange).toBe(1);
    expect(summary.red).toBe(1);
  });
});

describe('hasBlockingPendingTags', () => {
  const makeTag = (confidence: number): TagConfirmation => ({
    id: '1',
    candidateId: '2',
    tagType: 'category',
    suggestedValue: 'test',
    suggestedLabel: null,
    agentConfidence: confidence,
    evidenceText: null,
    evidenceSelector: null,
    evidenceUrl: null,
    status: 'pending',
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('returns true when there are red pending tags', () => {
    const tags = [makeTag(85), makeTag(30)]; // One green, one red
    expect(hasBlockingPendingTags(tags)).toBe(true);
  });

  it('returns false when no red pending tags', () => {
    const tags = [makeTag(85), makeTag(65)]; // Green and yellow
    expect(hasBlockingPendingTags(tags)).toBe(false);
  });
});

describe('sortTagsByUrgency', () => {
  const makeTag = (
    id: string,
    tagType: TagConfirmation['tagType'],
    confidence: number,
    status: TagConfirmation['status'] = 'pending'
  ): TagConfirmation => ({
    id,
    candidateId: '2',
    tagType,
    suggestedValue: 'test',
    suggestedLabel: null,
    agentConfidence: confidence,
    evidenceText: null,
    evidenceSelector: null,
    evidenceUrl: null,
    status,
    confirmedValue: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectionReason: null,
    isAutoConfirmed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('puts critical tags first', () => {
    const tags = [
      makeTag('1', 'program', 85),
      makeTag('2', 'category', 85),
      makeTag('3', 'geographic', 85),
    ];
    const sorted = sortTagsByUrgency(tags);
    expect(sorted[0].id).toBe('2'); // category
    expect(sorted[1].id).toBe('3'); // geographic
    expect(sorted[2].id).toBe('1'); // program
  });

  it('puts lower confidence tags before higher within same criticality', () => {
    const tags = [
      makeTag('1', 'program', 85), // green
      makeTag('2', 'program', 30), // red
      makeTag('3', 'program', 65), // yellow
    ];
    const sorted = sortTagsByUrgency(tags);
    expect(sorted[0].id).toBe('2'); // red first
    expect(sorted[1].id).toBe('3'); // yellow
    expect(sorted[2].id).toBe('1'); // green last
  });

  it('filters out non-pending tags', () => {
    const tags = [
      makeTag('1', 'category', 85, 'pending'),
      makeTag('2', 'category', 85, 'confirmed'),
    ];
    const sorted = sortTagsByUrgency(tags);
    expect(sorted.length).toBe(1);
    expect(sorted[0].id).toBe('1');
  });
});
