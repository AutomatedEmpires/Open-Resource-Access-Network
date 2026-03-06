/**
 * Unit tests for composite search presets
 */

import { describe, it, expect } from 'vitest';
import {
  getSearchPreset,
  mergePresetFilters,
  SEARCH_PRESETS,
  type SearchPreset,
} from '../presets';

describe('getSearchPreset', () => {
  it('returns a preset by its ID', () => {
    const preset = getSearchPreset('low_cost_dental');
    expect(preset).toBeDefined();
    expect(preset!.id).toBe('low_cost_dental');
    expect(preset!.label).toBeTruthy();
    expect(preset!.text).toBeTruthy();
    expect(preset!.attributeFilters).toHaveProperty('cost');
  });

  it('returns undefined for an unknown preset ID', () => {
    expect(getSearchPreset('nonexistent_preset')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getSearchPreset('')).toBeUndefined();
  });

  it('looks up every registered preset by ID', () => {
    for (const preset of SEARCH_PRESETS) {
      const found = getSearchPreset(preset.id);
      expect(found).toBe(preset);
    }
  });
});

describe('SEARCH_PRESETS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(SEARCH_PRESETS)).toBe(true);
    expect(SEARCH_PRESETS.length).toBeGreaterThan(0);
  });

  it('each preset has required fields', () => {
    for (const p of SEARCH_PRESETS) {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.attributeFilters).toBe('object');
    }
  });

  it('preset IDs are unique', () => {
    const ids = SEARCH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mergePresetFilters', () => {
  const presetWithFilters: SearchPreset = {
    id: 'test',
    label: 'Test Preset',
    description: 'For testing',
    attributeFilters: {
      cost: ['free', 'sliding_scale'],
      delivery: ['virtual'],
    },
  };

  const presetNoFilters: SearchPreset = {
    id: 'empty',
    label: 'Empty Preset',
    description: 'No filters',
    attributeFilters: {},
  };

  it('returns preset filters when user supplies none', () => {
    const result = mergePresetFilters(presetWithFilters);
    expect(result).toEqual({
      cost: ['free', 'sliding_scale'],
      delivery: ['virtual'],
    });
  });

  it('returns preset filters when user supplies undefined', () => {
    const result = mergePresetFilters(presetWithFilters, undefined);
    expect(result).toEqual({
      cost: ['free', 'sliding_scale'],
      delivery: ['virtual'],
    });
  });

  it('user filters override preset on same key', () => {
    const result = mergePresetFilters(presetWithFilters, {
      cost: ['medicaid'],
    });
    expect(result).toEqual({
      cost: ['medicaid'],
      delivery: ['virtual'],
    });
  });

  it('user filters add new keys not in preset', () => {
    const result = mergePresetFilters(presetWithFilters, {
      access: ['walk_in'],
    });
    expect(result).toEqual({
      cost: ['free', 'sliding_scale'],
      delivery: ['virtual'],
      access: ['walk_in'],
    });
  });

  it('returns user filters only when preset has empty filters', () => {
    const result = mergePresetFilters(presetNoFilters, {
      cost: ['free'],
    });
    expect(result).toEqual({ cost: ['free'] });
  });

  it('returns empty object when both preset and user have no filters', () => {
    const result = mergePresetFilters(presetNoFilters);
    expect(result).toEqual({});
  });
});
