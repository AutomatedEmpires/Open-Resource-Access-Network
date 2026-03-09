'use client';

import React from 'react';
import { X } from 'lucide-react';

export interface SeekerAppliedFilterItem {
  id: string;
  label: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  showRemoveIcon?: boolean;
}

interface SeekerAppliedFiltersProps {
  items: SeekerAppliedFilterItem[];
  onClearAll: () => void;
  clearAllLabel?: string;
  className?: string;
}

export function SeekerAppliedFilters({
  items,
  onClearAll,
  clearAllLabel = 'Clear all',
  className = '',
}: SeekerAppliedFiltersProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`mb-4 flex flex-nowrap items-center gap-2 overflow-x-auto md:flex-wrap md:overflow-visible ${className}`.trim()}
      aria-label="Applied filters"
    >
      <span className="text-xs font-medium text-gray-500">Applied:</span>

      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onClick}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          aria-label={item.ariaLabel}
          title={item.title}
        >
          <span>{item.label}</span>
          {item.showRemoveIcon === false ? null : <X className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      ))}

      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto text-xs text-action-strong hover:underline"
      >
        {clearAllLabel}
      </button>
    </div>
  );
}

export default SeekerAppliedFilters;
