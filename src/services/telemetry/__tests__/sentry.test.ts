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

vi.mock('@sentry/nextjs', () => sentryMocks);

async function loadSentryModule() {
  return import('../sentry');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mutableEnv.NEXT_PUBLIC_SENTRY_DSN;
  delete mutableEnv.NODE_ENV;
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

  it('captures redacted messages with scope tags', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
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

  it('adds sanitized breadcrumbs when configured', async () => {
    mutableEnv.NEXT_PUBLIC_SENTRY_DSN = 'https://dsn';
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
});
