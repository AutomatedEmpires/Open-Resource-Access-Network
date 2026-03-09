// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { CrisisModal } from '@/components/footer/CrisisModal';

describe('CrisisModal', () => {
  it('renders resources and supports filtering and close', async () => {
    const onClose = vi.fn();
    render(<CrisisModal open onClose={onClose} />);

    expect(screen.getByText('Crisis Resources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All Resources' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: /Call 988 Suicide & Crisis Lifeline/i })).toHaveAttribute('href', 'tel:988');
    expect(screen.getByRole('link', { name: /Call SAMHSA National Helpline/i })).toHaveAttribute('href', 'tel:+18006624357');

    fireEvent.click(screen.getByRole('button', { name: 'Mental Health' }));
    expect(screen.getByRole('button', { name: 'Mental Health' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('SAMHSA National Helpline')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close crisis resources' }));
    expect(onClose).toHaveBeenCalled();
  });
});

