import { describe, expect, it } from 'vitest';

import { assessIngestionWorkforceHealth } from '../workforceHealth';

describe('assessIngestionWorkforceHealth', () => {
  it('returns normal when reviewers and owners are active', () => {
    expect(
      assessIngestionWorkforceHealth({
        pendingDecisionSubmissions: 6,
        slaBreachedSubmissions: 0,
        silentReviewers: 0,
        stalledReviewerAssignments: 0,
        silentHostAdmins: 0,
        silentOwnerOrganizations: 0,
      }),
    ).toEqual({
      recommended: false,
      severity: 'normal',
      reasons: [],
      requireReviewOnly: false,
      requireOwnerOutreach: false,
    });
  });

  it('elevates when pending work is assigned to silent reviewers', () => {
    expect(
      assessIngestionWorkforceHealth({
        pendingDecisionSubmissions: 8,
        slaBreachedSubmissions: 0,
        silentReviewers: 2,
        stalledReviewerAssignments: 3,
        silentHostAdmins: 0,
        silentOwnerOrganizations: 0,
      }),
    ).toEqual({
      recommended: true,
      severity: 'elevated',
      reasons: ['3 pending submissions are assigned to 2 silent reviewers'],
      requireReviewOnly: true,
      requireOwnerOutreach: false,
    });
  });

  it('degrades when silent owner organizations coincide with backlog risk', () => {
    expect(
      assessIngestionWorkforceHealth({
        pendingDecisionSubmissions: 5,
        slaBreachedSubmissions: 1,
        silentReviewers: 1,
        stalledReviewerAssignments: 2,
        silentHostAdmins: 3,
        silentOwnerOrganizations: 2,
      }),
    ).toEqual({
      recommended: true,
      severity: 'degraded',
      reasons: [
        '2 pending submissions are assigned to 1 silent reviewer',
        '2 owner organizations have no recently active host admin',
      ],
      requireReviewOnly: true,
      requireOwnerOutreach: true,
    });
  });
});
