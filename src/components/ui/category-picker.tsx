/**
 * CategoryPicker — multi-select tag/chip component for service taxonomy.
 *
 * Displays a scrollable list of preset HSDS service categories
 * as selectable chips with emoji icons. Supports custom tag creation.
 */

'use client';

import React, { useState } from 'react';
import { Tags, Plus, X } from 'lucide-react';
import { FormSection } from '@/components/ui/form-section';
import { cn } from '@/lib/utils';

/* ── Preset categories ─────────────────────────────────────────── */

export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;      // tailwind bg class for selected state
  textColor: string;   // tailwind text class for selected state
}

export const PRESET_CATEGORIES: Category[] = [
  { id: 'food',             label: 'Food',              emoji: '🍎', color: 'bg-green-100',  textColor: 'text-green-800' },
  { id: 'housing',          label: 'Housing',           emoji: '🏠', color: 'bg-blue-100',   textColor: 'text-blue-800' },
  { id: 'healthcare',       label: 'Healthcare',        emoji: '🏥', color: 'bg-red-100',    textColor: 'text-red-800' },
  { id: 'mental_health',    label: 'Mental Health',     emoji: '🧠', color: 'bg-purple-100', textColor: 'text-purple-800' },
  { id: 'employment',       label: 'Employment',        emoji: '💼', color: 'bg-amber-100',  textColor: 'text-amber-800' },
  { id: 'legal_aid',        label: 'Legal Aid',         emoji: '⚖️', color: 'bg-slate-100',  textColor: 'text-slate-800' },
  { id: 'childcare',        label: 'Childcare',         emoji: '👶', color: 'bg-pink-100',   textColor: 'text-pink-800' },
  { id: 'transportation',   label: 'Transportation',    emoji: '🚌', color: 'bg-cyan-100',   textColor: 'text-cyan-800' },
  { id: 'education',        label: 'Education',         emoji: '📚', color: 'bg-indigo-100', textColor: 'text-indigo-800' },
  { id: 'substance_abuse',  label: 'Substance Abuse',   emoji: '💊', color: 'bg-teal-100',   textColor: 'text-teal-800' },
  { id: 'veterans',         label: 'Veterans',          emoji: '🎖️', color: 'bg-emerald-100', textColor: 'text-emerald-800' },
  { id: 'financial',        label: 'Financial Aid',     emoji: '💰', color: 'bg-yellow-100', textColor: 'text-yellow-800' },
  { id: 'disability',       label: 'Disability',        emoji: '♿', color: 'bg-orange-100',  textColor: 'text-orange-800' },
  { id: 'senior_services',  label: 'Senior Services',   emoji: '🧓', color: 'bg-rose-100',   textColor: 'text-rose-800' },
  { id: 'utility_assistance', label: 'Utility Assistance', emoji: '💡', color: 'bg-lime-100', textColor: 'text-lime-800' },
  { id: 'clothing',         label: 'Clothing',          emoji: '👕', color: 'bg-violet-100', textColor: 'text-violet-800' },
];

/* ── Props ─────────────────────────────────────────────────────── */

interface CategoryPickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  /**
   * Optional custom categories beyond the presets.
   * The component merges these with PRESET_CATEGORIES for display.
   */
  customCategories?: Category[];
  /** Allow users to add custom tags */
  allowCustom?: boolean;
  className?: string;
  maxSelections?: number;
}

/* ── Component ─────────────────────────────────────────────────── */

export function CategoryPicker({
  selected,
  onChange,
  customCategories = [],
  allowCustom = true,
  className,
  maxSelections,
}: CategoryPickerProps) {
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const allCategories = [...PRESET_CATEGORIES, ...customCategories];

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      if (maxSelections && selected.length >= maxSelections) return;
      onChange([...selected, id]);
    }
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    const id = trimmed.toLowerCase().replace(/\s+/g, '_');
    if (selected.includes(id)) {
      setCustomInput('');
      setShowCustomInput(false);
      return;
    }
    // Add to selection even if not a preset — parent can handle custom IDs
    onChange([...selected, id]);
    setCustomInput('');
    setShowCustomInput(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustom();
    }
    if (e.key === 'Escape') {
      setShowCustomInput(false);
      setCustomInput('');
    }
  };

  return (
    <FormSection
      title="Service categories"
      description="Choose the categories that best describe this service, then add a custom tag only if no preset fits."
      className={className}
      action={maxSelections ? <span className="text-xs text-gray-400 font-normal">({selected.length}/{maxSelections})</span> : <Tags className="h-4 w-4 text-gray-500" aria-hidden="true" />}
      contentClassName="space-y-2"
    >

      <div className="flex flex-wrap gap-2" role="group" aria-label="Service categories">
        {allCategories.map((cat) => {
          const isSelected = selected.includes(cat.id);
          const atMax = !!maxSelections && selected.length >= maxSelections && !isSelected;
          return (
            <button
              key={cat.id}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              disabled={atMax}
              onClick={() => toggle(cat.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-150',
                'border focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1',
                isSelected
                  ? `${cat.color} ${cat.textColor} border-transparent shadow-sm scale-105`
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                atMax && 'opacity-40 cursor-not-allowed',
              )}
            >
              <span aria-hidden="true">{cat.emoji}</span>
              {cat.label}
              {isSelected && (
                <X className="h-3 w-3 ml-0.5" aria-hidden="true" />
              )}
            </button>
          );
        })}

        {/* Custom tag input */}
        {allowCustom && !showCustomInput && (
          <button
            type="button"
            onClick={() => setShowCustomInput(true)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Custom
          </button>
        )}

        {allowCustom && showCustomInput && (
          <div className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type & Enter"
              className="bg-transparent text-sm outline-none w-24 placeholder:text-teal-300"
              autoFocus
              maxLength={50}
              aria-label="Custom category name"
            />
            <button
              type="button"
              onClick={addCustom}
              className="text-teal-600 hover:text-teal-800 p-0.5"
              aria-label="Add custom category"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setShowCustomInput(false); setCustomInput(''); }}
              className="text-gray-400 hover:text-gray-600 p-0.5"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Selected summary */}
      {selected.length > 0 && (
        <p className="text-xs text-gray-500">
          {selected.length} categor{selected.length === 1 ? 'y' : 'ies'} selected
        </p>
      )}
    </FormSection>
  );
}
