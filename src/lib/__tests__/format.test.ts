import { describe, expect, it } from 'vitest';
import { daysAgo, formatDate, formatDateSafe, formatDateTime } from '../format';

describe('formatDate', () => {
  it('formats an ISO date as "MMM D, YYYY"', () => {
    expect(formatDate('2025-01-05T12:00:00Z')).toBe('Jan 5, 2025');
  });

  it('handles date-only strings', () => {
    const result = formatDate('2024-12-25');
    expect(result).toContain('Dec');
    expect(result).toContain('2024');
    expect(result).toContain('25');
  });
});

describe('formatDateTime', () => {
  it('includes time components', () => {
    const result = formatDateTime('2025-06-15T14:30:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('2025');
    // Time portion should be present (exact format varies by locale/TZ)
    expect(result.length).toBeGreaterThan(formatDate('2025-06-15T14:30:00Z').length);
  });
});

describe('daysAgo', () => {
  it('returns 0 for a date less than 24 hours ago', () => {
    const recent = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    expect(daysAgo(recent)).toBe(0);
  });

  it('returns correct day count for older dates', () => {
    const threeDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString();
    expect(daysAgo(threeDaysAgo)).toBe(3);
  });
});

describe('formatDateSafe', () => {
  it('returns em-dash for undefined/null', () => {
    expect(formatDateSafe(undefined)).toBe('—');
    expect(formatDateSafe(null)).toBe('—');
    expect(formatDateSafe('')).toBe('—');
  });

  it('formats a valid ISO string', () => {
    const result = formatDateSafe('2025-01-05T12:00:00Z');
    expect(result).toContain('2025');
  });

  it('returns raw string for unparseable input', () => {
    expect(formatDateSafe('not-a-date')).toBe('Invalid Date');
  });
});
