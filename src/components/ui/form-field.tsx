/**
 * FormField — wrapper component that provides label, inline error,
 * helper text, required indicator, and character counter for form inputs.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  /** htmlFor / id linking. */
  id?: string;
  /** Alias for id — use either. */
  htmlFor?: string;
  /** Visible label text. */
  label: string;
  /** Show red asterisk. */
  required?: boolean;
  /** Visually hide the label (still accessible to screen readers). */
  srOnlyLabel?: boolean;
  /** Helper text below the input. */
  hint?: string;
  /** Error message (from Zod or server). Overrides hint when present. */
  error?: string;
  /** Current char count for counter display. */
  charCount?: number;
  /** Max chars for counter display. */
  maxChars?: number;
  /** Alias for maxChars — use either. */
  maxLength?: number;
  /** Additional className on the wrapper div. */
  className?: string;
  children: React.ReactNode;
}

export function FormField({
  id: idProp,
  htmlFor,
  label,
  required,
  srOnlyLabel,
  hint,
  error,
  charCount,
  maxChars: maxCharsProp,
  maxLength,
  className,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const id = idProp ?? htmlFor ?? generatedId;
  const maxChars = maxCharsProp ?? maxLength;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hasError = Boolean(error);

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className={cn(
            'block text-sm font-medium',
            hasError ? 'text-red-700' : 'text-gray-700',
            srOnlyLabel && 'sr-only',
          )}
        >
          {label}
          {required && (
            <span className="text-red-500 ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </label>

        {maxChars != null && charCount != null && (
          <span
            className={cn(
              'text-xs tabular-nums',
              charCount > maxChars * 0.9 ? 'text-amber-600' : 'text-gray-400',
              charCount >= maxChars && 'text-red-500 font-medium',
            )}
            aria-live="polite"
          >
            {charCount}/{maxChars}
          </span>
        )}
      </div>

      {/* Clone-in aria attributes so the child input gets them */}
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        const childProps = child.props as Record<string, unknown>;
        const describedBy = new Set<string>();
        const existingDescribedBy = childProps['aria-describedby'];
        if (typeof existingDescribedBy === 'string') {
          for (const token of existingDescribedBy.split(/\s+/)) {
            if (token) describedBy.add(token);
          }
        }
        if (hint) describedBy.add(hintId);
        if (hasError) describedBy.add(errorId);

        return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
          id: childProps.id ?? id,
          required: childProps.required ?? required,
          'aria-required': childProps['aria-required'] ?? (required || undefined),
          'aria-invalid': hasError ? true : childProps['aria-invalid'],
          'aria-describedby': describedBy.size > 0 ? Array.from(describedBy).join(' ') : undefined,
        });
      })}

      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}

      {hasError && (
        <p id={errorId} className="text-sm text-red-600 flex items-center gap-1" role="alert">
          <svg
            className="h-3.5 w-3.5 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
