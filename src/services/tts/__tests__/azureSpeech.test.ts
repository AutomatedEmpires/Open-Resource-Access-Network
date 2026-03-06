import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Azure Speech TTS service', () => {
  it('reports configuration state from environment', async () => {
    const tts = await import('../azureSpeech');
    expect(tts.isConfigured()).toBe(false);

    vi.stubEnv('AZURE_SPEECH_KEY', 'key');
    vi.stubEnv('AZURE_SPEECH_REGION', 'eastus');
    vi.resetModules();
    const configured = await import('../azureSpeech');
    expect(configured.isConfigured()).toBe(true);
  });

  it('fails open when service is not configured', async () => {
    const { synthesizeSpeech } = await import('../azureSpeech');

    const result = await synthesizeSpeech('hello');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds SSML with escaped text and locale voice mapping', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'key-1');
    vi.stubEnv('AZURE_SPEECH_REGION', 'eastus');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const { synthesizeSpeech } = await import('../azureSpeech');
    const result = await synthesizeSpeech('Tom & "Jerry" <cats>', { locale: 'es-MX' });

    expect(result).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(
      expect.objectContaining({
        'Ocp-Apim-Subscription-Key': 'key-1',
        'Content-Type': 'application/ssml+xml',
      }),
    );

    const body = String(init.body);
    expect(body).toContain('name="es-US-AlonsoNeural"');
    expect(body).toContain('xml:lang="es-MX"');
    expect(body).toContain('Tom &amp; &quot;Jerry&quot; &lt;cats&gt;');
  });

  it('falls back to default voice/locale and truncates text to 2000 chars', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'key-2');
    vi.stubEnv('AZURE_SPEECH_REGION', 'westus2');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([4, 5]).buffer,
    });

    const longText = 'a'.repeat(2100);
    const { synthesizeSpeech } = await import('../azureSpeech');
    await synthesizeSpeech(longText, { locale: 'xx' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain('name="en-US-JennyNeural"');
    expect(body).toContain('xml:lang="en-US"');

    const voiceMatch = body.match(/<voice[^>]*>([\s\S]*)<\/voice>/);
    expect(voiceMatch?.[1].length).toBe(2000);
  });

  it('returns null when Azure Speech returns non-ok', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'key-3');
    vi.stubEnv('AZURE_SPEECH_REGION', 'eastus2');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { synthesizeSpeech } = await import('../azureSpeech');
    const result = await synthesizeSpeech('hello');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('[tts] Azure Speech returned 429');
    warnSpy.mockRestore();
  });

  it('returns null when fetch throws', async () => {
    vi.stubEnv('AZURE_SPEECH_KEY', 'key-4');
    vi.stubEnv('AZURE_SPEECH_REGION', 'eastus');
    fetchMock.mockRejectedValueOnce(new Error('network fail'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { synthesizeSpeech } = await import('../azureSpeech');
    const result = await synthesizeSpeech('hello');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('[tts] Azure Speech error: Error');
    warnSpy.mockRestore();
  });
});
