import { beforeEach, describe, expect, it, vi } from 'vitest';

const workflowMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  applySla: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  submitResourceSubmission: vi.fn(),
}));

vi.mock('@/services/workflow/engine', () => workflowMocks);
vi.mock('../service', () => serviceMocks);

import { processSubmittedResourceSubmission } from '../submissionExecution';

describe('processSubmittedResourceSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.submitResourceSubmission.mockResolvedValue(undefined);
    workflowMocks.applySla.mockResolvedValue(undefined);
    workflowMocks.advance.mockResolvedValue({ success: true });
  });

  it('always routes a submitter-authored resource to independent review', async () => {
    const result = await processSubmittedResourceSubmission({
      detail: {
        instance: {
          id: 'form-1',
          submission_id: 'submission-1',
          submission_type: 'new_service',
        },
      } as never,
      actorUserId: 'host-user-1',
      actorRole: 'host_admin',
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      autoPublished: false,
    }));
    expect(workflowMocks.advance).toHaveBeenCalledTimes(2);
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(1, expect.objectContaining({
      toStatus: 'submitted',
      actorUserId: 'host-user-1',
      actorRole: 'host_admin',
    }));
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(2, expect.objectContaining({
      toStatus: 'needs_review',
      actorUserId: 'host-user-1',
      actorRole: 'host_admin',
    }));
    expect(workflowMocks.advance).not.toHaveBeenCalledWith(expect.objectContaining({
      toStatus: 'approved',
    }));
  });
});
