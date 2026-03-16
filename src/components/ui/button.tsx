/**
 * ORAN Button Component
 * shadcn-style button using class-variance-authority.
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-wide transition-[var(--transition-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:
          'bg-action-base text-white shadow-sm hover:bg-action-strong',
        destructive:
          'bg-error-base text-white shadow-sm hover:bg-error-strong',
        outline:
          'border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm hover:bg-[var(--bg-surface-alt)] hover:border-[var(--text-secondary)]',
        secondary:
          'bg-[var(--bg-surface-alt)] text-[var(--text-primary)] shadow-sm hover:bg-[var(--border)]',
        ghost:
          'hover:bg-[var(--bg-surface-alt)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        link:
          'text-[var(--text-primary)] underline-offset-4 hover:underline',
        crisis:
          'bg-error-strong text-white shadow hover:bg-error-deep font-bold tracking-wide',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-8 px-3 text-xs',
        lg:      'h-10 px-8',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
