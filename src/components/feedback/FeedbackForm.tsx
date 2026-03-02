/**
 * Feedback Form Component
 *
 * Inline feedback form for service cards. Submits to POST /api/feedback.
 * Includes star rating (required), contact success toggle, and optional comment.
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Star, X, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FeedbackFormProps {
  serviceId: string;
  sessionId: string;
  onClose: () => void;
  onSubmit?: () => void;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export function FeedbackForm({ serviceId, sessionId, onClose, onSubmit }: FeedbackFormProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);
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
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
        <Check className="h-6 w-6 mx-auto text-green-600 mb-2" aria-hidden="true" />
        <p className="text-sm text-green-800 font-medium">Thank you for your feedback!</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-900">Give feedback</h4>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-gray-200 transition-colors"
          aria-label="Close feedback form"
        >
          <X className="h-4 w-4 text-gray-500" aria-hidden="true" />
        </button>
      </div>

      {/* Star rating - required */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          How helpful was this service info? <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(null)}
              className="p-1 rounded-md hover:bg-gray-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
              aria-pressed={rating === star}
            >
              <Star
                className={`h-6 w-6 ${
                  (hoveredRating !== null ? star <= hoveredRating : star <= (rating ?? 0))
                    ? 'text-yellow-500 fill-yellow-500'
                    : 'text-gray-300'
                }`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>

      {/* Contact success - optional */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Were you able to contact this service?
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setContactSuccess(true)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors min-h-[44px] ${
              contactSuccess === true
                ? 'bg-green-100 text-green-800 border border-green-300'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            aria-pressed={contactSuccess === true}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setContactSuccess(false)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors min-h-[44px] ${
              contactSuccess === false
                ? 'bg-red-100 text-red-800 border border-red-300'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            aria-pressed={contactSuccess === false}
          >
            No
          </button>
        </div>
      </div>

      {/* Comment - optional */}
      <div className="mb-3">
        <label htmlFor="feedback-comment" className="block text-xs font-medium text-gray-700 mb-1">
          Additional comments (optional)
        </label>
        <textarea
          id="feedback-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 500))}
          placeholder="Share your experience..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          maxLength={500}
        />
        <p className="text-xs text-gray-400 text-right">{comment.length}/500</p>
      </div>

      {/* Error message */}
      {submitState === 'error' && errorMessage && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* Submit button */}
      <Button
        type="button"
        size="sm"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full"
      >
        {submitState === 'submitting' ? 'Submitting...' : 'Submit feedback'}
      </Button>
    </div>
  );
}

export default FeedbackForm;
