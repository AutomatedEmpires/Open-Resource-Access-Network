import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('Resend email service', () => {
  it('reports configured state from RESEND_API_KEY', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const notConfigured = await import('../resend');
    expect(notConfigured.isEmailConfigured()).toBe(false);

    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    const configured = await import('../resend');
    expect(configured.isEmailConfigured()).toBe(true);
  });

  it('returns null and skips the network call when not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendEmail } = await import('../resend');

    const result = await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Hello' });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[email] Resend not configured — skipping email delivery');
    warnSpy.mockRestore();
  });

  it('sends via Resend REST and returns the message id', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('RESEND_FROM', 'ORAN <alerts@oran.example>');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: 'email_123' }));
    const { sendEmail } = await import('../resend');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'SLA Breach Alert',
      text: 'Deadline exceeded',
      html: '<p>Deadline exceeded</p>',
    });

    expect(result).toBe('email_123');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'ORAN <alerts@oran.example>',
      to: ['recipient@example.com'],
      subject: 'SLA Breach Alert',
      text: 'Deadline exceeded',
      html: '<p>Deadline exceeded</p>',
    });
  });

  it('falls back to a default sender and tolerates a missing id', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({}));
    const { sendEmail } = await import('../resend');

    const result = await sendEmail({ to: 'r@example.com', subject: 'S', text: 'B' });

    expect(result).toBeNull();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe('ORAN <onboarding@resend.dev>');
  });

  it('returns null on a non-2xx response', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'bad' }, { ok: false, status: 422 }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendEmail } = await import('../resend');

    const result = await sendEmail({ to: 'r@example.com', subject: 'S', text: 'B' });

    expect(result).toBeNull();
    errorSpy.mockRestore();
  });

  it('captures and suppresses network failures', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('send failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendEmail } = await import('../resend');

    const result = await sendEmail({ to: 'r@example.com', subject: 'S', text: 'B' });

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), { feature: 'email_send' });
    errorSpy.mockRestore();
  });
});
