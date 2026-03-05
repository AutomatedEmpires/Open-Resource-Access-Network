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
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const variantIcons: Record<AlertVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />,
  error: <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />,
  info: <Info className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />,
};

export function FormAlert({ variant, message, onDismiss, className }: FormAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-4 py-3 text-sm',
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
          className="shrink-0 rounded-md p-0.5 hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current min-w-[28px] min-h-[28px] flex items-center justify-center"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
