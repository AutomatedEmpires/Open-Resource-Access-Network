/**
 * ORAN Skeleton Component
 * Loading placeholder that respects prefers-reduced-motion.
 */

import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render a circular skeleton (e.g. avatar placeholder) */
  circle?: boolean;
}

export function Skeleton({ className, circle, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-gray-200 motion-safe:animate-pulse',
        circle ? 'rounded-full' : 'rounded-md',
        className,
      )}
      {...props}
    />
  );
}

/* ── Preset compositions ── */

/** Card-shaped skeleton matching ORAN service card dimensions */
export function SkeletonCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border border-gray-200 rounded-lg p-4 space-y-3', className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

/** Inline text line skeleton */
export function SkeletonLine({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Skeleton className={cn('h-4 w-full', className)} {...props} />;
}
