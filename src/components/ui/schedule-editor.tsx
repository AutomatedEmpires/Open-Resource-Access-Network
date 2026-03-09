/**
 * ScheduleEditor — visual weekly schedule editor.
 *
 * Lets hosts set open/close times for each day of the week
 * with a visual grid. Supports closed days and 24-hour operation.
 */

'use client';

import React, { useCallback } from 'react';
import { Clock, Sun, Moon } from 'lucide-react';
import { FormSection } from '@/components/ui/form-section';
import { cn } from '@/lib/utils';

/* ── Types ─────────────────────────────────────────────────────── */

export interface DaySchedule {
  day: string;
  opens: string;   // HH:mm format
  closes: string;  // HH:mm format
  closed: boolean;
}

export type WeekSchedule = DaySchedule[];

interface ScheduleEditorProps {
  schedule: WeekSchedule;
  onChange: (schedule: WeekSchedule) => void;
  className?: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const EMPTY_WEEK: WeekSchedule = DAYS.map((day) => ({
  day,
  opens: '09:00',
  closes: '17:00',
  closed: false,
}));

const INPUT_CLASS =
  'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px] text-center tabular-nums';

/* ── Component ─────────────────────────────────────────────────── */

export function ScheduleEditor({ schedule, onChange, className }: ScheduleEditorProps) {
  const updateDay = useCallback(
    (index: number, updates: Partial<DaySchedule>) => {
      const updated = schedule.map((d, i) => (i === index ? { ...d, ...updates } : d));
      onChange(updated);
    },
    [schedule, onChange],
  );

  const toggleClosed = useCallback(
    (index: number) => {
      updateDay(index, { closed: !schedule[index].closed });
    },
    [schedule, updateDay],
  );

  const set24Hours = useCallback(
    (index: number) => {
      updateDay(index, { opens: '00:00', closes: '23:59', closed: false });
    },
    [updateDay],
  );

  const copyToAll = useCallback(
    (index: number) => {
      const source = schedule[index];
      const updated = schedule.map((d) => ({
        ...d,
        opens: source.opens,
        closes: source.closes,
        closed: source.closed,
      }));
      onChange(updated);
    },
    [schedule, onChange],
  );

  const copyToWeekdays = useCallback(
    (index: number) => {
      const source = schedule[index];
      const updated = schedule.map((d, i) => ({
        ...d,
        opens: i < 5 ? source.opens : d.opens,
        closes: i < 5 ? source.closes : d.closes,
        closed: i < 5 ? source.closed : d.closed,
      }));
      onChange(updated);
    },
    [schedule, onChange],
  );

  return (
    <FormSection
      title="Operating schedule"
      description="Set open and closed times for each day, then copy a schedule across the week when needed."
      className={className}
      action={<Clock className="h-4 w-4 text-gray-500" aria-hidden="true" />}
    >

      {/* Quick-fill buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(EMPTY_WEEK)}
          className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
        >
          Reset to 9–5
        </button>
        <button
          type="button"
          onClick={() => onChange(DAYS.map((day) => ({ day, opens: '00:00', closes: '23:59', closed: false })))}
          className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
        >
          24/7
        </button>
        <button
          type="button"
          onClick={() => onChange(DAYS.map((day, i) => ({
            day,
            opens: '09:00',
            closes: '17:00',
            closed: i >= 5,
          })))}
          className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
        >
          Weekdays only
        </button>
      </div>

      {/* Day rows */}
      <div className="space-y-1.5">
        {schedule.map((day, i) => (
          <div
            key={day.day}
            className={cn(
              'grid grid-cols-[80px_1fr] sm:grid-cols-[100px_auto_auto_1fr] items-center gap-2 rounded-lg px-3 py-2 transition-colors',
              day.closed
                ? 'bg-gray-50 border border-gray-100'
                : 'bg-white border border-gray-200',
            )}
          >
            {/* Day name with close toggle */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleClosed(i)}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-sm border transition-colors',
                  day.closed
                    ? 'border-gray-300 bg-gray-200'
                    : 'border-green-400 bg-green-500',
                )}
                title={day.closed ? 'Mark as open' : 'Mark as closed'}
                aria-label={`${day.day} ${day.closed ? 'closed — click to open' : 'open — click to close'}`}
              >
                {!day.closed && (
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className={cn('text-sm font-medium', day.closed ? 'text-gray-400' : 'text-gray-700')}>
                <span className="sm:hidden">{SHORT_DAYS[i]}</span>
                <span className="hidden sm:inline">{day.day}</span>
              </span>
            </div>

            {day.closed ? (
              <span className="col-span-1 sm:col-span-3 text-xs text-gray-400 italic">Closed</span>
            ) : (
              <>
                {/* Opens */}
                <div className="flex items-center gap-1">
                  <Sun className="h-3.5 w-3.5 text-amber-500 shrink-0 hidden sm:block" aria-hidden="true" />
                  <input
                    type="time"
                    value={day.opens}
                    onChange={(e) => updateDay(i, { opens: e.target.value })}
                    className={INPUT_CLASS}
                    aria-label={`${day.day} opening time`}
                  />
                </div>

                {/* Closes */}
                <div className="flex items-center gap-1">
                  <Moon className="h-3.5 w-3.5 text-blue-400 shrink-0 hidden sm:block" aria-hidden="true" />
                  <input
                    type="time"
                    value={day.closes}
                    onChange={(e) => updateDay(i, { closes: e.target.value })}
                    className={INPUT_CLASS}
                    aria-label={`${day.day} closing time`}
                  />
                </div>

                {/* Quick actions */}
                <div className="hidden sm:flex gap-1 justify-end">
                  <button
                    type="button"
                    onClick={() => set24Hours(i)}
                    className="text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
                    title="Set 24 hours"
                  >
                    24h
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToAll(i)}
                    className="text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
                    title="Copy to all days"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToWeekdays(i)}
                    className="text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
                    title="Copy to weekdays (Mon-Fri)"
                  >
                    M-F
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </FormSection>
  );
}
