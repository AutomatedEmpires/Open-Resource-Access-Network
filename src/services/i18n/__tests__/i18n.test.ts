import { describe, expect, it } from 'vitest';

import { createTranslator, isRTL, t } from '@/services/i18n/i18n';

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

  it('interpolates template params and preserves missing placeholders', () => {
    expect(t('chat.quota.exceeded', { count: 3 })).toContain("You've reached");
    expect(t('chat.input.placeholder', { missing: 1 })).toBe('Describe what you need help with...');
  });

  it('falls back to English when locale is non-default and key exists in English', () => {
    expect(t('nav.map', undefined, 'es')).toBe('Mapa');
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

  it('identifies RTL locales', () => {
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('en')).toBe(false);
  });
});
