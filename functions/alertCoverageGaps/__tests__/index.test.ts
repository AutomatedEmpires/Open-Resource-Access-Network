/**
 * Unit tests for alertCoverageGaps Azure Function
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimerInfo } from '../index';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ORAN_APP_URL', 'https://oran.example.com');
  vi.stubEnv('INTERNAL_API_KEY', 'test-api-key');
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      success: true,
      unroutedCount: 0,
      gapStates: [],
      alertsSent: 0,
      checkedAt: '2025-01-01T08:00:00Z',
    }),
    text: vi.fn().mockResolvedValue(''),
  });
});

function makeTimer(isPastDue = false): TimerInfo {
  return {
    schedule: { isRunning: true },
    isPastDue,
  };
}

async function loadAndRun(timer: TimerInfo) {
  const { alertCoverageGaps } = await import('../index');
  return alertCoverageGaps(timer);
}

describe('alertCoverageGaps', () => {
  it('calls the coverage-gaps API with correct URL and auth', async () => {
    await loadAndRun(makeTimer());

    expect(mockFetch).toHaveBeenCalledWith(
      'https://oran.example.com/api/internal/coverage-gaps',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ thresholdHours: 24 }),
      }),
    );
  });

  it('does not call API when ORAN_APP_URL is missing', async () => {
    vi.stubEnv('ORAN_APP_URL', '');
    await loadAndRun(makeTimer());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call API when INTERNAL_API_KEY is missing', async () => {
    vi.stubEnv('INTERNAL_API_KEY', '');
    await loadAndRun(makeTimer());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles API error responses gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });

    // Should not throw
    await expect(loadAndRun(makeTimer())).resolves.not.toThrow();
  });

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await expect(loadAndRun(makeTimer())).resolves.not.toThrow();
  });

  it('logs past-due warning when timer is past due', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadAndRun(makeTimer(true));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('past due'),
    );
    warnSpy.mockRestore();
  });
});
