/**
 * Breadcrumb — Accessible navigation breadcrumb trail.
 *
 * Renders a horizontal list of links showing the user's location
 * in the application hierarchy. Uses semantic <nav> with aria-label
 * and proper separator handling.
 *
 * @example
 * <Breadcrumb items={[
 *   { label: 'Home', href: '/' },
 *   { label: 'Admin', href: '/admin' },
 *   { label: 'Queue' },
 * ]} />
 */

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  /** Display text for this crumb */
  label: string;
  /** Link destination. Omit for the current (last) page. */
  href?: string;
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items, className, ...props }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('text-sm', className)} {...props}>
      <ol className="flex items-center gap-1.5 text-gray-500">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-gray-400 select-none">/</span>
              )}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="hover:text-gray-900 hover:underline transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(isLast && 'text-gray-900 font-medium')}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
