import { describe, expect, it } from 'vitest';

import {
  buildCommunitySubmissionScope,
  type CommunityAdminScope,
} from '../scope';

function scope(overrides: Partial<CommunityAdminScope> = {}): CommunityAdminScope {
  return {
    userId: 'community-reviewer',
    profileExists: true,
    isActive: true,
    isAcceptingNew: true,
    coverageZoneId: null,
    coverageZoneName: null,
    coverageZoneDescription: null,
    coverageStates: [],
    coverageCounties: [],
    hasGeometry: false,
    hasExplicitScope: false,
    ...overrides,
  };
}

describe('buildCommunitySubmissionScope', () => {
  it('fails closed to direct assignment when no geographic scope is configured', () => {
    const params: unknown[] = ['existing'];

    const predicate = buildCommunitySubmissionScope('sub', scope(), params);

    expect(predicate).toContain('review_profile.is_active = true');
    expect(predicate).toContain('review_profile.is_accepting_new = true');
    expect(predicate).toContain('sub.assigned_to_user_id = $2');
    expect(predicate).toContain('NOT EXISTS');
    expect(params).toEqual(['existing', 'community-reviewer']);
  });

  it('combines geographic coverage with direct assignment', () => {
    const params: unknown[] = [];

    const predicate = buildCommunitySubmissionScope('sub', scope({
      coverageZoneId: '10000000-0000-4000-8000-000000000001',
      coverageStates: ['CA'],
      coverageCounties: ['CA_LOS ANGELES'],
      hasGeometry: true,
      hasExplicitScope: true,
    }), params);

    expect(predicate).toContain('zone.id = $1');
    expect(predicate).toContain('fi.coverage_zone_id = zone.id');
    expect(predicate).toContain('public.ST_Covers');
    expect(predicate).toContain('public.ST_Intersects');
    expect(predicate).toContain('upper(trim(sub.jurisdiction_state)) = ANY($2::text[])');
    expect(predicate).toContain('upper(trim(a.state_province)) = ANY($2::text[])');
    expect(predicate).toContain("l.status = 'active'");
    expect(predicate).toContain("upper(trim(sub.jurisdiction_state))");
    expect(predicate).toContain("= ANY($3::text[])");
    expect(predicate).toContain('sub.assigned_to_user_id = $4');
    expect(params).toEqual([
      '10000000-0000-4000-8000-000000000001',
      ['CA'],
      ['CA_LOS ANGELES'],
      'community-reviewer',
    ]);
  });

  it('keeps a non-geometric zone limited to explicitly routed form work', () => {
    const params: unknown[] = [];

    const predicate = buildCommunitySubmissionScope('sub', scope({
      coverageZoneId: '10000000-0000-4000-8000-000000000001',
      hasGeometry: false,
      hasExplicitScope: true,
    }), params);

    expect(predicate).toContain('fi.coverage_zone_id = zone.id');
    expect(predicate).not.toContain('public.ST_Covers');
    expect(predicate).not.toContain('public.ST_Intersects');
    expect(predicate).toContain('sub.assigned_to_user_id = $2');
  });

  it('requires live accepting-new state for claim predicates', () => {
    const params: unknown[] = [];

    const predicate = buildCommunitySubmissionScope(
      'sub',
      scope({ coverageStates: ['CA'], hasExplicitScope: true }),
      params,
      { requireAcceptingNew: true },
    );

    expect(predicate).toContain('review_profile.is_active = true');
    expect(predicate).toContain('review_profile.is_accepting_new = true');
    expect(predicate).toContain('sub.assigned_to_user_id = $2');
    expect(params).toEqual([['CA'], 'community-reviewer']);
  });

  it('keeps missing profiles assignment-only and makes inactive profiles fail through the live predicate', () => {
    const params: unknown[] = [];
    const predicate = buildCommunitySubmissionScope('sub', scope({
      profileExists: false,
      isActive: false,
      isAcceptingNew: false,
    }), params);

    expect(predicate).toContain('NOT EXISTS');
    expect(predicate).toContain('AND sub.assigned_to_user_id = $1');
    expect(predicate).toContain('review_profile.is_active = true');
  });
});
