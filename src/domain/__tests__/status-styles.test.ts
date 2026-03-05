import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_STYLE,
  SUBMISSION_STATUS_STYLES,
} from '../status-styles';

describe('SUBMISSION_STATUS_STYLES', () => {
  const ALL_SUBMISSION_STATUSES = [
    'draft', 'submitted', 'auto_checking', 'needs_review', 'under_review',
    'approved', 'denied', 'escalated', 'pending_second_approval',
    'returned', 'withdrawn', 'expired', 'archived',
  ] as const;

  it('has an entry for every SubmissionStatus value', () => {
    for (const status of ALL_SUBMISSION_STATUSES) {
      expect(SUBMISSION_STATUS_STYLES).toHaveProperty(status);
      expect(SUBMISSION_STATUS_STYLES[status].color).toBeTruthy();
      expect(SUBMISSION_STATUS_STYLES[status].label).toBeTruthy();
    }
  });

  it('uses canonical labels for key statuses', () => {
    expect(SUBMISSION_STATUS_STYLES.submitted.label).toBe('Submitted');
    expect(SUBMISSION_STATUS_STYLES.under_review.label).toBe('Under Review');
    expect(SUBMISSION_STATUS_STYLES.approved.label).toBe('Approved');
    expect(SUBMISSION_STATUS_STYLES.denied.label).toBe('Denied');
  });

  it('each entry has non-empty color and label', () => {
    for (const [, style] of Object.entries(SUBMISSION_STATUS_STYLES)) {
      expect(style.color.length).toBeGreaterThan(0);
      expect(style.label.length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_STATUS_STYLE', () => {
  it('provides a gray fallback', () => {
    expect(DEFAULT_STATUS_STYLE.color).toContain('gray');
    expect(DEFAULT_STATUS_STYLE.label).toBe('Unknown');
  });
});
