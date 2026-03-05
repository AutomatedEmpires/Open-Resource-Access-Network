// @vitest-environment jsdom

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PhoneEditor, type PhoneEntry } from '@/components/ui/phone-editor';

function PhoneEditorHarness({
  initialPhones,
  max,
}: {
  initialPhones: PhoneEntry[];
  max?: number;
}) {
  const [phones, setPhones] = useState<PhoneEntry[]>(initialPhones);
  return (
    <div>
      <PhoneEditor phones={phones} onChange={setPhones} max={max} />
      <output data-testid="phones-json">{JSON.stringify(phones)}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('PhoneEditor', () => {
  it('adds a phone entry and trims whitespace on save', () => {
    render(<PhoneEditorHarness initialPhones={[]} />);

    expect(screen.getByText('No phone numbers added yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Phone' }));

    const saveButton = screen.getByRole('button', { name: /Save/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Number/i), {
      target: { value: '  (555) 000-1111  ' },
    });
    fireEvent.change(screen.getByLabelText(/Ext/i), {
      target: { value: '99' },
    });
    fireEvent.change(screen.getByLabelText(/Type/i), {
      target: { value: 'hotline' },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'After hours only' },
    });
    fireEvent.click(saveButton);

    const phonesJson = screen.getByTestId('phones-json').textContent ?? '';
    expect(phonesJson).toContain('(555) 000-1111');
    expect(phonesJson).toContain('"extension":"99"');
    expect(phonesJson).toContain('"type":"hotline"');
    expect(phonesJson).toContain('After hours only');
    expect(screen.getByText('(555) 000-1111')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Number/i)).not.toBeInTheDocument();
  });

  it('edits and removes existing phone entries', () => {
    render(
      <PhoneEditorHarness
        initialPhones={[
          { number: '(555) 111-1111', type: 'voice', description: 'Main' },
          { number: '(555) 222-2222', type: 'text', description: 'SMS line' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit phone (555) 111-1111' }));
    fireEvent.change(screen.getByLabelText(/Number/i), {
      target: { value: '  (555) 333-3333 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    let phonesJson = screen.getByTestId('phones-json').textContent ?? '';
    expect(phonesJson).toContain('(555) 333-3333');
    expect(phonesJson).not.toContain('(555) 111-1111');

    fireEvent.click(screen.getByRole('button', { name: 'Remove phone (555) 222-2222' }));

    phonesJson = screen.getByTestId('phones-json').textContent ?? '';
    expect(phonesJson).toContain('(555) 333-3333');
    expect(phonesJson).not.toContain('(555) 222-2222');
  });

  it('hides add action when max phones is reached', () => {
    render(
      <PhoneEditorHarness
        initialPhones={[{ number: '(555) 999-9999', type: 'voice' }]}
        max={1}
      />,
    );

    expect(screen.getByText('(1/1)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Phone' })).not.toBeInTheDocument();
  });
});
