// @vitest-environment jsdom
/**
 * TrustBadge component tests
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { TrustBadge } from '../trust-badge';

describe('TrustBadge', () => {
  it('renders verified level with correct text', () => {
    const { getByText } = render(<TrustBadge level="verified" />);
    expect(getByText('Verified')).toBeTruthy();
  });

  it('renders community_verified level with correct text', () => {
    const { getByText } = render(<TrustBadge level="community_verified" />);
    expect(getByText('Community Verified')).toBeTruthy();
  });

  it('renders unverified level with correct text', () => {
    const { getByText } = render(<TrustBadge level="unverified" />);
    expect(getByText('Unverified')).toBeTruthy();
  });

  it('shows "today" when lastVerifiedAt is today', () => {
    const now = new Date().toISOString();
    const { container } = render(<TrustBadge level="verified" lastVerifiedAt={now} />);
    expect(container.textContent).toContain('today');
  });

  it('shows "1 day ago" when lastVerifiedAt is yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const { container } = render(<TrustBadge level="verified" lastVerifiedAt={yesterday} />);
    expect(container.textContent).toContain('1 day ago');
  });

  it('shows correct days ago for older dates', () => {
    const daysAgo = 30;
    const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const { container } = render(<TrustBadge level="community_verified" lastVerifiedAt={date} />);
    expect(container.textContent).toContain('30 days ago');
  });

  it('does not show days ago when lastVerifiedAt is null', () => {
    const { container } = render(<TrustBadge level="unverified" lastVerifiedAt={null} />);
    expect(container.textContent).not.toContain('ago');
    expect(container.textContent).not.toContain('today');
  });

  it('renders correct icon for each level', () => {
    const { container: v } = render(<TrustBadge level="verified" />);
    expect(v.textContent).toContain('✓');

    const { container: cv } = render(<TrustBadge level="community_verified" />);
    expect(cv.textContent).toContain('◐');

    const { container: u } = render(<TrustBadge level="unverified" />);
    expect(u.textContent).toContain('○');
  });

  it('sets aria-label for accessibility', () => {
    const { container } = render(<TrustBadge level="verified" />);
    const badge = container.firstElementChild;
    expect(badge?.getAttribute('aria-label')).toBe('Verified');
  });

  it('includes verification date in aria-label when provided', () => {
    const now = new Date().toISOString();
    const { container } = render(<TrustBadge level="verified" lastVerifiedAt={now} />);
    const badge = container.firstElementChild;
    expect(badge?.getAttribute('aria-label')).toContain('Verified');
    expect(badge?.getAttribute('aria-label')).toContain('Last verified');
  });

  it('applies custom className', () => {
    const { container } = render(<TrustBadge level="verified" className="mt-2" />);
    const badge = container.firstElementChild;
    expect(badge?.className).toContain('mt-2');
  });
});
