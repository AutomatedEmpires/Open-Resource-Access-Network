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
      className={cn('rounded-xl border border-gray-200 bg-white p-5 shadow-sm', className)}
    >
      {header ? (
        header
      ) : (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-gray-900">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-gray-600">
                {description}
              </p>
            )}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}

      {hasChildren ? <div className={cn('space-y-4', contentClassName)}>{children}</div> : null}
    </section>
  );
}
