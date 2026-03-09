// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addServerSaved,
  emitSavedServicesUpdated,
  fetchServerSavedIds,
  readStoredSavedServiceCount,
  readStoredSavedServiceIds,
  readStoredSavedServiceIdSet,
  removeServerSaved,
  SAVED_SERVICES_UPDATED_EVENT,
  SAVED_SERVICE_STORAGE_KEY,
  writeStoredSavedServiceIds,
} from '../client';

describe('saved client helpers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads saved ids from local storage and filters invalid entries', () => {
    localStorage.setItem(SAVED_SERVICE_STORAGE_KEY, JSON.stringify(['svc-1', 42, null, 'svc-2']));

    expect(readStoredSavedServiceIds()).toEqual(['svc-1', 'svc-2']);
    expect([...readStoredSavedServiceIdSet()]).toEqual(['svc-1', 'svc-2']);
  });

  it('returns an empty array for malformed storage', () => {
    localStorage.setItem(SAVED_SERVICE_STORAGE_KEY, '{bad-json');
    expect(readStoredSavedServiceIds()).toEqual([]);
  });

  it('writes saved ids back to local storage', () => {
    writeStoredSavedServiceIds(new Set(['svc-1', 'svc-2']));
    expect(localStorage.getItem(SAVED_SERVICE_STORAGE_KEY)).toBe('["svc-1","svc-2"]');
    expect(readStoredSavedServiceCount()).toBe(2);
  });

  it('emits a same-tab update event when saved ids change', async () => {
    const handler = vi.fn();
    window.addEventListener(SAVED_SERVICES_UPDATED_EVENT, handler as EventListener);

    writeStoredSavedServiceIds(['svc-1', 'svc-2']);
    emitSavedServicesUpdated(['svc-3']);

    expect(handler).toHaveBeenCalledTimes(2);
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      ids: ['svc-1', 'svc-2'],
      count: 2,
    });
    expect((handler.mock.calls[1]?.[0] as CustomEvent).detail).toEqual({
      ids: ['svc-3'],
      count: 1,
    });

    window.removeEventListener(SAVED_SERVICES_UPDATED_EVENT, handler as EventListener);
  });

  it('returns null from fetchServerSavedIds when unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(fetchServerSavedIds()).resolves.toBeNull();
  });

  it('parses saved ids from the server response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ savedIds: ['svc-1', 'svc-2', 7] }),
    });

    await expect(fetchServerSavedIds()).resolves.toEqual(['svc-1', 'svc-2']);
  });

  it('issues best-effort add and remove requests', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await addServerSaved('svc-1');
    await removeServerSaved('svc-1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: 'svc-1' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/saved', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: 'svc-1' }),
    });
  });
});
