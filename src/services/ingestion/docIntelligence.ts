/**
 * ORAN Document Intelligence — Idea 13 (Phase 5)
 *
 * Extracts structured text from PDF documents using Azure Document Intelligence
 * (prebuilt-layout model). Used during ingestion when a submitted URL points to a
 * PDF file, allowing the extraction pipeline to work on the document's text.
 *
 * GUARANTEES:
 * - Fail-open: any error returns null so the caller can proceed without extracted text.
 * - Only the document URL is sent — no PII, no session data.
 * - Polls up to MAX_POLL_ATTEMPTS with POLL_INTERVAL_MS between each.
 *
 * Requires env:
 *   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT — AIServices endpoint (ORAN-FOUNDRY-resource)
 *   AZURE_DOCUMENT_INTELLIGENCE_KEY       — subscription key
 *
 * Azure Document Intelligence REST API version: 2024-11-30
 */

// ============================================================
// TYPES
// ============================================================

export interface DocAnalysisResult {
  /** Full extracted text content from all pages. Capped at 50 000 characters. */
  text: string;
  /** Number of pages detected in the document. */
  pages: number;
  /** Model used for extraction, e.g. "prebuilt-layout". */
  modelId: string;
}

// ============================================================
// CONSTANTS
// ============================================================

const API_VERSION = '2024-11-30';
const MODEL_ID = 'prebuilt-layout';
const MAX_POLL_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TEXT_LENGTH = 50_000;

// Header name differs from Azure OpenAI
const SUBSCRIPTION_KEY_HEADER = 'Ocp-Apim-Subscription-Key';

// ============================================================
// HELPERS
// ============================================================

function getConfig(): { endpoint: string; key: string } | null {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), key };
}

export function isDocIntelligenceConfigured(): boolean {
  return getConfig() !== null;
}

/** Returns true for URLs that are likely PDFs by extension or path. */
export function isPdfUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.pdf');
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// CORE
// ============================================================

/**
 * Submits a PDF URL to Document Intelligence for extraction and polls for the result.
 *
 * @param url — Publicly accessible HTTPS URL pointing to a PDF document.
 * @returns Extracted text + metadata, or null on any failure (fail-open).
 */
export async function analyzeDocument(url: string): Promise<DocAnalysisResult | null> {
  const config = getConfig();
  if (!config) return null;

  const analyzeUrl =
    `${config.endpoint}/documentintelligence/documentModels/${MODEL_ID}:analyze` +
    `?api-version=${API_VERSION}`;

  // Step 1: Submit the analysis job
  let submitResponse: Response;
  try {
    submitResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SUBSCRIPTION_KEY_HEADER]: config.key,
      },
      body: JSON.stringify({ urlSource: url }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (submitResponse.status !== 202) return null;

  const operationLocation = submitResponse.headers.get('Operation-Location');
  if (!operationLocation) return null;

  // Step 2: Poll the operation URL until succeeded or failed
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    let pollResponse: Response;
    try {
      pollResponse = await fetch(operationLocation, {
        headers: { [SUBSCRIPTION_KEY_HEADER]: config.key },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return null;
    }

    if (!pollResponse.ok) return null;

    let pollData: unknown;
    try {
      pollData = await pollResponse.json();
    } catch {
      return null;
    }

    const data = pollData as {
      status?: string;
      analyzeResult?: {
        content?: string;
        pages?: Array<unknown>;
        modelId?: string;
      };
    };

    if (data.status === 'failed') return null;
    if (data.status === 'succeeded') {
      const content = data.analyzeResult?.content ?? '';
      const pages = data.analyzeResult?.pages?.length ?? 0;
      const modelId = data.analyzeResult?.modelId ?? MODEL_ID;

      return {
        text: content.slice(0, MAX_TEXT_LENGTH),
        pages,
        modelId,
      };
    }
    // status is 'running' or 'notStarted' — keep polling
  }

  // Timed out waiting for result
  return null;
}
