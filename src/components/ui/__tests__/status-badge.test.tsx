// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/ui/status-badge';

afterEach(() => {
  cleanup();
});

describe('StatusBadge', () => {
  it('renders the canonical label for a known status', () => {
    render(<StatusBadge status="submitted" />);
    expect(screen.getByText('Submitted')).toBeDefined();
  });

  it('renders the default "Unknown" label for an unrecognized status', () => {
    render(<StatusBadge status="nonexistent_status" />);
    expect(screen.getByText('Unknown')).toBeDefined();
  });

  it('applies the correct color classes for a known status', () => {
    const { container } = render(<StatusBadge status="approved" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('bg-green-100');
    expect(badge?.className).toContain('text-green-800');
  });

  it('uses page-specific overrides when provided', () => {
    const overrides = {
      submitted: { color: 'bg-pink-100 text-pink-800 ring-pink-600/20', label: 'Custom Label' },
    };
    render(<StatusBadge status="submitted" overrides={overrides} />);
    expect(screen.getByText('Custom Label')).toBeDefined();
    const badge = screen.getByText('Custom Label');
    expect(badge.className).toContain('bg-pink-100');
  });

  it('falls through to centralized styles when override does not cover the status', () => {
    const overrides = {
      submitted: { color: 'bg-pink-100 text-pink-800 ring-pink-600/20', label: 'Custom' },
    };
    render(<StatusBadge status="denied" overrides={overrides} />);
    expect(screen.getByText('Denied')).toBeDefined();
  });
});
