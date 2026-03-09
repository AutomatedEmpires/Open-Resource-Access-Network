// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/app/(oran-admin)/forms/OranFormsPageClient', () => ({
  default: () => <div>Form Vault Workspace</div>,
}));

import OranFormsPage from '@/app/(oran-admin)/forms/page';

describe('oran admin forms page', () => {
  it('renders the forms workspace route', () => {
    render(<OranFormsPage />);

    expect(screen.getByText('Form Vault Workspace')).toBeInTheDocument();
  });
});
