// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUnsavedChanges } from '@/lib/hooks/useUnsavedChanges';

describe('useUnsavedChanges', () => {
  it('returns true without prompting when form is clean', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderHook(() => useUnsavedChanges(false));

    expect(result.current.confirmLeave()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('prompts with custom message when form is dirty', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() => useUnsavedChanges(true, 'Leave this page?'));

    expect(result.current.confirmLeave()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith('Leave this page?');
    confirmSpy.mockRestore();
  });

  it('registers beforeunload guard and removes it on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useUnsavedChanges(true, 'Unsaved changes message'));

    const beforeUnloadHandler = addSpy.mock.calls.find(
      ([eventName]) => eventName === 'beforeunload',
    )?.[1] as EventListener;
    expect(beforeUnloadHandler).toBeTypeOf('function');

    const beforeUnload = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(beforeUnload, 'returnValue', {
      writable: true,
      value: '',
    });
    beforeUnloadHandler(beforeUnload);

    expect(beforeUnload.defaultPrevented).toBe(true);
    expect(beforeUnload.returnValue).toBe('Unsaved changes message');

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', beforeUnloadHandler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
