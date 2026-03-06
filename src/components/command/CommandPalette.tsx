/**
 * CommandPalette — opens on ⌘K / Ctrl+K in the seeker layout.
 *
 * Safety: only navigation commands — no admin actions, no external URLs.
 * Accessibility: role="listbox" + role="option" + aria-activedescendant.
 */

'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MessageCircle, List, MapPin, Bookmark, User } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  href: string;
}

const COMMANDS: Command[] = [
  { id: 'chat',      label: 'Go to Chat',      description: 'AI-assisted service search', icon: MessageCircle, href: '/chat'      },
  { id: 'directory', label: 'Open Directory',   description: 'Browse all verified services', icon: List,          href: '/directory' },
  { id: 'map',       label: 'Go to Map',        description: 'Map view of nearby services',  icon: MapPin,        href: '/map'       },
  { id: 'saved',     label: 'Go to Saved',      description: 'Your saved services',          icon: Bookmark,      href: '/saved'     },
  { id: 'profile',   label: 'Go to Profile',    description: 'Account and display settings', icon: User,          href: '/profile'   },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Filter commands by query (empty query = all commands)
  const filtered = query.trim()
    ? COMMANDS.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase()),
      )
    : COMMANDS;

  // Reset state when dialog opens or closes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Reset active index whenever filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const execute = useCallback(
    (cmd: Command) => {
      router.push(cmd.href);
      onClose();
    },
    [router, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[activeIndex]) execute(filtered[activeIndex]);
        break;
      default:
        break;
    }
  };

  const activeItemId = filtered[activeIndex]
    ? `${listId}-item-${filtered[activeIndex].id}`
    : undefined;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(val) => {
        if (!val) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[20%] z-[var(--z-modal)] w-full max-w-lg -translate-x-1/2 rounded-xl bg-white shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 overflow-hidden"
          aria-label="Command palette"
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          {/* Visually-hidden title for screen readers */}
          <DialogPrimitive.Title className="sr-only">
            Command palette — navigate to a page
          </DialogPrimitive.Title>

          {/* Search input */}
          <div className="border-b border-gray-200 px-4 py-3">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command or page name…"
              className="w-full bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none min-h-[44px]"
              aria-label="Search commands"
              aria-controls={listId}
              aria-activedescendant={activeItemId}
              aria-autocomplete="list"
            />
          </div>

          {/* Command list */}
          <ul
            id={listId}
            role="listbox"
            aria-label="Available commands"
            className="max-h-72 overflow-y-auto py-2"
          >
            {filtered.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-500">
                No commands found for &ldquo;{query}&rdquo;.
              </li>
            )}
            {filtered.map((cmd, idx) => {
              const isActive = idx === activeIndex;
              const Icon = cmd.icon;
              return (
                <li
                  key={cmd.id}
                  id={`${listId}-item-${cmd.id}`}
                  role="option"
                  aria-selected={isActive}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer min-h-[44px] transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()} // prevent input losing focus
                  onClick={() => execute(cmd)}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{cmd.label}</p>
                    <p className={`text-xs ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                      {cmd.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Keyboard hint footer */}
          <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 flex gap-3">
            <span>
              <kbd className="font-mono bg-gray-100 px-1 rounded">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-mono bg-gray-100 px-1 rounded">↵</kbd> select
            </span>
            <span>
              <kbd className="font-mono bg-gray-100 px-1 rounded">Esc</kbd> close
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
