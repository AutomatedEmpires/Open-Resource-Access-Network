import { describe, expect, it, vi } from 'vitest';

import {
  createValidatedLookup,
  OutboundHttpPolicyError,
  isPublicOutboundAddress,
  parseOutboundHttpUrl,
  validateOutboundHttpUrl,
  type OutboundDnsResolver,
} from '../outboundHttpPolicy';

function resolver(...addresses: Array<{ address: string; family: 4 | 6 }>): OutboundDnsResolver {
  return vi.fn(async () => addresses);
}

describe('outbound HTTP policy', () => {
  it.each([
    'http://localhost/admin',
    'http://api.internal/latest',
    'http://printer/status',
    'http://service.local/path',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://169.254.169.254/latest/meta-data',
    'http://10.1.2.3/',
    'http://172.31.1.2/',
    'http://192.168.1.2/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00:ec2::254]/latest/meta-data',
    'http://[fe80::1]/',
  ])('blocks local, private, metadata, and alternate-literal target %s', (url) => {
    expect(() => parseOutboundHttpUrl(url)).toThrow(OutboundHttpPolicyError);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://resources.example.org/feed',
    'data:text/plain,secret',
    'https://user:secret@resources.example.org/feed',
    'https://legacy.azure-mobile.net/tables/resources',
  ])('rejects unsafe scheme or embedded credentials in %s', (url) => {
    expect(() => parseOutboundHttpUrl(url)).toThrow(OutboundHttpPolicyError);
  });

  it('accepts public HTTP targets without rewriting them', () => {
    expect(parseOutboundHttpUrl('https://resources.example.org/feed').href)
      .toBe('https://resources.example.org/feed');
    expect(parseOutboundHttpUrl('https://93.184.216.34/feed').hostname)
      .toBe('93.184.216.34');
  });

  it('accepts a hostname only when every resolved address is public', async () => {
    const safeResolver = resolver(
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    );

    await expect(validateOutboundHttpUrl('https://resources.example.org/feed', {
      resolver: safeResolver,
    })).resolves.toMatchObject({
      url: expect.objectContaining({ hostname: 'resources.example.org' }),
      addresses: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ],
    });
    expect(safeResolver).toHaveBeenCalledWith('resources.example.org');
  });

  it('fails closed when any DNS answer is private', async () => {
    await expect(validateOutboundHttpUrl('https://resources.example.org/feed', {
      resolver: resolver(
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ),
    })).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('fails closed for empty, malformed, and family-mismatched DNS answers', async () => {
    await expect(validateOutboundHttpUrl('https://resources.example.org', {
      resolver: resolver(),
    })).rejects.toMatchObject({ code: 'dns_resolution_failed' });
    await expect(validateOutboundHttpUrl('https://resources.example.org', {
      resolver: resolver({ address: 'not-an-ip', family: 4 }),
    })).rejects.toMatchObject({ code: 'dns_resolution_failed' });
    await expect(validateOutboundHttpUrl('https://resources.example.org', {
      resolver: resolver({ address: '93.184.216.34', family: 6 }),
    })).rejects.toMatchObject({ code: 'dns_resolution_failed' });
  });

  it('aborts pending DNS resolution at the request deadline', async () => {
    const controller = new AbortController();
    const pendingResolver: OutboundDnsResolver = () => new Promise(() => undefined);
    const validation = validateOutboundHttpUrl('https://resources.example.org', {
      resolver: pendingResolver,
      signal: controller.signal,
    });

    controller.abort(new Error('deadline'));
    await expect(validation).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects an already-aborted request even for an IP literal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline'));

    await expect(validateOutboundHttpUrl('https://93.184.216.34/feed', {
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects a private DNS rebinding answer during socket lookup', async () => {
    const rebindingResolver = vi.fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 as const }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 as const }]);

    await expect(validateOutboundHttpUrl('https://resources.example.org/feed', {
      resolver: rebindingResolver,
    })).resolves.toMatchObject({
      addresses: [{ address: '93.184.216.34', family: 4 }],
    });

    const lookup = createValidatedLookup(rebindingResolver);
    const lookupError = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      lookup('resources.example.org', { all: false, family: 0 }, (error) => resolve(error));
    });

    expect(lookupError).toMatchObject({ code: 'EHOSTUNREACH' });
    expect(rebindingResolver).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['8.8.8.8', true],
    ['93.184.216.34', true],
    ['2606:4700:4700::1111', true],
    ['0.0.0.0', false],
    ['100.64.0.1', false],
    ['198.51.100.9', false],
    ['224.0.0.1', false],
    ['::', false],
    ['2001:db8::1', false],
    ['fc00::1', false],
    ['fec0::1', false],
  ])('classifies %s public=%s', (address, expected) => {
    expect(isPublicOutboundAddress(address)).toBe(expected);
  });
});
