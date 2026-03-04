import { describe, expect, it } from 'vitest';
import { getIp } from '../ip';

function createRequest(headers: Record<string, string> = {}, ip?: string) {
  const nextHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    nextHeaders.set(key, value);
  }

  return {
    headers: nextHeaders,
    ip,
  } as never;
}

describe('getIp', () => {
  it('prefers the first x-forwarded-for value', () => {
    const req = createRequest({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });

    expect(getIp(req)).toBe('203.0.113.1');
  });

  it('falls back to x-real-ip', () => {
    const req = createRequest({ 'x-real-ip': '203.0.113.2' });

    expect(getIp(req)).toBe('203.0.113.2');
  });

  it('falls back to req.ip when headers are absent', () => {
    const req = createRequest({}, '203.0.113.3');

    expect(getIp(req)).toBe('203.0.113.3');
  });

  it('returns unknown when no IP source is present', () => {
    expect(getIp(createRequest())).toBe('unknown');
  });
});
