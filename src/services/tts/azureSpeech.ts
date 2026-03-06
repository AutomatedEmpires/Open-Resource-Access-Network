/**
 * ORAN Azure Speech TTS Service — Idea 15
 *
 * Converts text to speech using Azure Cognitive Services Speech REST API.
 * Returns MP3 audio as a Buffer, or null if not configured or on any error.
 *
 * Privacy: Only the text to synthesize is sent. No user IDs or session IDs.
 * Fail-open: any error returns null so callers degrade gracefully.
 *
 * Free tier (F0): 5 hours/month free.
 * Neural HD (S0): $16/1M chars.
 *
 * Requires env:
 *   AZURE_SPEECH_KEY    — subscription key (Key Vault reference in production)
 *   AZURE_SPEECH_REGION — e.g. eastus
 */

// ============================================================
// TYPES
// ============================================================

export interface TTSOptions {
  /** BCP-47 locale code. Defaults to 'en'. */
  locale?: string;
}

// ============================================================
// CONSTANTS
// ============================================================

const MAX_TEXT_LENGTH = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Locale prefix → Azure Neural voice name */
const LOCALE_TO_VOICE: Readonly<Record<string, string>> = {
  en: 'en-US-JennyNeural',
  es: 'es-US-AlonsoNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ar: 'ar-SA-HamedNeural',
  vi: 'vi-VN-HoaiMyNeural',
  fr: 'fr-FR-DeniseNeural',
};

const DEFAULT_VOICE = 'en-US-JennyNeural';
const DEFAULT_LOCALE = 'en-US';

// ============================================================
// HELPERS
// ============================================================

function getConfig(): { key: string; region: string } | null {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) return null;
  return { key, region };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveVoiceAndLocale(locale: string): { voice: string; xmlLang: string } {
  // Normalise full BCP-47 tags (e.g. "en-US" → "en") before lookup.
  const prefix = locale.split('-')[0].toLowerCase();
  const voice = LOCALE_TO_VOICE[prefix] ?? DEFAULT_VOICE;
  // Use the full tag for xml:lang, falling back to a sensible default.
  const xmlLang = locale.includes('-') ? locale : DEFAULT_LOCALE;
  return { voice, xmlLang };
}

function buildSsml(text: string, voice: string, xmlLang: string): string {
  const escaped = escapeXml(text.slice(0, MAX_TEXT_LENGTH));
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlLang}">` +
    `<voice name="${voice}">${escaped}</voice>` +
    `</speak>`
  );
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Check if Azure Speech TTS is configured.
 */
export function isConfigured(): boolean {
  return !!getConfig();
}

/**
 * Synthesize text to speech and return MP3 audio bytes.
 *
 * @param text - The text to synthesize (truncated to 2000 chars).
 * @param options - Locale and other options.
 * @returns Buffer of MP3 audio, or null if not configured or on any error.
 */
export async function synthesizeSpeech(
  text: string,
  options: TTSOptions = {},
): Promise<Buffer | null> {
  const config = getConfig();
  if (!config) return null;

  const locale = options.locale ?? 'en';
  const { voice, xmlLang } = resolveVoiceAndLocale(locale);
  const ssml = buildSsml(text, voice, xmlLang);
  const endpoint = `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ORAN/1.0',
      },
      body: ssml,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[tts] Azure Speech returned ${res.status}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError';
    console.warn(`[tts] Azure Speech error: ${errName}`);
    return null;
  }
}
