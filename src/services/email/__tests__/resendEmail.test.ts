import { beforeEach, describe, expect, it, vi } from 'vitest';

const resendCtorMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: resendCtorMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();

  sendMock.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
  resendCtorMock.mockImplementation(function mockResend() {
    return {
      emails: {
        send: sendMock,
      },
    };
  });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('Resend email service', () => {
  it('requires both the API key and sender configuration', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', '');
    const unconfigured = await import('../resendEmail');
    expect(unconfigured.isEmailConfigured()).toBe(false);

    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', '');
    const missingSender = await import('../resendEmail');
    expect(missingSender.isEmailConfigured()).toBe(false);

    vi.resetModules();
    vi.stubEnv('RESEND_FROM', 'ORAN <notifications@openresourceaccessnetwork.com>');
    const configured = await import('../resendEmail');
    expect(configured.isEmailConfigured()).toBe(true);
  });

  it('returns null without constructing a client when configuration is incomplete', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendEmail } = await import('../resendEmail');

    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(result).toBeNull();
    expect(resendCtorMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[email] Resend not configured — skipping email delivery',
    );
    warnSpy.mockRestore();
  });

  it('sends text and HTML content with the configured sender and returns the message ID', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'ORAN <alerts@openresourceaccessnetwork.com>');
    const { sendEmail } = await import('../resendEmail');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'SLA Breach Alert',
      text: 'Deadline exceeded',
      html: '<p>Deadline exceeded</p>',
    });

    expect(result).toBe('msg-1');
    expect(resendCtorMock).toHaveBeenCalledWith('re_test');
    expect(sendMock).toHaveBeenCalledWith({
      from: 'ORAN <alerts@openresourceaccessnetwork.com>',
      to: 'recipient@example.com',
      subject: 'SLA Breach Alert',
      text: 'Deadline exceeded',
      html: '<p>Deadline exceeded</p>',
    });
  });

  it('returns null when Resend returns no message ID', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'ORAN <alerts@openresourceaccessnetwork.com>');
    sendMock.mockResolvedValueOnce({ data: {}, error: null });
    const { sendEmail } = await import('../resendEmail');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      text: 'Body',
    });

    expect(result).toBeNull();
  });

  it('captures and suppresses API failures without logging provider details', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'ORAN <alerts@openresourceaccessnetwork.com>');
    const providerError = {
      name: 'validation_error',
      message: 'recipient@example.com was rejected',
    };
    sendMock.mockResolvedValueOnce({ data: null, error: providerError });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendEmail } = await import('../resendEmail');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      text: 'Body',
    });

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledWith(providerError, {
      feature: 'email_send',
      extra: { provider: 'resend' },
    });
    expect(errorSpy).toHaveBeenCalledWith('[email] Failed to send email via Resend');
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('recipient@example.com'));
    errorSpy.mockRestore();
  });

  it('captures and suppresses thrown failures', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'ORAN <alerts@openresourceaccessnetwork.com>');
    const providerError = new Error('network failed');
    sendMock.mockRejectedValueOnce(providerError);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendEmail } = await import('../resendEmail');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      text: 'Body',
    });

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledWith(providerError, {
      feature: 'email_send',
      extra: { provider: 'resend' },
    });
    expect(errorSpy).toHaveBeenCalledWith('[email] Failed to send email via Resend');
    errorSpy.mockRestore();
  });

  it('resets the singleton client between calls in tests', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'ORAN <alerts@openresourceaccessnetwork.com>');
    const service = await import('../resendEmail');

    await service.sendEmail({
      to: 'first@example.com',
      subject: 'First',
      text: 'First body',
    });

    service._resetClient();

    await service.sendEmail({
      to: 'second@example.com',
      subject: 'Second',
      text: 'Second body',
    });

    expect(resendCtorMock).toHaveBeenCalledTimes(2);
  });
});
