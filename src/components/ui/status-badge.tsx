/**
 * StatusBadge — shared component for rendering submission status pills.
 *
 * Uses the centralized SUBMISSION_STATUS_STYLES so every surface shows
 * identical colors and labels.
 */

import {
  SUBMISSION_STATUS_STYLES,
  DEFAULT_STATUS_STYLE,
  type StatusStyle,
} from '@/domain/status-styles';

export interface StatusBadgeProps {
  /** The raw status string (typically a SubmissionStatus value). */
  status: string;
  /**
   * Optional page-specific overrides. When provided, these are checked first.
   * Falls back to SUBMISSION_STATUS_STYLES → DEFAULT_STATUS_STYLE.
   */
  overrides?: Record<string, StatusStyle>;
}

export function StatusBadge({ status, overrides }: StatusBadgeProps) {
  const s = overrides?.[status]
    ?? SUBMISSION_STATUS_STYLES[status]
    ?? DEFAULT_STATUS_STYLE;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.color}`}
    >
      {s.label}
    </span>
  );
}
