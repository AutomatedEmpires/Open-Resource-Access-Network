// @vitest-environment jsdom

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryPicker } from '@/components/ui/category-picker';

function CategoryPickerHarness({
  initialSelected = [],
  maxSelections,
}: {
  initialSelected?: string[];
  maxSelections?: number;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  return (
    <div>
      <CategoryPicker selected={selected} onChange={setSelected} maxSelections={maxSelections} />
      <output data-testid="selected">{selected.join(',')}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('CategoryPicker', () => {
  it('toggles preset categories and updates the selected summary', () => {
    render(<CategoryPickerHarness />);

    const food = screen.getByText('Food').closest('button');
    const housing = screen.getByText('Housing').closest('button');

    expect(food).toBeTruthy();
    expect(housing).toBeTruthy();

    fireEvent.click(food as HTMLButtonElement);
    expect(screen.getByTestId('selected')).toHaveTextContent('food');
    expect(screen.getByText('1 category selected')).toBeInTheDocument();

    fireEvent.click(housing as HTMLButtonElement);
    expect(screen.getByTestId('selected')).toHaveTextContent('food,housing');
    expect(screen.getByText('2 categories selected')).toBeInTheDocument();

    fireEvent.click(food as HTMLButtonElement);
    expect(screen.getByTestId('selected')).toHaveTextContent('housing');
    expect(screen.getByText('1 category selected')).toBeInTheDocument();
  });

  it('enforces max selections for unselected chips', () => {
    const onChange = vi.fn();
    render(
      <CategoryPicker
        selected={['food']}
        onChange={onChange}
        maxSelections={1}
      />,
    );

    expect(screen.getByText('(1/1)')).toBeInTheDocument();
    const housing = screen.getByRole('checkbox', { name: /Housing/i });
    const food = screen.getByRole('checkbox', { name: /Food/i });

    expect(housing).toBeDisabled();
    expect(food).not.toBeDisabled();

    fireEvent.click(housing);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports custom category add, duplicate guard, and escape cancel', () => {
    render(<CategoryPickerHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const input = screen.getByLabelText('Custom category name');
    fireEvent.change(input, { target: { value: 'Legal Services' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('selected')).toHaveTextContent('legal_services');
    expect(screen.queryByLabelText('Custom category name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const duplicateInput = screen.getByLabelText('Custom category name');
    fireEvent.change(duplicateInput, { target: { value: 'Legal Services' } });
    fireEvent.keyDown(duplicateInput, { key: 'Enter' });
    expect(screen.getByTestId('selected')).toHaveTextContent('legal_services');
    expect(screen.queryByLabelText('Custom category name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const escapeInput = screen.getByLabelText('Custom category name');
    fireEvent.change(escapeInput, { target: { value: 'temporary' } });
    fireEvent.keyDown(escapeInput, { key: 'Escape' });

    expect(screen.queryByLabelText('Custom category name')).not.toBeInTheDocument();
    expect(screen.getByTestId('selected')).toHaveTextContent('legal_services');
  });
});
