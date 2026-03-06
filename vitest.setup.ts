import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'vitest-axe/dist/matchers.js';

expect.extend({ toHaveNoViolations });

// jsdom does not always provide matchMedia; map/search surfaces rely on it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
