import { beforeEach, describe, expect, it, vi } from 'vitest';

const emailClientCtorMock = vi.hoisted(() => vi.fn());
const beginSendMock = vi.hoisted(() => vi.fn());
const pollUntilDoneMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@azure/communication-email', () => ({
  EmailClient: emailClientCtorMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();

  pollUntilDoneMock.mockResolvedValue({ id: 'msg-1' });
  beginSendMock.mockResolvedValue({ pollUntilDone: pollUntilDoneMock });
  emailClientCtorMock.mockImplementation(function mockEmailClient() {
    return {
      beginSend: beginSendMock,
    };
  });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('Azure Email Service', () => {
  it('reports configured state from environment', async () => {
    vi.stubEnv('AZURE_COMMUNICATION_CONNECTION_STRING', '');
    const notConfigured = await import('../azureEmail');
    expect(notConfigured.isEmailConfigured()).toBe(false);

    vi.resetModules();
    vi.stubEnv(
      'AZURE_COMMUNICATION_CONNECTION_STRING',
      'endpoint=https://test.comm.azure.com/;accesskey=abc',
    );
    const configured = await import('../azureEmail');
    expect(configured.isEmailConfigured()).toBe(true);
  });

  it('returns null when service is not configured', async () => {
    vi.stubEnv('AZURE_COMMUNICATION_CONNECTION_STRING', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sendEmail } = await import('../azureEmail');

    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(result).toBeNull();
    expect(emailClientCtorMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[email] Azure Communication Services not configured — skipping email delivery',
    );
    warnSpy.mockRestore();
  });

  it('sends email and returns message id using configured sender address', async () => {
    vi.stubEnv(
      'AZURE_COMMUNICATION_CONNECTION_STRING',
      'endpoint=https://test.comm.azure.com/;accesskey=abc',
    );
    vi.stubEnv('AZURE_COMMUNICATION_SENDER_ADDRESS', 'alerts@oran.azure.com');
    const { sendEmail } = await import('../azureEmail');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'SLA Breach Alert',
      text: 'Deadline exceeded',
      html: '<p>Deadline exceeded</p>',
    });

    expect(result).toBe('msg-1');
    expect(emailClientCtorMock).toHaveBeenCalledTimes(1);
    expect(beginSendMock).toHaveBeenCalledWith({
      senderAddress: 'alerts@oran.azure.com',
      content: {
        subject: 'SLA Breach Alert',
        plainText: 'Deadline exceeded',
        html: '<p>Deadline exceeded</p>',
      },
      recipients: {
        to: [{ address: 'recipient@example.com' }],
      },
    });
  });

  it('falls back to default sender and null id handling', async () => {
    vi.stubEnv(
      'AZURE_COMMUNICATION_CONNECTION_STRING',
      'endpoint=https://test.comm.azure.com/;accesskey=abc',
    );
    pollUntilDoneMock.mockResolvedValueOnce({});
    const { sendEmail } = await import('../azureEmail');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      text: 'Body',
    });

    expect(result).toBeNull();
    expect(beginSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: 'DoNotReply@oran.azure.com',
      }),
    );
  });

  it('captures and suppresses send failures', async () => {
    vi.stubEnv(
      'AZURE_COMMUNICATION_CONNECTION_STRING',
      'endpoint=https://test.comm.azure.com/;accesskey=abc',
    );
    beginSendMock.mockRejectedValueOnce(new Error('send failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendEmail } = await import('../azureEmail');

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Subject',
      text: 'Body',
    });

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'email_send',
    });
    expect(errorSpy).toHaveBeenCalledWith('[email] Failed to send email:', 'send failed');
    errorSpy.mockRestore();
  });

  it('resets singleton client between calls in tests', async () => {
    vi.stubEnv(
      'AZURE_COMMUNICATION_CONNECTION_STRING',
      'endpoint=https://test.comm.azure.com/;accesskey=abc',
    );
    const svc = await import('../azureEmail');

    await svc.sendEmail({
      to: 'first@example.com',
      subject: 'First',
      text: 'First body',
    });

    svc._resetClient();

    await svc.sendEmail({
      to: 'second@example.com',
      subject: 'Second',
      text: 'Second body',
    });

    expect(emailClientCtorMock).toHaveBeenCalledTimes(2);
  });
});
