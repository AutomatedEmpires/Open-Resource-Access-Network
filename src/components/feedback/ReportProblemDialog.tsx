/**
 * ReportProblemDialog — "Flag a problem" dialog for seekers
 *
 * Allows seekers to report issues with service listings (wrong info,
 * closed, wrong hours, etc.) without requiring sign-in.
 * Posts to /api/submissions/report (universal pipeline with notifications).
 * No PII collected.
 */

'use client';

import React, { useState } from 'react';
import {
  AlertTriangle, Loader2, MapPin, Phone,
  Clock, Ban, ShieldAlert, Copy, HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { FormSection } from '@/components/ui/form-section';

// ============================================================
// CONSTANTS
// ============================================================

const ISSUE_TYPES = [
  { value: 'incorrect_info',      label: 'Wrong information',    icon: AlertTriangle, color: 'text-amber-600' },
  { value: 'permanently_closed',  label: 'Permanently closed',   icon: Ban,           color: 'text-red-600' },
  { value: 'wrong_hours',         label: 'Wrong hours',          icon: Clock,         color: 'text-orange-600' },
  { value: 'wrong_location',      label: 'Wrong address',        icon: MapPin,        color: 'text-blue-600' },
  { value: 'wrong_phone',         label: 'Wrong phone number',   icon: Phone,         color: 'text-purple-600' },
  { value: 'wrong_eligibility',   label: 'Wrong eligibility',    icon: Ban,           color: 'text-red-500' },
  { value: 'suspected_fraud',     label: 'Safety concern',       icon: ShieldAlert,   color: 'text-red-700' },
  { value: 'duplicate_listing',   label: 'Duplicate listing',    icon: Copy,          color: 'text-gray-600' },
  { value: 'other',               label: 'Other issue',          icon: HelpCircle,    color: 'text-gray-500' },
] as const;

type IssueType = typeof ISSUE_TYPES[number]['value'];

// ============================================================
// COMPONENT
// ============================================================

interface ReportProblemDialogProps {
  serviceId: string;
  serviceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportProblemDialog({
  serviceId,
  serviceName,
  open,
  onOpenChange,
}: ReportProblemDialogProps) {
  const [issueType, setIssueType] = useState<IssueType | null>(null);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = () => {
    setIssueType(null);
    setComment('');
    setStatus('idle');
    setErrorMessage(null);
  };

  const handleSubmit = async () => {
    if (!issueType) return;
    setStatus('submitting');
    setErrorMessage(null);

    // The modern endpoint requires `details` (min 5 chars).
    // Use the comment if provided, otherwise derive from the selected label.
    const selectedLabel = ISSUE_TYPES.find((t) => t.value === issueType)?.label ?? issueType;
    const details = comment.trim() || `Reported issue: ${selectedLabel}`;

    try {
      const res = await fetch('/api/submissions/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          reason: issueType,
          details,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to submit report');
      }

      setStatus('success');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('error');
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset after animation completes
    setTimeout(reset, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Report a Problem
          </DialogTitle>
          <DialogDescription>
            Help us keep listings accurate. Flag an issue with <strong className="text-gray-800">{serviceName}</strong>.
          </DialogDescription>
        </DialogHeader>

        {status === 'success' ? (
          <div className="py-6 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">Thank you for your report!</p>
            <p className="text-xs text-gray-500">Our team will review this and update the listing if needed.</p>
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="space-y-4"
          >
            <FormSection
              title="What&apos;s the issue?"
              description="Choose the problem type that best matches what you saw in the listing."
            >
              <div className="grid grid-cols-2 gap-2">
                {ISSUE_TYPES.map(({ value, label, icon: Icon, color }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={issueType === value}
                    onClick={() => setIssueType(value)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all ${
                      issueType === value
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />
                    <span className="text-gray-700">{label}</span>
                  </button>
                ))}
              </div>
            </FormSection>

            <FormSection
              title="Additional details"
              description="Add optional context that can help reviewers verify and fix the issue faster."
            >
              <FormField
                id="report-comment"
                label="Additional details"
                hint="Optional — anything else we should know?"
                charCount={comment.length}
                maxChars={2000}
              >
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. The phone number listed goes to voicemail and is no longer in service..."
                  maxLength={2000}
                />
              </FormField>
            </FormSection>

            {errorMessage && (
              <FormAlert
                variant="error"
                message={errorMessage}
                onDismiss={() => setErrorMessage(null)}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={status === 'submitting'}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!issueType || status === 'submitting'}
                className="gap-1"
              >
                {status === 'submitting' ? (
                  <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Submitting…</>
                ) : (
                  'Submit Report'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
