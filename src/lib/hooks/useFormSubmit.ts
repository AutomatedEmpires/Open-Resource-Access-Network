/**
 * useFormSubmit — shared hook for form submissions with loading, error,
 * field-level validation, and success state.
 *
 * Reduces boilerplate across all ORAN forms.
 */

'use client';

import { useCallback, useState, useRef } from 'react';
import type { ZodSchema, ZodError } from 'zod';

/* ── Types ─────────────────────────────────────────────────────── */

export interface FieldError {
  path: string;
  message: string;
}

export interface UseFormSubmitOptions<TPayload, TResult> {
  /** The API endpoint to POST/PUT/PATCH/DELETE to. */
  url: string | ((payload: TPayload) => string);
  /** HTTP method (default POST). */
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Optional Zod schema for client-side validation. */
  schema?: ZodSchema<TPayload>;
  /** Transform form state before sending (strip empty strings, etc.). */
  transform?: (payload: TPayload) => Record<string, unknown>;
  /** Called on successful response (after JSON parse). */
  onSuccess?: (result: TResult, payload: TPayload) => void;
  /** Called on error (after setting internal error state). */
  onError?: (error: string, fieldErrors: FieldError[]) => void;
}

export interface UseFormSubmitReturn<TPayload> {
  /** Call this to submit. */
  submit: (payload: TPayload) => Promise<boolean>;
  /** True while the fetch is in-flight. */
  submitting: boolean;
  /** Top-level error message (from server or catch). */
  error: string | null;
  /** Per-field validation errors from Zod or server. */
  fieldErrors: FieldError[];
  /** True after a successful submission (resets on next submit). */
  succeeded: boolean;
  /** Clear all error state. */
  clearErrors: () => void;
  /** Clear success state. */
  clearSuccess: () => void;
}

/* ── Hook ──────────────────────────────────────────────────────── */

export function useFormSubmit<TPayload, TResult = unknown>(
  options: UseFormSubmitOptions<TPayload, TResult>,
): UseFormSubmitReturn<TPayload> {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [succeeded, setSucceeded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const clearErrors = useCallback(() => {
    setError(null);
    setFieldErrors([]);
  }, []);

  const clearSuccess = useCallback(() => {
    setSucceeded(false);
  }, []);

  const submit = useCallback(
    async (payload: TPayload): Promise<boolean> => {
      // Reset state
      setError(null);
      setFieldErrors([]);
      setSucceeded(false);

      // Client-side Zod validation
      if (options.schema) {
        const result = options.schema.safeParse(payload);
        if (!result.success) {
          const zodError = result.error as ZodError;
          const errors: FieldError[] = zodError.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          }));
          setFieldErrors(errors);
          setError(errors[0]?.message ?? 'Validation failed');
          options.onError?.(errors[0]?.message ?? 'Validation failed', errors);
          return false;
        }
      }

      setSubmitting(true);

      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const url =
          typeof options.url === 'function'
            ? options.url(payload)
            : options.url;

        const body = options.transform
          ? options.transform(payload)
          : (payload as Record<string, unknown>);

        const res = await fetch(url, {
          method: options.method ?? 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg =
            (data as Record<string, unknown>).error?.toString() ??
            `Request failed (${res.status})`;

          // Try to parse field-level errors from server response
          const serverFieldErrors: FieldError[] = [];
          if (Array.isArray((data as Record<string, unknown>).fieldErrors)) {
            for (const fe of (data as Record<string, unknown>).fieldErrors as FieldError[]) {
              serverFieldErrors.push({ path: fe.path, message: fe.message });
            }
          }

          setError(msg);
          setFieldErrors(serverFieldErrors);
          options.onError?.(msg, serverFieldErrors);
          return false;
        }

        setSucceeded(true);
        options.onSuccess?.(data as TResult, payload);
        return true;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return false;
        const msg = (err as Error).message || 'An unexpected error occurred';
        setError(msg);
        options.onError?.(msg, []);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [options],
  );

  return {
    submit,
    submitting,
    error,
    fieldErrors,
    succeeded,
    clearErrors,
    clearSuccess,
  };
}
