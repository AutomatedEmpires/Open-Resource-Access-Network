import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/services/workflow/engine', () => ({
  checkSlaBreaches: vi.fn(),
}));

vi.mock('@/services/escalation/engine', () => ({
  checkSlaWarnings: vi.fn(),
  escalateBreachedSubmissions: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: vi.fn(),
}));

vi.mock('@/services/telemetry/sentry', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/services/ingestion/candidateReviewerRoutingRepair', () => ({
  repairCandidateReviewerCoverage: vi.fn(),
  candidateReviewerRoutingRepairResultFrom: vi.fn((error: unknown) => (
    error && typeof error === 'object' && 'repairResult' in error
      ? (error as { repairResult: unknown }).repairResult
      : null
  )),
}));

import { checkSlaBreaches } from '@/services/workflow/engine';
import {
  checkSlaWarnings,
  escalateBreachedSubmissions,
} from '@/services/escalation/engine';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { repairCandidateReviewerCoverage } from '@/services/ingestion/candidateReviewerRoutingRepair';
import { captureException } from '@/services/telemetry/sentry';
import { GET, POST } from '../route';
import { NextRequest } from 'next/server';

const mockCheckSlaBreaches = vi.mocked(checkSlaBreaches);
const mockCheckSlaWarnings = vi.mocked(checkSlaWarnings);
const mockEscalateBreachedSubmissions = vi.mocked(escalateBreachedSubmissions);
const mockIsDatabaseConfigured = vi.mocked(isDatabaseConfigured);
const mockRepairCandidateReviewerCoverage = vi.mocked(repairCandidateReviewerCoverage);
const mockCaptureException = vi.mocked(captureException);

const candidateReviewerRoutingSuccess = {
  active: true,
  selectedCount: 2,
  attemptedCount: 2,
  coveredCount: 2,
  undercoveredCount: 0,
  failureCount: 0,
  retryCount: 0,
};

function makeCronRequest(cronSecret?: string): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (cronSecret) {
    headers.set('Authorization', `Bearer ${cronSecret}`);
  }
  return new NextRequest('http://localhost/api/internal/sla-check', {
    method: 'POST',
    headers,
  });
}

function makeInternalRequest(apiKey?: string): NextRequest {
  return new NextRequest('http://localhost/api/internal/sla-check', {
    method: 'POST',
    headers: apiKey ? { 'x-oran-internal-key': apiKey } : undefined,
  });
}

describe('GET|POST /api/internal/sla-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    vi.stubEnv('INTERNAL_API_KEY', 'test-secret-key');
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockCheckSlaWarnings.mockResolvedValue(1);
    mockCheckSlaBreaches.mockResolvedValue(0);
    mockEscalateBreachedSubmissions.mockResolvedValue({
      warnings: 0,
      renotified: 0,
      reassigned: 0,
      escalatedToOran: 0,
      silentReviewerReassignments: 0,
      ownerOutreachAlerts: 0,
      integrityHoldsApplied: 0,
    });
    mockRepairCandidateReviewerCoverage.mockResolvedValue(candidateReviewerRoutingSuccess);
  });

  it('returns 503 when no internal credential is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('INTERNAL_API_KEY', '');
    const res = await POST(makeInternalRequest('test-secret-key'));
    expect(res.status).toBe(503);
  });

  it('accepts a Vercel Cron GET request', async () => {
    const res = await GET(makeCronRequest('test-cron-secret'));

    expect(res.status).toBe(200);
    expect(mockCheckSlaWarnings).toHaveBeenCalledOnce();
  });

  it('accepts the dedicated internal header for POST requests', async () => {
    const res = await POST(makeInternalRequest('test-secret-key'));

    expect(res.status).toBe(200);
    expect(mockCheckSlaWarnings).toHaveBeenCalledOnce();
  });

  it('returns 401 when authorization header is missing', async () => {
    const res = await POST(makeInternalRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when authorization header has wrong key', async () => {
    const res = await POST(makeInternalRequest('wrong-key'));
    expect(res.status).toBe(401);
  });

  it('returns 503 when database is not configured', async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const res = await POST(makeInternalRequest('test-secret-key'));
    expect(res.status).toBe(503);
  });

  it('runs SLA check and returns breach count on success', async () => {
    mockCheckSlaWarnings.mockResolvedValueOnce(2);
    mockCheckSlaBreaches.mockResolvedValueOnce(3);
    mockEscalateBreachedSubmissions.mockResolvedValueOnce({
      warnings: 0,
      renotified: 1,
      reassigned: 0,
      escalatedToOran: 0,
      silentReviewerReassignments: 2,
      ownerOutreachAlerts: 1,
      integrityHoldsApplied: 3,
    });

    const res = await POST(makeInternalRequest('test-secret-key'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.warningCount).toBe(2);
    expect(body.breachedCount).toBe(3);
    expect(body.escalation.renotified).toBe(1);
    expect(body.escalation.silentReviewerReassignments).toBe(2);
    expect(body.escalation.ownerOutreachAlerts).toBe(1);
    expect(body.escalation.integrityHoldsApplied).toBe(3);
    expect(body.candidateReviewerRouting).toEqual(candidateReviewerRoutingSuccess);
    expect(body.checkedAt).toBeDefined();
  });

  it('still repairs candidate reviewer coverage when the SLA workflow fails', async () => {
    mockCheckSlaBreaches.mockRejectedValueOnce(new Error('DB error'));

    const res = await POST(makeInternalRequest('test-secret-key'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(mockRepairCandidateReviewerCoverage).toHaveBeenCalledOnce();
    expect(body.sla).toEqual({ success: false });
    expect(body.candidateReviewerRouting).toEqual({
      success: true,
      ...candidateReviewerRoutingSuccess,
    });
  });

  it('completes the SLA workflow and returns count-only retry telemetry when repair fails', async () => {
    const repairResult = {
      active: true,
      selectedCount: 4,
      attemptedCount: 4,
      coveredCount: 1,
      undercoveredCount: 2,
      failureCount: 1,
      retryCount: 3,
    };
    mockRepairCandidateReviewerCoverage.mockRejectedValueOnce({
      repairResult,
      message: 'must not be returned: candidate-sensitive-id',
    });

    const res = await POST(makeInternalRequest('test-secret-key'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(mockCheckSlaWarnings).toHaveBeenCalledOnce();
    expect(mockCheckSlaBreaches).toHaveBeenCalledOnce();
    expect(mockEscalateBreachedSubmissions).toHaveBeenCalledOnce();
    expect(body.sla).toEqual({ success: true });
    expect(body.candidateReviewerRouting).toEqual({
      success: false,
      ...repairResult,
    });
    expect(JSON.stringify(body)).not.toContain('candidate-sensitive-id');
    const routingTelemetryCall = mockCaptureException.mock.calls.find(
      ([, context]) => context?.feature === 'candidate_reviewer_routing_repair',
    );
    expect(routingTelemetryCall?.[0]).toMatchObject({
      name: 'CandidateReviewerRoutingRepairError',
    });
    expect(String(routingTelemetryCall?.[0])).not.toContain('candidate-sensitive-id');
    expect(routingTelemetryCall?.[1]?.extra).toEqual(repairResult);
  });
});
