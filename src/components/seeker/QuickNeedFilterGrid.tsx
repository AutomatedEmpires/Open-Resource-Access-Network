'use client';

import { QUICK_DISCOVERY_NEEDS, type DiscoveryNeedId } from '@/domain/discoveryNeeds';

interface QuickNeedFilterGridProps {
  activeNeedId: DiscoveryNeedId | null | undefined;
  onSelect: (needId: DiscoveryNeedId) => void;
  ariaLabel?: string;
  className?: string;
  gridClassName?: string;
  buttonClassName?: string;
}

export function QuickNeedFilterGrid({
  activeNeedId,
  onSelect,
  ariaLabel = 'Quick discovery categories',
  className = '',
  gridClassName = 'grid grid-cols-2 gap-2 lg:grid-cols-4',
  buttonClassName = 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors',
}: QuickNeedFilterGridProps) {
  return (
    <div className={className}>
      <div className={gridClassName} role="group" aria-label={ariaLabel}>
        {QUICK_DISCOVERY_NEEDS.map((need) => {
          const selected = activeNeedId === need.id;
          return (
            <button
              key={need.id}
              type="button"
              onClick={() => onSelect(need.id)}
              className={`${buttonClassName} ${selected
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              aria-pressed={selected}
            >
              <span aria-hidden="true" className="text-base leading-none">{need.icon}</span>
              <span>{need.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default QuickNeedFilterGrid;
