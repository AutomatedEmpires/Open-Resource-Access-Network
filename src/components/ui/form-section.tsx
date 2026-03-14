'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FormSectionProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  header?: React.ReactNode;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

export function FormSection({
  title,
  description,
  action,
  header,
  labelledBy,
  describedBy,
  className,
  contentClassName,
  children,
}: FormSectionProps) {
  const sectionId = React.useId();
  const headingId = `${sectionId}-heading`;
  const descriptionId = `${sectionId}-description`;
  const hasChildren = React.Children.count(children) > 0;

  return (
    <section
      aria-labelledby={header ? labelledBy : headingId}
      aria-describedby={header ? describedBy : description ? descriptionId : undefined}
      className={cn('rounded-[24px] border border-orange-100/80 bg-white/92 p-5 shadow-[0_12px_32px_rgba(234,88,12,0.06)]', className)}
    >
      {header ? (
        header
      ) : (title || description || action) ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-stone-900">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-stone-600">
                {description}
              </p>
            )}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}

      {hasChildren ? <div className={cn('space-y-4', contentClassName)}>{children}</div> : null}
    </section>
  );
}
