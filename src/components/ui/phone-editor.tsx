/**
 * PhoneEditor — CRUD for phone numbers on a service or location.
 *
 * Renders a list of existing phones with inline edit/delete,
 * plus an "Add phone" form. Calls parent callbacks on change.
 */

'use client';

import React, { useState, useCallback } from 'react';
import { Phone, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { cn } from '@/lib/utils';

/* ── Types ─────────────────────────────────────────────────────── */

export interface PhoneEntry {
  id?: string;
  number: string;
  extension?: string;
  type: 'voice' | 'fax' | 'text' | 'hotline' | 'tty';
  description?: string;
}

interface PhoneEditorProps {
  phones: PhoneEntry[];
  onChange: (phones: PhoneEntry[]) => void;
  /** Maximum number of phones allowed (default 10). */
  max?: number;
  className?: string;
}

const PHONE_TYPES: { value: PhoneEntry['type']; label: string; icon: string }[] = [
  { value: 'voice', label: 'Voice', icon: '📞' },
  { value: 'text', label: 'Text/SMS', icon: '💬' },
  { value: 'hotline', label: 'Hotline', icon: '🔴' },
  { value: 'fax', label: 'Fax', icon: '📠' },
  { value: 'tty', label: 'TTY', icon: '♿' },
];

const EMPTY_PHONE: PhoneEntry = { number: '', type: 'voice', extension: '', description: '' };

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] transition-shadow';

/* ── Component ─────────────────────────────────────────────────── */

export function PhoneEditor({ phones, onChange, max = 10, className }: PhoneEditorProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PhoneEntry>({ ...EMPTY_PHONE });

  const startAdd = useCallback(() => {
    setAdding(true);
    setEditingId(null);
    setDraft({ ...EMPTY_PHONE });
  }, []);

  const startEdit = useCallback((index: number) => {
    setEditingId(index);
    setAdding(false);
    setDraft({ ...phones[index] });
  }, [phones]);

  const cancel = useCallback(() => {
    setAdding(false);
    setEditingId(null);
    setDraft({ ...EMPTY_PHONE });
  }, []);

  const saveAdd = useCallback(() => {
    if (!draft.number.trim()) return;
    onChange([...phones, { ...draft, number: draft.number.trim() }]);
    cancel();
  }, [draft, phones, onChange, cancel]);

  const saveEdit = useCallback(() => {
    if (editingId === null || !draft.number.trim()) return;
    const updated = [...phones];
    updated[editingId] = { ...draft, number: draft.number.trim() };
    onChange(updated);
    cancel();
  }, [editingId, draft, phones, onChange, cancel]);

  const removePhone = useCallback(
    (index: number) => {
      onChange(phones.filter((_, i) => i !== index));
    },
    [phones, onChange],
  );

  return (
    <fieldset className={cn('space-y-3', className)}>
      <legend className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Phone className="h-4 w-4" aria-hidden="true" />
        Phone Numbers
        <span className="text-xs text-gray-400 font-normal">({phones.length}/{max})</span>
      </legend>

      {/* Existing phones */}
      {phones.length > 0 && (
        <ul className="space-y-2">
          {phones.map((p, i) => (
            <li
              key={p.id ?? i}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                editingId === i ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50',
              )}
            >
              {editingId === i ? (
                <PhoneInlineForm
                  draft={draft}
                  setDraft={setDraft}
                  onSave={saveEdit}
                  onCancel={cancel}
                />
              ) : (
                <>
                  <span className="text-base" aria-hidden="true">
                    {PHONE_TYPES.find((t) => t.value === p.type)?.icon ?? '📞'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-800">{p.number}</span>
                    {p.extension && <span className="text-gray-500 ml-1">ext. {p.extension}</span>}
                    {p.description && (
                      <span className="block text-xs text-gray-500 truncate">{p.description}</span>
                    )}
                    <span className="text-xs text-gray-400 capitalize"> · {p.type}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(i)}
                      className="p-1.5 rounded-md hover:bg-gray-200 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                      aria-label={`Edit phone ${p.number}`}
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePhone(i)}
                      className="p-1.5 rounded-md hover:bg-red-100 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                      aria-label={`Remove phone ${p.number}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Empty state */}
      {phones.length === 0 && !adding && (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-4 text-center text-sm text-gray-500">
          <Phone className="h-5 w-5 mx-auto mb-1 text-gray-300" aria-hidden="true" />
          No phone numbers added yet
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <PhoneInlineForm
            draft={draft}
            setDraft={setDraft}
            onSave={saveAdd}
            onCancel={cancel}
          />
        </div>
      )}

      {/* Add button */}
      {!adding && phones.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={startAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Phone
        </Button>
      )}
    </fieldset>
  );
}

/* ── Inline phone form ─────────────────────────────────────────── */

function PhoneInlineForm({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: PhoneEntry;
  setDraft: React.Dispatch<React.SetStateAction<PhoneEntry>>;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex-1 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <FormField id="phone-number" label="Number" required className="sm:col-span-2">
          <input
            type="tel"
            value={draft.number}
            onChange={(e) => setDraft((d) => ({ ...d, number: e.target.value }))}
            placeholder="(555) 123-4567"
            className={INPUT_CLASS}
            maxLength={30}
            autoFocus
          />
        </FormField>
        <FormField id="phone-ext" label="Ext.">
          <input
            type="text"
            value={draft.extension ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, extension: e.target.value }))}
            placeholder="123"
            className={INPUT_CLASS}
            maxLength={10}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FormField id="phone-type" label="Type">
          <select
            value={draft.type}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as PhoneEntry['type'] }))}
            className={INPUT_CLASS}
          >
            {PHONE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="phone-desc" label="Description">
          <input
            type="text"
            value={draft.description ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="Main line, after-hours, etc."
            className={INPUT_CLASS}
            maxLength={200}
          />
        </FormField>
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="gap-1">
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!draft.number.trim()}
          className="gap-1"
        >
          <Check className="h-3.5 w-3.5" /> Save
        </Button>
      </div>
    </div>
  );
}
