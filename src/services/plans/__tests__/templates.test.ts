import { describe, expect, it } from 'vitest';

import { SEEKER_PLAN_TEMPLATES, getSeekerPlanTemplate } from '@/services/plans/templates';

describe('seeker plan templates', () => {
  it('exposes curated starter paths with emergency kits and manual items', () => {
    expect(SEEKER_PLAN_TEMPLATES.length).toBeGreaterThanOrEqual(3);

    for (const template of SEEKER_PLAN_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.title).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.emergencyKit.length).toBeGreaterThan(0);
      expect(template.items.length).toBeGreaterThan(0);
      expect(template.items.every((item) => item.title.trim().length > 0)).toBe(true);
    }
  });

  it('can resolve a template by id', () => {
    const template = getSeekerPlanTemplate('benefits-restart');

    expect(template?.title).toBe('Benefits restart');
    expect(template?.items[0]?.milestone).toBe('benefits');
  });
});
