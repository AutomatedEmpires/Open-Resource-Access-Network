'use client';

import {
  MAX_DISCOVERY_RADIUS_MILES,
  MIN_DISCOVERY_RADIUS_MILES,
} from '@/services/search/radius';

interface DistanceRadiusControlProps {
  value: number;
  onChange: (miles: number) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}

export function DistanceRadiusControl({
  value,
  onChange,
  disabled = false,
  label = 'Search radius',
  description = 'Only show results within this distance from your approximate device location.',
  className = '',
}: DistanceRadiusControlProps) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-900">
          {value} mi
        </span>
      </div>

      <div className="mt-4">
        <input
          type="range"
          min={MIN_DISCOVERY_RADIUS_MILES}
          max={MAX_DISCOVERY_RADIUS_MILES}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          disabled={disabled}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={label}
        />
        <div className="mt-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
          <span>{MIN_DISCOVERY_RADIUS_MILES} mi</span>
          <span>{MAX_DISCOVERY_RADIUS_MILES} mi</span>
        </div>
      </div>
    </div>
  );
}

export default DistanceRadiusControl;
