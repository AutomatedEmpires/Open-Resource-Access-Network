/**
 * ToastProvider + useToast — lightweight toast notification system.
 * Provides success / error / warning / info toasts that stack and auto-dismiss.
 *
 * Guarantees:
 * - All timers are stored and cancelled on manual dismiss — no stale setState.
 * - Evicted toasts (cap overflow) have their timers cancelled immediately.
 * - All pending timers are cleared when ToastProvider unmounts.
 * - Errors use role="alert" (assertive) so screen readers interrupt immediately.
 */

'use client';

import * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toast: (variant: ToastVariant, message: string, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const MAX_TOASTS = 4;

/* ── Context ───────────────────────────────────────────────────── */

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/* ── Provider ──────────────────────────────────────────────────── */

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cancel all pending timers on unmount to prevent stale setState calls.
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    // Cancel the auto-dismiss timer so it never fires after manual dismiss.
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (variant: ToastVariant, message: string, duration = 4000) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      setToasts((prev) => {
        // Cancel timers for any toasts that will be evicted by the cap.
        if (prev.length >= MAX_TOASTS) {
          const evicted = prev.slice(0, prev.length - MAX_TOASTS + 1);
          evicted.forEach((t) => {
            const timer = timersRef.current.get(t.id);
            if (timer !== undefined) {
              clearTimeout(timer);
              timersRef.current.delete(t.id);
            }
          });
        }
        const capped = prev.length >= MAX_TOASTS ? prev.slice(prev.length - MAX_TOASTS + 1) : prev;
        return [...capped, { id, variant, message, duration }];
      });

      if (duration > 0) {
        const timer = setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
        timersRef.current.set(id, timer);
      }
    },
    [],
  );

  const value: ToastContextValue = React.useMemo(
    () => ({
      toast: addToast,
      success: (msg, dur) => addToast('success', msg, dur),
      error: (msg, dur) => addToast('error', msg, dur),
      warning: (msg, dur) => addToast('warning', msg, dur),
      info: (msg, dur) => addToast('info', msg, dur),
    }),
    [addToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast container — fixed bottom-right, clears mobile nav on small screens */}
      <div
        aria-live="polite"
        aria-atomic="false"
        aria-label="Notifications"
        className="fixed bottom-[4.5rem] right-4 z-[var(--z-toast)] flex flex-col gap-2 max-w-sm w-full pointer-events-none md:bottom-4"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Toast item ────────────────────────────────────────────────── */

const variantStyles: Record<ToastVariant, string> = {
  success: 'bg-green-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-amber-600 text-white',
  info: 'bg-blue-600 text-white',
};

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />,
  error: <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />,
  info: <Info className="h-4 w-4 shrink-0" aria-hidden="true" />,
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Errors use role="alert" (assertive) so screen readers interrupt immediately.
  // All other variants use role="status" (polite) to announce after current speech.
  const role = toast.variant === 'error' ? 'alert' : 'status';
  return (
    <div
      role={role}
      className={cn(
        'pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg animate-in slide-in-from-right fade-in duration-300',
        variantStyles[toast.variant],
      )}
    >
      {variantIcons[toast.variant]}
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md p-1 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 min-w-[28px] min-h-[28px] flex items-center justify-center"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
