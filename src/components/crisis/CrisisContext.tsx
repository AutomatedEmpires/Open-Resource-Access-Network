/**
 * CrisisContext
 *
 * Single shared open/close state for the Crisis Resources modal.
 * Render CrisisModal exactly once (inside this provider) so that
 * multiple entry points — the global FAB, the footer button, etc. —
 * all control the same dialog instance.
 *
 * Usage:
 *   const { openCrisis } = useCrisisModal();
 *   <button onClick={openCrisis}>...</button>
 */

'use client';

import React, { createContext, useContext, useState } from 'react';
import { CrisisModal } from '@/components/footer/CrisisModal';

// ============================================================
// CONTEXT
// ============================================================

interface CrisisContextValue {
  openCrisis: () => void;
}

const CrisisContext = createContext<CrisisContextValue>({
  openCrisis: () => {},
});

// ============================================================
// PROVIDER
// ============================================================

export function CrisisProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <CrisisContext.Provider value={{ openCrisis: () => setOpen(true) }}>
      {children}
      {/* Single modal instance for the entire app */}
      <CrisisModal open={open} onClose={() => setOpen(false)} />
    </CrisisContext.Provider>
  );
}

// ============================================================
// HOOK
// ============================================================

export function useCrisisModal(): CrisisContextValue {
  return useContext(CrisisContext);
}
