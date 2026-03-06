import { beforeEach, describe, expect, it, vi } from 'vitest';

const scopeMocks = vi.hoisted(() => ({
  setExtra: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
}));

const sentryMocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((callback: (scope: typeof scopeMocks) => void) => {
    callback(scopeMocks);
  }),
}));
const mutableEnv = process.env as Record<string, string | undefined>;

async function loadSentryModule() {
  return import('../sentry');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mutableEnv.NEXT_PUBLIC_SENTRY_DSN;
  delete mutableEnv.NEXT_PUBLIC_TELEMETRY_INTERACTIONS;
  delete mutableEnv.NODE_ENV;
  (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = undefined;
  (globalThis as unknown as { window?: unknown }).window = undefined;
});

describe('sentry telemetry wrapper', () => {
  it('no-ops when no DSN is configured', async () => {
    const { captureException } = await loadSentryModule();

    await captureException(new Error('boom'));

    expect(sentryMocks.withScope).not.toHaveBeenCalled();
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  it('captures sanitized exceptions with context when configured', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
    (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = sentryMocks;
    const { captureException } = await loadSentryModule();

    await captureException(new Error('boom'), {
      sessionId: 'session-1',
      userId: 'user-1',
      feature: 'api_test',
      extra: {
        safe: 'ok',
        comment: 'drop me',
        contact: 'user@example.org',
        count: 2,
      },
    });

    expect(sentryMocks.withScope).toHaveBeenCalledOnce();
    expect(scopeMocks.setTag).toHaveBeenCalledWith('sessionId', 'session-1');
    expect(scopeMocks.setTag).toHaveBeenCalledWith('feature', 'api_test');
    expect(scopeMocks.setUser).toHaveBeenCalledWith({ id: 'user-1' });
    expect(scopeMocks.setExtra).toHaveBeenCalledWith('safe', 'ok');
    expect(scopeMocks.setExtra).toHaveBeenCalledWith('contact', '[redacted]');
    expect(scopeMocks.setExtra).toHaveBeenCalledWith('count', 2);
    expect(sentryMocks.captureException).toHaveBeenCalledWith(expect.any(Error));
    const sentryError = sentryMocks.captureException.mock.calls[0][0] as Error;
    expect(sentryError.name).toBe('Error');
    expect(sentryError.message).toBe('Error');
  });

  it('sanitizes non-Error inputs into safe error names', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
    (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = sentryMocks;
    const { captureException } = await loadSentryModule();

    await captureException('something broke');
    await captureException({ name: '  CustomOops  ' });
    await captureException(null);

    expect(sentryMocks.captureException).toHaveBeenCalledTimes(3);
    const first = sentryMocks.captureException.mock.calls[0][0] as Error;
    const second = sentryMocks.captureException.mock.calls[1][0] as Error;
    const third = sentryMocks.captureException.mock.calls[2][0] as Error;
    expect(first.name).toBe('StringError');
    expect(second.name).toBe('CustomOops');
    expect(third.name).toBe('UnknownError');
  });

  it('captures redacted messages with scope tags', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
    (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = sentryMocks;
    const { captureMessage } = await loadSentryModule();

    await captureMessage('contact me at user@example.org', 'warning', {
      sessionId: 'session-2',
      feature: 'chat',
    });

    expect(sentryMocks.withScope).toHaveBeenCalledOnce();
    expect(scopeMocks.setTag).toHaveBeenCalledWith('sessionId', 'session-2');
    expect(scopeMocks.setTag).toHaveBeenCalledWith('feature', 'chat');
    expect(sentryMocks.captureMessage).toHaveBeenCalledWith('[redacted]', 'warning');
  });

  it('logs captureMessage in development mode', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
    mutableEnv.NODE_ENV = 'development';
    (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = sentryMocks;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { captureMessage } = await loadSentryModule();

    await captureMessage('debug me', 'info', { feature: 'dev-mode' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('adds sanitized breadcrumbs when configured', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
    (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = sentryMocks;
    const { addBreadcrumb } = await loadSentryModule();

    await addBreadcrumb({
      message: 'Call user@example.org',
      category: 'auth',
      level: 'info',
      data: {
        token: 'secret',
        ip: '203.0.113.5',
      },
    });

    expect(sentryMocks.addBreadcrumb).toHaveBeenCalledWith({
      message: '[redacted]',
      category: 'auth',
      level: 'info',
      data: { ip: '[redacted]' },
    });
  });

  it('trackInteraction is gated and emits breadcrumb when enabled', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
    (globalThis as { __ORAN_SENTRY__?: unknown }).__ORAN_SENTRY__ = sentryMocks;
    const { trackInteraction } = await loadSentryModule();

    trackInteraction('click.noop', { safe: true });
    expect(sentryMocks.addBreadcrumb).not.toHaveBeenCalled();

    mutableEnv.NEXT_PUBLIC_TELEMETRY_INTERACTIONS = 'true';
    mutableEnv.NODE_ENV = 'development';
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    trackInteraction('click.enabled', { count: 1 });

    await vi.waitFor(() => {
      expect(sentryMocks.addBreadcrumb).toHaveBeenCalled();
    });
    expect(debugSpy).toHaveBeenCalled();
  });

  it('returns early in browser-like runtime without injected sentry', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
    const withWindow = globalThis as unknown as { window?: unknown };
    withWindow.window = {};

    const { captureMessage } = await loadSentryModule();
    await captureMessage('browser runtime');
    expect(sentryMocks.withScope).not.toHaveBeenCalled();

    withWindow.window = undefined;
  });
});
