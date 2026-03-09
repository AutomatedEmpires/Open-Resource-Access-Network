/**
 * Tests for tag assignment wiring module.
 */
import { describe, it, expect } from 'vitest';
import { assignTags } from '../tagAssignment';

describe('assignTags', () => {
  it('assigns audience tags from description keywords', () => {
    const result = assignTags({
      payload: { description: 'Services for veterans and their families' },
      trustTier: 'verified_publisher',
    });

    const audienceTags = result.tags.filter(t => t.tagType === 'audience');
    expect(audienceTags.map(t => t.tagValue).sort()).toEqual(['family', 'veteran']);
  });

  it('assigns program tags from eligibility text', () => {
    const result = assignTags({
      payload: { eligibility: 'Must be enrolled in SNAP or WIC', description: '' },
      trustTier: 'curated',
    });

    const programTags = result.tags.filter(t => t.tagType === 'program');
    expect(programTags.map(t => t.tagValue).sort()).toEqual(['snap', 'wic']);
  });

  it('assigns geographic tags from addresses', () => {
    const result = assignTags({
      payload: {
        addresses: [
          { city: 'Coeur d Alene', state: 'Idaho', postal_code: '83814' },
        ],
      },
      trustTier: 'community',
    });

    const geoTags = result.tags.filter(t => t.tagType === 'geographic');
    expect(geoTags.map(t => t.tagValue)).toEqual(
      expect.arrayContaining(['coeur d alene', 'idaho', '83814'])
    );
  });

  it('assigns source quality tag from trust tier', () => {
    const result = assignTags({
      payload: {},
      trustTier: 'quarantine',
    });

    const sqTags = result.tags.filter(t => t.tagType === 'source_quality');
    expect(sqTags).toHaveLength(1);
    expect(sqTags[0].tagValue).toBe('quarantine_source');
  });

  it('includes crosswalk-derived tags', () => {
    const result = assignTags({
      payload: {},
      trustTier: 'verified_publisher',
      crosswalkTags: [
        { tagType: 'category', tagValue: 'food_pantry', confidence: 95 },
      ],
    });

    const catTags = result.tags.filter(t => t.tagType === 'category');
    expect(catTags).toHaveLength(1);
    expect(catTags[0].tagValue).toBe('food_pantry');
    expect(catTags[0].tagConfidence).toBe(95);
  });

  it('deduplicates audience values', () => {
    const result = assignTags({
      payload: { description: 'For veterans. Help for veterans everywhere.' },
      trustTier: 'curated',
    });

    const audienceTags = result.tags.filter(t => t.tagType === 'audience' && t.tagValue === 'veteran');
    expect(audienceTags).toHaveLength(1);
  });

  it('handles nested services array', () => {
    const result = assignTags({
      payload: {
        services: [
          { description: 'Available to seniors and those with disability' },
        ],
      },
      trustTier: 'verified_publisher',
    });

    const audienceTags = result.tags.filter(t => t.tagType === 'audience');
    expect(audienceTags.map(t => t.tagValue).sort()).toEqual(['disabled', 'senior']);
  });

  it('attaches evidence refs when sourceRecordId is provided', () => {
    const result = assignTags({
      payload: { description: 'Youth services' },
      trustTier: 'curated',
      sourceRecordId: 'sr-123',
    });

    const youthTag = result.tags.find(t => t.tagValue === 'youth');
    expect(youthTag?.evidenceRefs).toEqual(['source_record:sr-123']);
  });

  it('handles empty payload gracefully', () => {
    const result = assignTags({
      payload: {},
      trustTier: 'verified_publisher',
    });

    // Should at least have source_quality tag
    expect(result.tags.length).toBeGreaterThanOrEqual(1);
    expect(result.tags.find(t => t.tagType === 'source_quality')).toBeDefined();
  });

  it('extracts geographic from physical_address field', () => {
    const result = assignTags({
      payload: {
        physical_address: { city: 'Moscow', state_province: 'ID', postal_code: '83843' },
      },
      trustTier: 'curated',
    });

    const geoTags = result.tags.filter(t => t.tagType === 'geographic');
    expect(geoTags.map(t => t.tagValue)).toEqual(
      expect.arrayContaining(['moscow', 'id', '83843'])
    );
  });

  it('no source quality tag for unknown trust tier', () => {
    const result = assignTags({
      payload: {},
      trustTier: 'unknown_tier',
    });

    const sqTags = result.tags.filter(t => t.tagType === 'source_quality');
    expect(sqTags).toHaveLength(0);
  });

  it('filters out crosswalk tags with invalid tagType (R10)', () => {
    const result = assignTags({
      payload: {},
      trustTier: 'curated',
      crosswalkTags: [
        { tagType: 'category', tagValue: 'food', confidence: 90 },
        { tagType: 'bogus_type', tagValue: 'junk', confidence: 80 },
        { tagType: 'audience', tagValue: 'veteran', confidence: 70 },
      ],
    });

    // 'bogus_type' should be silently skipped
    expect(result.tags.find(t => t.tagValue === 'junk')).toBeUndefined();
    expect(result.tags.find(t => t.tagValue === 'food')).toBeDefined();
    expect(result.tags.find(t => t.tagValue === 'veteran')).toBeDefined();
  });

  it('deduplicates crosswalk + keyword tags keeping highest confidence (R12)', () => {
    const result = assignTags({
      payload: { description: 'Help for veterans and families' },
      trustTier: 'curated',
      crosswalkTags: [
        { tagType: 'audience', tagValue: 'veteran', confidence: 95 },
      ],
    });

    // Keyword matching would add 'veteran' at confidence 60, crosswalk at 95
    // Dedup should keep the crosswalk one (higher confidence)
    const veteranTags = result.tags.filter(
      t => t.tagType === 'audience' && t.tagValue === 'veteran'
    );
    expect(veteranTags).toHaveLength(1);
    expect(veteranTags[0].tagConfidence).toBe(95);
  });
});
