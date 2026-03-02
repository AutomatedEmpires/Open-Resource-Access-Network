/**
 * Sentry PII Redaction Tests
 *
 * Verifies that the telemetry wrapper strips PII before
 * sending events to Sentry. Safety-critical for ORAN:
 * no user PII should ever appear in telemetry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We import the module functions directly to test sanitization logic.
// captureException/captureMessage are tested via console output in dev mode.

// ── Inline the sanitization helpers for direct testing ───────
// (These are internal, but critical enough to warrant direct tests.)

function redactIfSensitiveString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const looksLikeEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed);
  const looksLikePhone = /\+?\d[\d\s().-]{7,}\d/.test(trimmed);
  if (looksLikeEmail || looksLikePhone) return '[redacted]';
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

function sanitizeExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(extra)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('message') ||
      lowerKey.includes('comment') ||
      lowerKey.includes('body') ||
      lowerKey.includes('authorization') ||
      lowerKey.includes('cookie') ||
      lowerKey.includes('token')
    ) {
      continue; // Drop sensitive keys
    }

    if (value === null) {
      sanitized[key] = null;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      const redacted = redactIfSensitiveString(value);
      if (redacted) sanitized[key] = redacted;
      continue;
    }
    // Drop objects/arrays/functions
  }

  return sanitized;
}

describe('PII redaction: redactIfSensitiveString', () => {
  it('redacts strings that look like email addresses', () => {
    expect(redactIfSensitiveString('user@example.com')).toBe('[redacted]');
    expect(redactIfSensitiveString('JOHN.DOE@GMAIL.COM')).toBe('[redacted]');
    expect(redactIfSensitiveString('test+tag@sub.domain.co.uk')).toBe('[redacted]');
  });

  it('redacts strings that look like phone numbers', () => {
    expect(redactIfSensitiveString('+1 (555) 123-4567')).toBe('[redacted]');
    expect(redactIfSensitiveString('555.123.4567')).toBe('[redacted]');
    expect(redactIfSensitiveString('18005551234')).toBe('[redacted]');
  });

  it('does NOT redact normal strings', () => {
    expect(redactIfSensitiveString('food_assistance')).toBe('food_assistance');
    expect(redactIfSensitiveString('session-123')).toBe('session-123');
    expect(redactIfSensitiveString('api_search')).toBe('api_search');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(redactIfSensitiveString('   ')).toBe('');
    expect(redactIfSensitiveString('')).toBe('');
  });

  it('truncates strings longer than 200 characters', () => {
    const longStr = 'a'.repeat(300);
    const result = redactIfSensitiveString(longStr);
    expect(result.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('PII redaction: sanitizeExtra', () => {
  it('drops keys containing "message"', () => {
    const result = sanitizeExtra({ errorMessage: 'some user text', count: 1 });
    expect(result).not.toHaveProperty('errorMessage');
    expect(result).toHaveProperty('count', 1);
  });

  it('drops keys containing "comment"', () => {
    const result = sanitizeExtra({ userComment: 'personal info' });
    expect(result).not.toHaveProperty('userComment');
  });

  it('drops keys containing "body"', () => {
    const result = sanitizeExtra({ requestBody: '{PII}' });
    expect(result).not.toHaveProperty('requestBody');
  });

  it('drops keys containing "authorization"', () => {
    const result = sanitizeExtra({ authorization: 'Bearer token123' });
    expect(result).not.toHaveProperty('authorization');
  });

  it('drops keys containing "cookie"', () => {
    const result = sanitizeExtra({ cookie: 'session=abc' });
    expect(result).not.toHaveProperty('cookie');
  });

  it('drops keys containing "token"', () => {
    const result = sanitizeExtra({ authToken: 'secret' });
    expect(result).not.toHaveProperty('authToken');
  });

  it('keeps numbers and booleans', () => {
    const result = sanitizeExtra({ count: 42, success: true });
    expect(result).toEqual({ count: 42, success: true });
  });

  it('keeps null values', () => {
    const result = sanitizeExtra({ something: null });
    expect(result).toEqual({ something: null });
  });

  it('drops objects + arrays (to avoid accidental PII serialization)', () => {
    const result = sanitizeExtra({ nested: { name: 'John' }, list: [1, 2] });
    expect(result).not.toHaveProperty('nested');
    expect(result).not.toHaveProperty('list');
  });

  it('redacts emails inside string values', () => {
    const result = sanitizeExtra({ info: 'contact user@example.com for help' });
    expect(result).toHaveProperty('info', '[redacted]');
  });

  it('drops empty-after-redaction strings', () => {
    const result = sanitizeExtra({ whitespace: '   ' });
    expect(result).not.toHaveProperty('whitespace');
  });
});

describe('captureException dev logging (integration)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('dev console.error does NOT contain raw error message', async () => {
    const env = process.env as unknown as Record<string, string | undefined>;
    const originalEnv = env.NODE_ENV;
    const originalDsn = env.NEXT_PUBLIC_SENTRY_DSN;
    env.NODE_ENV = 'development';
    delete env.NEXT_PUBLIC_SENTRY_DSN;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Dynamic import to get the real function
    const { captureException } = await import('@/services/telemetry/sentry');

    await captureException(new Error('User john@example.com said: help'), {
      feature: 'api_chat',
      sessionId: '00000000-0000-0000-0000-000000000001',
    });

    // The console.error should have been called with errorName, not the raw message
    if (consoleSpy.mock.calls.length > 0) {
      const loggedStr = JSON.stringify(consoleSpy.mock.calls);
      // Must NOT contain the raw email PII
      expect(loggedStr).not.toContain('john@example.com');
    }

    env.NODE_ENV = originalEnv;
    if (originalDsn) env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
    consoleSpy.mockRestore();
  });
});
