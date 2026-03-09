/**
 * ORAN Button Component
 * shadcn-style button using class-variance-authority.
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[var(--transition-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-action-base text-white shadow-[0_10px_24px_rgba(249,115,22,0.24)] hover:bg-action-strong',
        destructive:
          'bg-error-base text-white shadow-sm hover:bg-error-strong',
        outline:
          'border border-orange-100 bg-[var(--bg-surface)] text-stone-700 shadow-sm hover:bg-orange-50 hover:text-stone-900 dark:hover:bg-slate-700',
        secondary:
          'bg-orange-100 text-stone-900 shadow-sm hover:bg-orange-200',
        ghost:
          'hover:bg-orange-50 hover:text-stone-900',
        link:
          'text-action-base underline-offset-4 hover:underline',
        crisis:
          'bg-error-strong text-white shadow hover:bg-error-deep font-bold',
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
