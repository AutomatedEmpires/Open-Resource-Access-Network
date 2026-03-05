// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useFormSubmit } from '@/lib/hooks/useFormSubmit';

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('useFormSubmit', () => {
  it('returns validation errors and skips fetch when schema fails', async () => {
    const onError = vi.fn();
    const schema = z.object({
      name: z.string().min(2, 'Name is required'),
    });

    const { result } = renderHook(() =>
      useFormSubmit<{ name: string }>({
        url: '/api/forms',
        schema,
        onError,
      }),
    );

    let success = true;
    await act(async () => {
      success = await result.current.submit({ name: '' });
    });

    expect(success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
    expect(result.current.succeeded).toBe(false);
    expect(result.current.error).toBe('Name is required');
    expect(result.current.fieldErrors).toEqual([
      { path: 'name', message: 'Name is required' },
    ]);
    expect(onError).toHaveBeenCalledWith('Name is required', [
      { path: 'name', message: 'Name is required' },
    ]);
  });

  it('submits successfully with transformed payload and custom method', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ saved: true }),
    });

    const { result } = renderHook(() =>
      useFormSubmit<{ id: string }, { saved: boolean }>({
        url: (payload) => `/api/forms/${payload.id}`,
        method: 'PUT',
        transform: (payload) => ({ identifier: payload.id }),
        onSuccess,
        onError,
      }),
    );

    let success = false;
    await act(async () => {
      success = await result.current.submit({ id: 'abc' });
    });

    expect(success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/forms/abc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'abc' }),
      signal: expect.any(AbortSignal),
    });
    expect(result.current.error).toBeNull();
    expect(result.current.fieldErrors).toEqual([]);
    expect(result.current.succeeded).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith({ saved: true }, { id: 'abc' });
    expect(onError).not.toHaveBeenCalled();

    act(() => {
      result.current.clearSuccess();
    });
    expect(result.current.succeeded).toBe(false);
  });

  it('surfaces server errors and field-level errors from response payload', async () => {
    const onError = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({
        error: 'Validation failed',
        fieldErrors: [{ path: 'email', message: 'Invalid email' }],
      }),
    });

    const { result } = renderHook(() =>
      useFormSubmit<{ email: string }>({
        url: '/api/forms',
        onError,
      }),
    );

    let success = true;
    await act(async () => {
      success = await result.current.submit({ email: 'bad' });
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Validation failed');
    expect(result.current.fieldErrors).toEqual([
      { path: 'email', message: 'Invalid email' },
    ]);
    expect(onError).toHaveBeenCalledWith('Validation failed', [
      { path: 'email', message: 'Invalid email' },
    ]);

    act(() => {
      result.current.clearErrors();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.fieldErrors).toEqual([]);
  });

  it('falls back to status-based messages when non-ok responses are not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('bad json')),
    });

    const { result } = renderHook(() =>
      useFormSubmit<{ name: string }>({
        url: '/api/forms',
      }),
    );

    let success = true;
    await act(async () => {
      success = await result.current.submit({ name: 'x' });
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Request failed (500)');
    expect(result.current.fieldErrors).toEqual([]);
  });

  it('handles thrown network errors', async () => {
    const onError = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error('Network down'));

    const { result } = renderHook(() =>
      useFormSubmit<{ name: string }>({
        url: '/api/forms',
        onError,
      }),
    );

    let success = true;
    await act(async () => {
      success = await result.current.submit({ name: 'test' });
    });

    expect(success).toBe(false);
    expect(result.current.error).toBe('Network down');
    expect(onError).toHaveBeenCalledWith('Network down', []);
  });

  it('aborts in-flight submissions when a new submit starts', async () => {
    let firstSignal: AbortSignal | undefined;
    fetchMock
      .mockImplementationOnce((_url: string, init: RequestInit | undefined) => {
        firstSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          firstSignal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            Object.assign(err, { name: 'AbortError' });
            reject(err);
          });
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ ok: true }),
      });

    const { result } = renderHook(() =>
      useFormSubmit<{ value: string }, { ok: boolean }>({
        url: '/api/forms',
      }),
    );

    let firstResult: Promise<boolean> | null = null;
    let secondResult = false;
    await act(async () => {
      firstResult = result.current.submit({ value: 'first' });
      secondResult = await result.current.submit({ value: 'second' });
    });

    expect(secondResult).toBe(true);
    await expect(firstResult).resolves.toBe(false);
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(result.current.submitting).toBe(false);
    });
  });
});
