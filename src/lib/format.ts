/**
 * Shared formatting helpers used across ORAN admin/seeker pages.
 */

/**
 * Format an ISO date string as "Jan 5, 2025" (date only, US locale).
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format an ISO date string as "Jan 5, 2025, 02:30 PM" (date + time, US locale).
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Return the number of whole days between an ISO date and now.
 */
export function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Format an optional date string using the browser's full locale format.
 * Returns '—' for missing values, the raw string on parse failure.
 */
export function formatDateSafe(s?: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}
