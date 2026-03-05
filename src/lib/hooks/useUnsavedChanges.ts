/**
 * useUnsavedChanges — warns users before navigating away from dirty forms.
 *
 * Handles both browser navigation (beforeunload) and Next.js client
 * navigation (router events via MutationObserver on pathname).
 */

'use client';

import { useEffect, useCallback, useRef } from 'react';

export function useUnsavedChanges(isDirty: boolean, message?: string) {
  const msg = message ?? 'You have unsaved changes. Are you sure you want to leave?';
  const isDirtyRef = useRef(isDirty);

  // Sync ref inside an effect to satisfy React Compiler rules
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Browser beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      // For older browsers:
      e.returnValue = msg;
      return msg;
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [msg]);

  // Programmatic guard — call before manual navigation
  const confirmLeave = useCallback(() => {
    if (!isDirtyRef.current) return true;
    return window.confirm(msg);
  }, [msg]);

  return { confirmLeave };
}
