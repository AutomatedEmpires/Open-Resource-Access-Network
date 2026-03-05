// @vitest-environment jsdom

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_WEEK, ScheduleEditor, type WeekSchedule } from '@/components/ui/schedule-editor';

function cloneWeek(week: WeekSchedule): WeekSchedule {
  return week.map((day) => ({ ...day }));
}

function ScheduleEditorHarness({ initial }: { initial?: WeekSchedule }) {
  const [schedule, setSchedule] = useState<WeekSchedule>(cloneWeek(initial ?? EMPTY_WEEK));
  return (
    <div>
      <ScheduleEditor schedule={schedule} onChange={setSchedule} />
      <output data-testid="schedule-json">{JSON.stringify(schedule)}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('ScheduleEditor', () => {
  it('applies quick-fill presets', () => {
    render(<ScheduleEditorHarness />);

    fireEvent.click(screen.getByRole('button', { name: '24/7' }));
    let scheduleJson = screen.getByTestId('schedule-json').textContent ?? '';
    expect(scheduleJson).toContain('"opens":"00:00"');
    expect(scheduleJson).toContain('"closes":"23:59"');
    expect(scheduleJson).not.toContain('"closed":true');

    fireEvent.click(screen.getByRole('button', { name: 'Weekdays only' }));
    scheduleJson = screen.getByTestId('schedule-json').textContent ?? '';
    expect(scheduleJson).toContain('{"day":"Saturday","opens":"09:00","closes":"17:00","closed":true}');
    expect(scheduleJson).toContain('{"day":"Sunday","opens":"09:00","closes":"17:00","closed":true}');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to 9–5' }));
    scheduleJson = screen.getByTestId('schedule-json').textContent ?? '';
    expect(scheduleJson).toContain('{"day":"Saturday","opens":"09:00","closes":"17:00","closed":false}');
  }, 15000);

  it('updates individual days and applies copy actions', () => {
    render(<ScheduleEditorHarness />);

    fireEvent.click(screen.getByRole('button', { name: /Monday open — click to close/i }));
    expect(screen.getByText('Closed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Monday closed — click to open/i }));
    fireEvent.change(screen.getByLabelText('Monday opening time'), {
      target: { value: '06:00' },
    });
    fireEvent.change(screen.getByLabelText('Monday closing time'), {
      target: { value: '18:00' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'All' })[0]);
    expect(screen.getByLabelText('Sunday opening time')).toHaveValue('06:00');
    expect(screen.getByLabelText('Sunday closing time')).toHaveValue('18:00');

    fireEvent.change(screen.getByLabelText('Monday opening time'), {
      target: { value: '07:00' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'M-F' })[0]);

    expect(screen.getByLabelText('Friday opening time')).toHaveValue('07:00');
    expect(screen.getByLabelText('Saturday opening time')).toHaveValue('06:00');
  }, 15000);

  it('supports per-day 24-hour shortcut', () => {
    render(<ScheduleEditorHarness />);

    fireEvent.click(screen.getAllByRole('button', { name: '24h' })[0]);

    expect(screen.getByLabelText('Monday opening time')).toHaveValue('00:00');
    expect(screen.getByLabelText('Monday closing time')).toHaveValue('23:59');
  });
});
