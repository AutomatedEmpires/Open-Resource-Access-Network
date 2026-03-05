/**
 * FormStepper — multi-step form wrapper with visual progress indicator.
 * Used for complex flows like claim submission.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

export interface Step {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface FormStepperProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function FormStepper({ steps, currentStep, className }: FormStepperProps) {
  return (
    <nav aria-label="Form progress" className={cn('w-full', className)}>
      <ol className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <li
              key={step.id}
              className={cn('flex items-center', index < steps.length - 1 && 'flex-1')}
            >
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-all duration-300',
                    isCompleted &&
                      'bg-green-500 text-white shadow-md ring-2 ring-green-200',
                    isCurrent &&
                      'bg-blue-600 text-white shadow-lg ring-4 ring-blue-200 scale-110',
                    !isCompleted &&
                      !isCurrent &&
                      'bg-gray-100 text-gray-400 border-2 border-gray-200',
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" aria-hidden="true" />
                  ) : step.icon ? (
                    <span aria-hidden="true">{step.icon}</span>
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium whitespace-nowrap',
                    isCurrent ? 'text-blue-700' : isCompleted ? 'text-green-700' : 'text-gray-400',
                  )}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'mx-2 h-0.5 flex-1 transition-colors duration-500',
                    isCompleted ? 'bg-green-400' : 'bg-gray-200',
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ── Stepper content wrapper ──────────────────────────────────── */

interface StepContentProps {
  active: boolean;
  children: React.ReactNode;
  className?: string;
}

export function StepContent({ active, children, className }: StepContentProps) {
  if (!active) return null;
  return (
    <div
      className={cn('animate-in fade-in slide-in-from-right-4 duration-300', className)}
      role="tabpanel"
    >
      {children}
    </div>
  );
}
