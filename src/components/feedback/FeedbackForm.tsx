/**
 * Feedback Form Component
 *
 * Inline feedback form for service cards. Submits to POST /api/feedback.
 * Includes accessible star rating, contact success toggle, and optional comment.
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StarRating } from '@/components/ui/star-rating';
import { FormField } from '@/components/ui/form-field';

interface FeedbackFormProps {
  serviceId: string;
  sessionId: string;
  onClose: () => void;
  onSubmit?: () => void;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export function FeedbackForm({ serviceId, sessionId, onClose, onSubmit }: FeedbackFormProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [contactSuccess, setContactSuccess] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = rating !== null && submitState !== 'submitting';

  const handleSubmit = useCallback(async () => {
    if (!rating) return;

    setSubmitState('submitting');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          sessionId,
          rating,
          comment: comment.trim() || undefined,
          contactSuccess: contactSuccess ?? undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to submit feedback');
      }

      setSubmitState('success');
      onSubmit?.();

      // Auto-close after 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (e) {
      setSubmitState('error');
      setErrorMessage(e instanceof Error ? e.message : 'Failed to submit feedback');
    }
  }, [rating, comment, contactSuccess, serviceId, sessionId, onSubmit, onClose]);

  // Reset state when form closes
  useEffect(() => {
    return () => {
      setRating(null);
      setComment('');
      setContactSuccess(null);
      setSubmitState('idle');
    };
  }, []);

  if (submitState === 'success') {
    return (
      <div className="rounded-lg border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-5 text-center shadow-sm">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-white">
          <Check className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="text-sm text-green-800 font-semibold">Thank you for your feedback!</p>
        <p className="text-xs text-green-600 mt-1">Your input helps keep ORAN accurate.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-gray-900">Rate this service info</h4>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-gray-100 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close feedback form"
        >
          <X className="h-4 w-4 text-gray-400" aria-hidden="true" />
        </button>
      </div>

      {/* Star rating - accessible radio group */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-2">
          How helpful was this? <span className="text-red-500">*</span>
        </label>
        <StarRating value={rating} onChange={setRating} size="md" />
        {rating && (
          <p className="mt-1 text-xs text-amber-600 font-medium animate-in fade-in duration-200">
            {['', 'Not helpful', 'Slightly helpful', 'Helpful', 'Very helpful', 'Extremely helpful'][rating]}
          </p>
        )}
      </div>

      {/* Contact success - toggle pills */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Were you able to contact this service?
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setContactSuccess(contactSuccess === true ? null : true)}
            className={`px-4 py-2 rounded-full text-xs font-medium transition-all min-h-[44px] ${
              contactSuccess === true
                ? 'bg-green-100 text-green-800 border-2 border-green-400 shadow-sm'
                : 'bg-gray-50 border-2 border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
            aria-pressed={contactSuccess === true}
          >
            {contactSuccess === true && <Check className="h-3 w-3 inline mr-1" aria-hidden="true" />}
            Yes
          </button>
          <button
            type="button"
            onClick={() => setContactSuccess(contactSuccess === false ? null : false)}
            className={`px-4 py-2 rounded-full text-xs font-medium transition-all min-h-[44px] ${
              contactSuccess === false
                ? 'bg-red-100 text-red-800 border-2 border-red-400 shadow-sm'
                : 'bg-gray-50 border-2 border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
            aria-pressed={contactSuccess === false}
          >
            {contactSuccess === false && <X className="h-3 w-3 inline mr-1" aria-hidden="true" />}
            No
          </button>
        </div>
      </div>

      {/* Comment */}
      <FormField
        id="feedback-comment"
        label="Additional comments"
        hint="Optional — share your experience."
        charCount={comment.length}
        maxChars={500}
        className="mb-4"
      >
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 500))}
          placeholder="Tell us more..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px]"
          rows={2}
          maxLength={500}
        />
      </FormField>

      {/* Error message */}
      {submitState === 'error' && errorMessage && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* Submit */}
      <Button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full gap-2"
      >
        {submitState === 'submitting' ? (
          <>
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
            Submitting…
          </>
        ) : (
          'Submit Feedback'
        )}
      </Button>
    </div>
  );
}

export default FeedbackForm;
