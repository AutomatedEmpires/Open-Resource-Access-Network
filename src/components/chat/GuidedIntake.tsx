'use client';

import React, { useId, useState } from 'react';
import { ArrowRight, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CRISIS_KEYWORDS } from '@/domain/constants';
import {
  buildGuidedIntakeSubmission,
  type GuidedIntakeDraft,
  type GuidedIntakeSubmission,
} from '@/domain/resourceNavigator';
import { parseGuidedIntakeRequest } from '@/services/chat/guidedIntakeValidation';
import { hasDistressSignals, normalizeSafetyText } from '@/services/security/crisisSignals';

interface GuidedIntakeProps {
  onSubmit: (submission: GuidedIntakeSubmission) => void | Promise<void>;
  submitLabel?: string;
  initialNeed?: string;
  className?: string;
  compact?: boolean;
}

export function GuidedIntake({
  onSubmit,
  submitLabel = 'Find help',
  initialNeed = '',
  className = '',
  compact = false,
}: GuidedIntakeProps) {
  const id = useId();
  const [draft, setDraft] = useState<GuidedIntakeDraft>({ need: initialNeed });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const hasMeaningfulNeed = Boolean(buildGuidedIntakeSubmission({ need: draft.need }));

  const updateDraft = <K extends keyof GuidedIntakeDraft>(
    key: K,
    value: GuidedIntakeDraft[K],
  ) => {
    setValidationError(null);
    setDraft((current) => ({
      ...current,
      [key]: key === 'need' ? value : value || undefined,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submission = buildGuidedIntakeSubmission(draft);
    if (!submission || isSubmitting) return;
    const { prompt: _prompt, ...request } = submission;
    const parsed = parseGuidedIntakeRequest(request);
    let submissionToSend = submission;
    if (!parsed.success) {
      const normalizedNeed = normalizeSafetyText(draft.need);
      const hasSafetyLanguage = CRISIS_KEYWORDS.some((keyword) => normalizedNeed.includes(keyword))
        || hasDistressSignals(draft.need);
      const safetySubmission = hasSafetyLanguage
        ? buildGuidedIntakeSubmission({ ...draft, location: undefined })
        : null;
      if (!safetySubmission) {
        setValidationError(
          parsed.message ?? 'Check the optional details and try again.',
        );
        return;
      }
      submissionToSend = safetySubmission;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(submissionToSend);
    } finally {
      setIsSubmitting(false);
    }
  };

  const locationField = (
    <label
      htmlFor={`${id}-location`}
      className={compact
        ? 'text-xs font-medium text-[var(--text-secondary)] sm:col-span-2'
        : 'mt-4 block text-sm font-semibold text-[var(--text-primary)]'}
    >
      City or ZIP <span className="font-normal text-[var(--text-muted)]">(optional)</span>
      <input
        id={`${id}-location`}
        value={draft.location ?? ''}
        onChange={(event) => updateDraft('location', event.target.value)}
        maxLength={80}
        placeholder="Example: Detroit, MI or 48201"
        aria-invalid={Boolean(validationError)}
        aria-describedby={validationError ? `${id}-validation` : undefined}
        className={compact
          ? 'mt-1.5 min-h-[44px] w-full rounded-xl border border-[var(--border-control)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-azure)]'
          : 'mt-2 min-h-[46px] w-full rounded-xl border border-[var(--border-control)] bg-white px-4 py-2.5 text-sm text-[var(--text-primary)] shadow-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-azure)]'}
      />
    </label>
  );

  return (
    <form onSubmit={handleSubmit} className={className} aria-label="Guided service intake">
      <label htmlFor={`${id}-need`} className="block text-sm font-semibold text-slate-950">
        What do you need help with?
      </label>
      <textarea
        id={`${id}-need`}
        value={draft.need}
        onChange={(event) => updateDraft('need', event.target.value)}
        rows={compact ? 2 : 3}
        maxLength={500}
        required
        placeholder="Example: I need help paying my electric bill this week."
        className={`mt-2 w-full bg-white px-4 py-3 text-[15px] leading-6 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none ${compact ? 'min-h-24 resize-none rounded-2xl border-0 shadow-none focus:ring-2 focus:ring-inset focus:ring-[var(--brand-azure)]' : 'min-h-28 resize-y rounded-xl border border-[var(--border-control)] shadow-sm focus:ring-2 focus:ring-[var(--brand-azure)]'}`}
      />

      {!compact && locationField}

      <details className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-alt)] text-left">
        <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {compact ? 'Filters: location, timing, access' : 'Add timing or access needs'}
          <span className="ml-auto text-xs font-normal text-[var(--text-muted)]">Optional</span>
        </summary>
        <div className="grid gap-4 border-t border-[var(--border-subtle)] px-4 py-4 sm:grid-cols-2">
          {compact && locationField}
          <label htmlFor={`${id}-urgency`} className="text-xs font-medium text-[var(--text-secondary)]">
            How soon?
            <select
              id={`${id}-urgency`}
              value={draft.urgency ?? ''}
              onChange={(event) => updateDraft('urgency', event.target.value as GuidedIntakeDraft['urgency'])}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[var(--border-control)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-azure)]"
            >
              <option value="">Not specified</option>
              <option value="today">Today</option>
              <option value="within_days">Within a few days</option>
              <option value="planning">Planning ahead</option>
            </select>
          </label>

          <label htmlFor={`${id}-audience`} className="text-xs font-medium text-[var(--text-secondary)]">
            Who is this for?
            <select
              id={`${id}-audience`}
              value={draft.audience ?? ''}
              onChange={(event) => updateDraft('audience', event.target.value as GuidedIntakeDraft['audience'])}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[var(--border-control)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-azure)]"
            >
              <option value="">Not specified</option>
              <option value="self">Me</option>
              <option value="child">A child</option>
              <option value="family">My family or household</option>
              <option value="someone_else">Someone else</option>
            </select>
          </label>

          <label htmlFor={`${id}-access`} className="text-xs font-medium text-[var(--text-secondary)] sm:col-span-2">
            How can you reach help?
            <select
              id={`${id}-access`}
              value={draft.accessMode ?? ''}
              onChange={(event) => updateDraft('accessMode', event.target.value as GuidedIntakeDraft['accessMode'])}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[var(--border-control)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-azure)]"
            >
              <option value="">Not specified</option>
              <option value="can_travel">I can travel</option>
              <option value="cannot_travel">I cannot travel</option>
              <option value="phone">Phone</option>
              <option value="online">Online</option>
            </select>
          </label>
        </div>
      </details>

      {validationError ? (
        <p id={`${id}-validation`} className="mt-3 text-sm font-medium text-red-700" role="alert">
          {validationError}
        </p>
      ) : null}

      <div className={`${compact ? 'mt-3 gap-2' : 'mt-4 gap-3'} flex flex-col sm:flex-row sm:items-center`}>
        <Button
          type="submit"
          size="lg"
          disabled={!hasMeaningfulNeed || isSubmitting}
          className={`min-h-[48px] gap-2 rounded-xl px-6 disabled:border disabled:border-[var(--border)] disabled:bg-[var(--bg-surface-alt)] disabled:text-[var(--text-secondary)] disabled:opacity-100 ${compact ? 'w-full sm:w-auto' : ''}`}
        >
          {isSubmitting ? 'Opening chat…' : submitLabel}
          {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <p className="text-xs leading-5 text-[var(--text-muted)]">
          Share only what is needed. Do not include Social Security numbers, full birth dates, case or account numbers, or passwords.
        </p>
      </div>
    </form>
  );
}
