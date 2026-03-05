/**
 * TrustBadge — Displays verification trust level for a service or organization.
 *
 * Levels:
 *  - verified (green):           Admin-verified, high confidence
 *  - community_verified (yellow): Community-confirmed, moderate confidence
 *  - unverified (gray):          No verification yet
 *
 * Optionally shows "Last verified: X days ago".
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ============================================================
// VARIANTS
// ============================================================

const trustVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors',
  {
    variants: {
      level: {
        verified:
          'bg-green-100 text-green-800 ring-green-600/20',
        community_verified:
          'bg-yellow-100 text-yellow-800 ring-yellow-600/20',
        unverified:
          'bg-gray-100 text-gray-600 ring-gray-500/20',
      },
    },
    defaultVariants: {
      level: 'unverified',
    },
  },
);

// ============================================================
// TYPES
// ============================================================

export type TrustLevel = 'verified' | 'community_verified' | 'unverified';

export interface TrustBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof trustVariants> {
  /** Verification trust level */
  level: TrustLevel;
  /** When the entity was last verified (ISO 8601 string) */
  lastVerifiedAt?: string | null;
}

// ============================================================
// CONSTANTS
// ============================================================

const LEVEL_LABELS: Record<TrustLevel, string> = {
  verified: 'Verified',
  community_verified: 'Community Verified',
  unverified: 'Unverified',
};

const LEVEL_ICONS: Record<TrustLevel, string> = {
  verified: '✓',
  community_verified: '◐',
  unverified: '○',
};

// ============================================================
// HELPERS
// ============================================================

function formatDaysAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

// ============================================================
// COMPONENT
// ============================================================

export function TrustBadge({
  level,
  lastVerifiedAt,
  className,
  ...props
}: TrustBadgeProps) {
  const label = LEVEL_LABELS[level];
  const icon = LEVEL_ICONS[level];
  const daysAgo = lastVerifiedAt ? formatDaysAgo(lastVerifiedAt) : null;

  const titleText = daysAgo
    ? `${label} — Last verified ${daysAgo}`
    : label;

  return (
    <span
      className={cn(trustVariants({ level }), className)}
      title={titleText}
      aria-label={titleText}
      {...props}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
      {daysAgo && (
        <span className="ml-1 text-[10px] opacity-70">({daysAgo})</span>
      )}
    </span>
  );
}
