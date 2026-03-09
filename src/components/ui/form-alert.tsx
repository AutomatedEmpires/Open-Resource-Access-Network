/**
 * FormAlert — consistent success / error / info banner for forms.
 * Replaces the ad-hoc `role="alert"` divs scattered across the app.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type AlertVariant = 'success' | 'error' | 'info' | 'warning';

export interface FormAlertProps {
  variant: AlertVariant;
  message: string;
  /** Optional dismiss handler — shows X button when provided. */
  onDismiss?: () => void;
  className?: string;
}

const variantStyles: Record<AlertVariant, string> = {
  success: 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 text-green-900',
  error: 'border-red-200 bg-gradient-to-br from-red-50 to-rose-50 text-red-900',
  warning: 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 text-amber-900',
  info: 'border-orange-200 bg-gradient-to-br from-orange-50 to-rose-50 text-orange-900',
};

const variantIcons: Record<AlertVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />,
  error: <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />,
  info: <Info className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />,
};

export function FormAlert({ variant, message, onDismiss, className }: FormAlertProps) {
  const isAssertive = variant === 'error' || variant === 'warning';

  return (
    <div
      role={isAssertive ? 'alert' : 'status'}
      aria-live={isAssertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        'flex items-start gap-2 rounded-[20px] border px-4 py-3 text-sm shadow-[0_10px_24px_rgba(15,23,42,0.04)]',
        variantStyles[variant],
        className,
      )}
    >
      {variantIcons[variant]}
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex min-h-[28px] min-w-[28px] shrink-0 items-center justify-center rounded-md p-0.5 hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
