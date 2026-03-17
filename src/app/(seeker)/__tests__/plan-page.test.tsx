// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isEnabledMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
}));

vi.mock('@/services/flags/flags', () => ({
  flagService: {
    isEnabled: isEnabledMock,
  },
}));

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}));

vi.mock('../plan/PlanPageClient', () => ({
  __esModule: true,
  default: () => <div>plan-page-client</div>,
}));

describe('plan page feature flag gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders the plan page when the feature flag is enabled', async () => {
    isEnabledMock.mockResolvedValue(true);
    const { default: PlanPage } = await import('../plan/page');

    render(await PlanPage());

    expect(screen.getByText('plan-page-client')).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('fails closed when the feature flag is disabled', async () => {
    isEnabledMock.mockResolvedValue(false);
    const { default: PlanPage } = await import('../plan/page');

    await expect(PlanPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
