'use client';

import React, { createContext, useContext } from 'react';

interface SeekerFeatureFlagsValue {
  planEnabled: boolean;
}

const DEFAULT_FLAGS: SeekerFeatureFlagsValue = {
  planEnabled: false,
};

const SeekerFeatureFlagsContext = createContext<SeekerFeatureFlagsValue>(DEFAULT_FLAGS);

export function SeekerFeatureFlagsProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: SeekerFeatureFlagsValue;
}) {
  return (
    <SeekerFeatureFlagsContext.Provider value={value}>
      {children}
    </SeekerFeatureFlagsContext.Provider>
  );
}

export function useSeekerFeatureFlags(): SeekerFeatureFlagsValue {
  return useContext(SeekerFeatureFlagsContext);
}
