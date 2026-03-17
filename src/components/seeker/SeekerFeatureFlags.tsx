'use client';

import React, { createContext, useContext } from 'react';

interface SeekerFeatureFlagsValue {
  planEnabled: boolean;
  reminderEnabled: boolean;
  dashboardEnabled: boolean;
}

const DEFAULT_FLAGS: SeekerFeatureFlagsValue = {
  planEnabled: false,
  reminderEnabled: false,
  dashboardEnabled: false,
};

const SeekerFeatureFlagsContext = createContext<SeekerFeatureFlagsValue>(DEFAULT_FLAGS);

export function SeekerFeatureFlagsProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: Partial<SeekerFeatureFlagsValue>;
}) {
  const mergedValue: SeekerFeatureFlagsValue = {
    ...DEFAULT_FLAGS,
    ...value,
  };

  return (
    <SeekerFeatureFlagsContext.Provider value={mergedValue}>
      {children}
    </SeekerFeatureFlagsContext.Provider>
  );
}

export function useSeekerFeatureFlags(): SeekerFeatureFlagsValue {
  return useContext(SeekerFeatureFlagsContext);
}
