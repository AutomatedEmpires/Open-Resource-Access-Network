import { describe, expect, it } from 'vitest';

import { createTranslator, t } from '@/services/i18n/i18n';

function withNodeEnv<T>(nodeEnv: string | undefined, fn: () => T): T {
  const env = process.env as unknown as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = nodeEnv;
  try {
    return fn();
  } finally {
    env.NODE_ENV = previous;
  }
}

describe('i18n t()', () => {
  it('returns English strings for known keys', () => {
    expect(t('nav.chat')).toBe('Find Services');
  });

  it('falls back to key when missing (non-development)', () => {
    const result = withNodeEnv('test', () => t('missing.key'));
    expect(result).toBe('missing.key');
  });

  it('throws in development when key missing in English', () => {
    expect(() => withNodeEnv('development', () => t('missing.key'))).toThrow(
      '[i18n] Missing translation key: missing.key'
    );
  });

  it('createTranslator returns a locale-bound function', () => {
    const tl = createTranslator('en');
    expect(tl('nav.directory')).toBe('Directory');
  });
});
