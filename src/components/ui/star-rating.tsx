/**
 * StarRating — accessible star rating input with proper ARIA radio pattern,
 * arrow-key navigation, hover preview, and fill animation.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface StarRatingProps {
  /** Current value (1-5 or null). */
  value: number | null;
  /** Called when user selects a rating. */
  onChange: (rating: number) => void;
  /** Number of stars (default 5). */
  max?: number;
  /** Disable interaction. */
  disabled?: boolean;
  /** Size variant. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

const containerSizeClasses = {
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2',
};

export function StarRating({
  value,
  onChange,
  max = 5,
  disabled = false,
  size = 'md',
  className,
}: StarRatingProps) {
  const [hoverValue, setHoverValue] = React.useState<number | null>(null);
  const groupRef = React.useRef<HTMLDivElement>(null);

  const displayValue = hoverValue ?? value ?? 0;

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent, starIndex: number) => {
      if (disabled) return;

      let nextIndex = starIndex;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          e.preventDefault();
          nextIndex = Math.min(starIndex + 1, max);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          e.preventDefault();
          nextIndex = Math.max(starIndex - 1, 1);
          break;
        case 'Home':
          e.preventDefault();
          nextIndex = 1;
          break;
        case 'End':
          e.preventDefault();
          nextIndex = max;
          break;
        default:
          return;
      }

      onChange(nextIndex);

      // Move focus to the selected star
      const buttons = groupRef.current?.querySelectorAll('[role="radio"]');
      (buttons?.[nextIndex - 1] as HTMLElement)?.focus();
    },
    [disabled, max, onChange],
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Rating"
      className={cn('inline-flex items-center', containerSizeClasses[size], className)}
      onMouseLeave={() => setHoverValue(null)}
    >
      {Array.from({ length: max }, (_, i) => {
        const starNum = i + 1;
        const isSelected = value === starNum;
        const isFilled = starNum <= displayValue;

        return (
          <button
            key={starNum}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${starNum} star${starNum > 1 ? 's' : ''}`}
            tabIndex={isSelected || (value === null && starNum === 1) ? 0 : -1}
            disabled={disabled}
            className={cn(
              'relative rounded-md p-0.5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
              'min-w-[44px] min-h-[44px] flex items-center justify-center',
              disabled
                ? 'cursor-default opacity-50'
                : 'cursor-pointer hover:scale-110 active:scale-95',
            )}
            onClick={() => !disabled && onChange(starNum)}
            onMouseEnter={() => !disabled && setHoverValue(starNum)}
            onKeyDown={(e) => handleKeyDown(e, starNum)}
          >
            <svg
              className={cn(
                sizeClasses[size],
                'transition-colors duration-200',
                isFilled ? 'text-amber-400 drop-shadow-sm' : 'text-gray-300',
              )}
              viewBox="0 0 24 24"
              fill={isFilled ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
              />
            </svg>

            {/* Pulse on click */}
            {isSelected && !disabled && (
              <span
                className="absolute inset-0 rounded-full bg-amber-300/30 animate-ping pointer-events-none"
                style={{ animationIterationCount: 1, animationDuration: '0.6s' }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
