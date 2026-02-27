/**
 * ORAN Badge Component
 * Displays confidence band with appropriate color coding.
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ConfidenceBand } from '@/domain/types';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        /** HIGH confidence — green */
        HIGH:
          'bg-green-100 text-green-800 ring-1 ring-inset ring-green-600/20',
        /** MEDIUM confidence — yellow */
        MEDIUM:
          'bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-600/20',
        /** LOW confidence — orange */
        LOW:
          'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-600/20',
        /** UNVERIFIED — gray */
        UNVERIFIED:
          'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-500/20',
        default:
          'bg-gray-100 text-gray-800 ring-1 ring-inset ring-gray-500/20',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  band?: ConfidenceBand;
}

const BAND_LABELS: Record<ConfidenceBand, string> = {
  HIGH:       'High confidence',
  MEDIUM:     'Medium confidence',
  LOW:        'Low confidence',
  UNVERIFIED: 'Unverified',
};

function Badge({ className, variant, band, children, ...props }: BadgeProps) {
  const effectiveVariant = band ?? variant ?? 'default';
  const label = band ? BAND_LABELS[band] : undefined;

  return (
    <span
      className={cn(badgeVariants({ variant: effectiveVariant as VariantProps<typeof badgeVariants>['variant'], className }))}
      title={label}
      aria-label={label}
      {...props}
    >
      {children ?? label}
    </span>
  );
}

export { Badge, badgeVariants };
