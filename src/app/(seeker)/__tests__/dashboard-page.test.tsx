// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isEnabledMock = vi.hoisted(() => vi.fn());
const dashboardPageClientProps = vi.hoisted(() => ({
  current: undefined as { routeFeasibilityEnabled?: boolean } | undefined,
}));
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

vi.mock('../plan/dashboard/DashboardPageClient', () => ({
  __esModule: true,
  default: (props: { routeFeasibilityEnabled?: boolean }) => {
    dashboardPageClientProps.current = props;
    return <div>dashboard-page-client</div>;
  },
}));

describe('dashboard page feature flag gate', () => {
  beforeEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
    dashboardPageClientProps.current = undefined;
  });

  it('renders the dashboard page when plans, reminders, and dashboard flags are enabled', async () => {
    isEnabledMock.mockResolvedValue(true);
    const { default: DashboardPage } = await import('../plan/dashboard/page');

    render(await DashboardPage());

    expect(screen.getByText('dashboard-page-client')).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(dashboardPageClientProps.current).toEqual({ routeFeasibilityEnabled: true });
  });

  it('renders the dashboard page when route feasibility is disabled', async () => {
    isEnabledMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { default: DashboardPage } = await import('../plan/dashboard/page');

    render(await DashboardPage());

    expect(screen.getByText('dashboard-page-client')).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(dashboardPageClientProps.current).toEqual({ routeFeasibilityEnabled: false });
  });

  it('fails closed when the dashboard flag is disabled', async () => {
    isEnabledMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { default: DashboardPage } = await import('../plan/dashboard/page');

    await expect(DashboardPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
