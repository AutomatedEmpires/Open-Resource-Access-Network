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
        HIGH:
          'border border-slate-900 bg-slate-900 text-white',
        LIKELY:
          'border border-slate-300 bg-slate-100 text-slate-900',
        POSSIBLE:
          'border border-slate-200 bg-white text-slate-700',
        default:
          'border border-slate-200 bg-white text-slate-700',
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
  HIGH: 'High confidence',
  LIKELY: 'Likely — confirm hours/eligibility',
  POSSIBLE: "Possible — here's what to verify",
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
