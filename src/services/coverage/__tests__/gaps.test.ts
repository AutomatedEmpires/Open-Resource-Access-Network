/**
 * Unit tests for coverage gap service
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecuteQuery = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  executeQuery: mockExecuteQuery,
}));

import {
  findUnroutedCandidates,
  getCoverageGapSummaries,
  getCoverageGapReport,
  alertOranAdminsAboutGaps,
  type CoverageGapSummary,
} from '../gaps';

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteQuery.mockResolvedValue([]);
});

describe('findUnroutedCandidates', () => {
  it('passes threshold hours to the query', async () => {
    await findUnroutedCandidates(48);
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining('extracted_candidates'),
      [48],
    );
  });

  it('defaults threshold to 24 hours', async () => {
    await findUnroutedCandidates();
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining('extracted_candidates'),
      [24],
    );
  });

  it('returns unrouted candidate rows', async () => {
    const candidates = [
      { candidateId: 'c-1', stateProvince: 'ID', countyOrRegion: 'Kootenai', enqueuedAt: '2025-01-01', hoursWaiting: 30 },
    ];
    mockExecuteQuery.mockResolvedValueOnce(candidates);

    const result = await findUnroutedCandidates(24);
    expect(result).toEqual(candidates);
  });
});

describe('getCoverageGapSummaries', () => {
  it('returns aggregated gap summaries', async () => {
    const summaries: CoverageGapSummary[] = [
      { state: 'NV', county: null, unroutedCount: 5, oldestHoursWaiting: 72 },
      { state: 'AZ', county: 'Maricopa', unroutedCount: 2, oldestHoursWaiting: 30 },
    ];
    mockExecuteQuery.mockResolvedValueOnce(summaries);

    const result = await getCoverageGapSummaries(24);
    expect(result).toEqual(summaries);
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining('GROUP BY'),
      [24],
    );
  });
});

describe('getCoverageGapReport', () => {
  it('combines unrouted candidates, summaries, and coverage info', async () => {
    const candidates = [
      { candidateId: 'c-1', stateProvince: 'NV', countyOrRegion: null, enqueuedAt: '2025-01-01', hoursWaiting: 48 },
    ];
    const summaries: CoverageGapSummary[] = [
      { state: 'NV', county: null, unroutedCount: 3, oldestHoursWaiting: 48 },
    ];
    const coveredStates = [{ state: 'ID' }, { state: 'WA' }];

    // Three parallel calls: findUnroutedCandidates, getCoverageGapSummaries, covered states
    mockExecuteQuery
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce(summaries)
      .mockResolvedValueOnce(coveredStates);

    const report = await getCoverageGapReport(24);

    expect(report.unroutedCandidates).toEqual(candidates);
    expect(report.gapSummaries).toEqual(summaries);
    expect(report.statesWithCoverage).toEqual(['ID', 'WA']);
    // NV has gaps but is not in covered states
    expect(report.statesWithoutCoverage).toContain('NV');
  });

  it('excludes "Unknown" from states without coverage', async () => {
    const summaries: CoverageGapSummary[] = [
      { state: 'Unknown', county: null, unroutedCount: 1, oldestHoursWaiting: 25 },
    ];
    mockExecuteQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(summaries)
      .mockResolvedValueOnce([]);

    const report = await getCoverageGapReport(24);
    expect(report.statesWithoutCoverage).not.toContain('Unknown');
  });
});

describe('alertOranAdminsAboutGaps', () => {
  it('returns 0 when no gap summaries provided', async () => {
    const result = await alertOranAdminsAboutGaps([]);
    expect(result).toBe(0);
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('inserts notification events for ORAN admins and returns count', async () => {
    const summaries: CoverageGapSummary[] = [
      { state: 'NV', county: null, unroutedCount: 5, oldestHoursWaiting: 72 },
      { state: 'AZ', county: 'Maricopa', unroutedCount: 2, oldestHoursWaiting: 30 },
    ];
    mockExecuteQuery.mockResolvedValueOnce([{ id: 'notif-1' }, { id: 'notif-2' }]);

    const result = await alertOranAdminsAboutGaps(summaries);
    expect(result).toBe(2);
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining('notification_events'),
      expect.arrayContaining(['2']),
    );
  });

  it('uses idempotency keys to prevent duplicate alerts per day', async () => {
    const summaries: CoverageGapSummary[] = [
      { state: 'NV', county: null, unroutedCount: 1, oldestHoursWaiting: 25 },
    ];
    mockExecuteQuery.mockResolvedValueOnce([]);

    await alertOranAdminsAboutGaps(summaries);
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (idempotency_key) DO NOTHING'),
      expect.any(Array),
    );
  });
});
