'use client';

import React, { useId, useState } from 'react';
import { ArrowRight, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  buildGuidedIntakePrompt,
  type GuidedIntakeDraft,
} from '@/domain/resourceNavigator';

interface GuidedIntakeProps {
  onSubmit: (prompt: string) => void | Promise<void>;
  submitLabel?: string;
  initialNeed?: string;
  className?: string;
}

export function GuidedIntake({
  onSubmit,
  submitLabel = 'Find my next step',
  initialNeed = '',
  className = '',
}: GuidedIntakeProps) {
  const id = useId();
  const [draft, setDraft] = useState<GuidedIntakeDraft>({ need: initialNeed });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateDraft = <K extends keyof GuidedIntakeDraft>(
    key: K,
    value: GuidedIntakeDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value || undefined }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = buildGuidedIntakePrompt(draft);
    if (!prompt || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(prompt);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className} aria-label="Guided service intake">
      <label htmlFor={`${id}-need`} className="block text-sm font-semibold text-slate-950">
        What do you need help with right now?
      </label>
      <textarea
        id={`${id}-need`}
        value={draft.need}
        onChange={(event) => updateDraft('need', event.target.value)}
        rows={3}
        maxLength={500}
        required
        placeholder="Example: My power may be shut off this week and I need help with the bill."
        className="mt-2 min-h-28 w-full resize-y rounded-[20px] border border-slate-300 bg-white px-4 py-3 text-[15px] leading-6 text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />

      <details className="mt-3 rounded-[18px] border border-slate-200 bg-slate-50 text-left">
        <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="h-4 w-4 text-slate-500" aria-hidden="true" />
          Add details only if they matter
          <span className="ml-auto text-xs font-normal text-slate-500">Optional</span>
        </summary>
        <div className="grid gap-4 border-t border-slate-200 px-4 py-4 sm:grid-cols-2">
          <label htmlFor={`${id}-location`} className="text-xs font-medium text-slate-700">
            City or ZIP
            <input
              id={`${id}-location`}
              value={draft.location ?? ''}
              onChange={(event) => updateDraft('location', event.target.value)}
              maxLength={80}
              placeholder="Coeur d’Alene or 83814"
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </label>

          <label htmlFor={`${id}-urgency`} className="text-xs font-medium text-slate-700">
            How soon?
            <select
              id={`${id}-urgency`}
              value={draft.urgency ?? ''}
              onChange={(event) => updateDraft('urgency', event.target.value as GuidedIntakeDraft['urgency'])}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="">Not specified</option>
              <option value="today">Today</option>
              <option value="within_days">Within a few days</option>
              <option value="planning">Planning ahead</option>
            </select>
          </label>

          <label htmlFor={`${id}-audience`} className="text-xs font-medium text-slate-700">
            Who is this for?
            <select
              id={`${id}-audience`}
              value={draft.audience ?? ''}
              onChange={(event) => updateDraft('audience', event.target.value as GuidedIntakeDraft['audience'])}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="">Not specified</option>
              <option value="self">Me</option>
              <option value="child">A child</option>
              <option value="family">My family or household</option>
              <option value="someone_else">Someone else</option>
            </select>
          </label>

          <label htmlFor={`${id}-access`} className="text-xs font-medium text-slate-700">
            How can you reach help?
            <select
              id={`${id}-access`}
              value={draft.accessMode ?? ''}
              onChange={(event) => updateDraft('accessMode', event.target.value as GuidedIntakeDraft['accessMode'])}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
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

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          size="lg"
          disabled={!draft.need.trim() || isSubmitting}
          className="min-h-[48px] gap-2 rounded-full px-6"
        >
          {isSubmitting ? 'Opening chat…' : submitLabel}
          {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <p className="text-xs leading-5 text-slate-500">
          Share only what is needed. Do not include a Social Security number, full birth date, or case number.
        </p>
      </div>
    </form>
  );
}
