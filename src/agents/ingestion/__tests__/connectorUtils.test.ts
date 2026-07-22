import { describe, expect, it, vi } from 'vitest';

import {
  buildUrl,
  fetchWithValidatedRedirects,
  isTransient,
  sha256,
  stableStringify,
} from '../connectorUtils';

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 as const }];

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

  describe('fetchWithValidatedRedirects', () => {
    it('checks and follows each redirect manually', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { Location: '/feed/final' },
        }))
        .mockResolvedValueOnce(new Response('[]', { status: 200 }));

      const response = await fetchWithValidatedRedirects(
        'https://api.example.org/feed/start',
        fetchMock as never,
        { endpointLabel: 'test feed URL', maxRedirects: 1, resolver: publicResolver },
      );

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://api.example.org/feed/start',
        expect.objectContaining({ redirect: 'manual' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.example.org/feed/final',
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('rejects a prohibited redirect before requesting its target', async () => {
      vi.stubEnv('VERCEL_ENV', 'production');
      const prohibitedTarget = 'https://legacy.azure-mobile.net/tables/resources';
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: prohibitedTarget },
      }));

      await expect(fetchWithValidatedRedirects(
        'https://api.example.org/feed/start',
        fetchMock as never,
        { endpointLabel: 'test feed URL', resolver: publicResolver },
      )).rejects.toThrow('prohibited Microsoft endpoint');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.some(([url]) => String(url) === prohibitedTarget)).toBe(false);
      vi.unstubAllEnvs();
    });

    it('blocks private literal targets before issuing a request', async () => {
      const fetchMock = vi.fn();

      await expect(fetchWithValidatedRedirects(
        'http://169.254.169.254/latest/meta-data',
        fetchMock as never,
        { endpointLabel: 'test feed URL', resolver: publicResolver },
      )).rejects.toMatchObject({ code: 'blocked_address' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cancels redirect bodies and blocks sensitive headers from crossing origins', async () => {
      const redirect = new Response('discard me', {
        status: 307,
        headers: { Location: 'https://other.example.org/feed' },
      });
      const cancel = vi.spyOn(redirect.body!, 'cancel');
      const fetchMock = vi.fn().mockResolvedValueOnce(redirect);

      await expect(fetchWithValidatedRedirects(
        'https://api.example.org/feed',
        fetchMock as never,
        {
          endpointLabel: 'test feed URL',
          resolver: publicResolver,
          requestInit: {
            headers: { 'Ocp-Apim-Subscription-Key': 'do-not-forward' },
          },
        },
      )).rejects.toThrow('invalid or prohibited Location');

      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid redirect budget before issuing a request', async () => {
      const fetchMock = vi.fn();

      await expect(fetchWithValidatedRedirects(
        'https://api.example.org/feed',
        fetchMock as never,
        { endpointLabel: 'test feed URL', maxRedirects: 11, resolver: publicResolver },
      )).rejects.toThrow('integer between 0 and 10');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
