import { describe, expect, it } from 'vitest';

import { buildUrl, isTransient, sha256, stableStringify } from '../connectorUtils';

describe('connectorUtils', () => {
  describe('sha256', () => {
    it('produces consistent hex hash for the same input', () => {
      const hash1 = sha256('hello');
      const hash2 = sha256('hello');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('produces different hashes for different inputs', () => {
      expect(sha256('a')).not.toBe(sha256('b'));
    });
  });

  describe('stableStringify', () => {
    it('produces same output regardless of key order', () => {
      const left = stableStringify({ z: 1, a: 2 });
      const right = stableStringify({ a: 2, z: 1 });

      expect(left).toBe(right);
    });

    it('handles nested objects with sorted keys', () => {
      const left = stableStringify({ outer: { z: 1, a: 2 } });
      const right = stableStringify({ outer: { a: 2, z: 1 } });

      expect(left).toBe(right);
    });

    it('preserves arrays order', () => {
      const left = stableStringify([1, 2, 3]);
      const right = stableStringify([3, 2, 1]);

      expect(left).not.toBe(right);
    });

    it('handles null and primitive values', () => {
      expect(stableStringify(null)).toBe('null');
      expect(stableStringify(42)).toBe('42');
      expect(stableStringify('test')).toBe(JSON.stringify('test'));
    });
  });

  describe('isTransient', () => {
    it('returns true for timeout errors', () => {
      expect(isTransient(new Error('request timeout'))).toBe(true);
    });

    it('returns true for ECONNRESET', () => {
      expect(isTransient(new Error('ECONNRESET'))).toBe(true);
    });

    it('returns true for ENOTFOUND', () => {
      expect(isTransient(new Error('ENOTFOUND'))).toBe(true);
    });

    it('returns true for 5xx status errors', () => {
      expect(isTransient(new Error('API returned 500'))).toBe(true);
      expect(isTransient(new Error('API returned 502'))).toBe(true);
      expect(isTransient(new Error('API returned 503'))).toBe(true);
    });

    it('returns false for 4xx status errors', () => {
      expect(isTransient(new Error('API returned 400'))).toBe(false);
      expect(isTransient(new Error('API returned 404'))).toBe(false);
      expect(isTransient(new Error('API returned 429'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isTransient('string error')).toBe(false);
      expect(isTransient(null)).toBe(false);
      expect(isTransient(undefined)).toBe(false);
    });

    it('returns false for unrelated error messages', () => {
      expect(isTransient(new Error('validation failed'))).toBe(false);
      expect(isTransient(new Error('parse error'))).toBe(false);
    });
  });

  describe('buildUrl', () => {
    it('joins base and path', () => {
      expect(buildUrl('https://api.example.com', '/v2/orgs')).toBe(
        'https://api.example.com/v2/orgs',
      );
    });

    it('strips trailing slashes from base', () => {
      expect(buildUrl('https://api.example.com/', '/search')).toBe(
        'https://api.example.com/search',
      );
      expect(buildUrl('https://api.example.com///', '/search')).toBe(
        'https://api.example.com/search',
      );
    });
  });
});
