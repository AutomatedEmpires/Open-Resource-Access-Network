/**
 * SuccessCelebration — a brief celebration animation after form success.
 * Shows confetti-like burst with a checkmark, then fades out.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SuccessCelebrationProps {
  /** Bold heading text. Falls back to message if not provided. */
  title?: string;
  /** The message to show (used as heading if no title). */
  message: string;
  /** Sub-message or next step hint. */
  subtitle?: string;
  /** Called when the celebration is dismissed (click or auto-timeout). */
  onDone?: () => void;
  /** Alias for onDone — called on dismiss. */
  onDismiss?: () => void;
  /** Auto-dismiss after N ms (default: 4000). Set 0 to disable. */
  timeout?: number;
  className?: string;
}

export function SuccessCelebration({
  title,
  message,
  subtitle,
  onDone,
  onDismiss,
  timeout = 4000,
  className,
}: SuccessCelebrationProps) {
  const handleDone = onDone ?? onDismiss;
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    if (timeout <= 0) return;
    const timer = setTimeout(() => {
      setVisible(false);
      handleDone?.();
    }, timeout);
    return () => clearTimeout(timer);
  }, [timeout, handleDone]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'relative overflow-hidden rounded-xl border-2 border-green-300 bg-gradient-to-br from-green-50 to-emerald-50 p-6 text-center shadow-lg animate-in fade-in zoom-in-95 duration-300',
        className,
      )}
    >
      {/* Confetti dots */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {[...Array(12)].map((_, i) => (
          <span
            key={i}
            className="absolute inline-block h-2 w-2 rounded-full opacity-60"
            style={{
              backgroundColor: ['#34d399', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#fb923c'][i % 6],
              left: `${8 + (i * 7.5)}%`,
              top: `${10 + Math.sin(i * 1.2) * 25}%`,
              animation: `confetti-fall ${1.5 + i * 0.15}s ease-out forwards`,
              animationDelay: `${i * 0.08}s`,
            }}
          />
        ))}
      </div>

      {/* Checkmark circle */}
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-md">
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" className="animate-draw-check" />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-green-800">{title ?? message}</h3>
      {title && <p className="mt-0.5 text-sm text-green-700">{message}</p>}
      {subtitle && <p className="mt-1 text-sm text-green-600">{subtitle}</p>}

      {handleDone && (
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            handleDone();
          }}
          className="mt-4 inline-flex items-center gap-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
        >
          Continue
        </button>
      )}

      {/* Keyframe styles */}
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) scale(0); opacity: 0; }
          30%  { opacity: 0.8; transform: translateY(0) scale(1.2); }
          100% { transform: translateY(60px) scale(0.6) rotate(180deg); opacity: 0; }
        }
        @keyframes draw-check {
          0%   { stroke-dasharray: 30; stroke-dashoffset: 30; }
          100% { stroke-dashoffset: 0; }
        }
        .animate-draw-check {
          stroke-dasharray: 30;
          animation: draw-check 0.5s ease-out 0.2s forwards;
          stroke-dashoffset: 30;
        }
      `}</style>
    </div>
  );
}
