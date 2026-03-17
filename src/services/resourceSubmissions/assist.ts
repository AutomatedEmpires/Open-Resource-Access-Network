import { URL } from 'node:url';

import { createHtmlTextExtractor, createPageFetcher, isFetchError } from '@/agents/ingestion/fetcher';
import { createLLMClient, getLLMConfigFromEnv, type LLMClient } from '@/agents/ingestion/llm';
import '@/agents/ingestion/llm/providers';
import type { ExtractedService } from '@/agents/ingestion/llm/types';
import { CATEGORY_TAGS } from '@/agents/ingestion/tags';
import type { ResourceScheduleDayDraft, ResourceSubmissionDraft } from '@/domain/resourceSubmission';
import {
  previewResourceSubmissionAssist,
  type ResourceSubmissionAssistPatch,
  type ResourceSubmissionAssistResult,
} from '@/services/resourceSubmissions/assistShared';

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_REGEX = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/;

const CATEGORY_TO_PICKER_CATEGORY: Partial<Record<(typeof CATEGORY_TAGS)[number], string>> = {
  legal: 'legal_aid',
  substance_use: 'substance_abuse',
  utilities: 'utility_assistance',
  seniors: 'senior_services',
};

const DIRECT_PICKER_CATEGORIES = new Set([
  'food',
  'housing',
  'healthcare',
  'mental_health',
  'employment',
  'childcare',
  'transportation',
  'education',
  'financial',
  'disability',
]);

const HEURISTIC_CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  { category: 'food', keywords: ['food pantry', 'meals', 'groceries', 'nutrition'] },
  { category: 'housing', keywords: ['housing', 'shelter', 'rent', 'eviction'] },
  { category: 'healthcare', keywords: ['clinic', 'medical', 'health care', 'doctor'] },
  { category: 'mental_health', keywords: ['mental health', 'counseling', 'therapy', 'behavioral'] },
  { category: 'employment', keywords: ['job', 'employment', 'workforce', 'career'] },
  { category: 'legal_aid', keywords: ['legal', 'attorney', 'lawyer', 'court'] },
  { category: 'childcare', keywords: ['child care', 'childcare', 'early learning', 'daycare'] },
  { category: 'transportation', keywords: ['transportation', 'bus pass', 'ride', 'transit'] },
  { category: 'education', keywords: ['education', 'tutoring', 'school', 'training'] },
  { category: 'substance_abuse', keywords: ['substance use', 'addiction', 'recovery', 'detox'] },
  { category: 'financial', keywords: ['financial', 'cash assistance', 'benefit', 'money'] },
  { category: 'disability', keywords: ['disability', 'accessible', 'independent living'] },
  { category: 'senior_services', keywords: ['senior', 'older adults', 'aging'] },
  { category: 'utility_assistance', keywords: ['utility', 'energy bill', 'liheap', 'electric'] },
  { category: 'clothing', keywords: ['clothing', 'closet', 'winter coats'] },
];

export class ResourceSubmissionAssistError extends Error {
  constructor(
    message: string,
    public readonly status: number = 422,
  ) {
    super(message);
    this.name = 'ResourceSubmissionAssistError';
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

function titleCandidate(title: string | null | undefined): string {
  const raw = title?.trim();
  if (!raw) return '';
  return raw.split(/\s+[\-|–|—]\s+/)[0]?.trim() ?? raw;
}

function limitText(value: string | null | undefined, maxLength: number): string {
  const trimmed = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!trimmed) return '';
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function firstParagraph(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentenceBreak = normalized.match(/(.+?[.!?])\s/);
  const candidate = sentenceBreak?.[1] ?? normalized;
  return limitText(candidate, maxLength);
}

function extractEmail(text: string): string {
  return text.match(EMAIL_REGEX)?.[0] ?? '';
}

function extractPhone(text: string): string {
  return text.match(PHONE_REGEX)?.[0] ?? '';
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function buildEvidenceNote(sourceName: string, canonicalUrl: string, description: string): string {
  const summary = description.trim() ? ` Source summary: ${description.trim()}` : '';
  return limitText(
    `AI assist reviewed ${sourceName || hostnameLabel(canonicalUrl)} at ${canonicalUrl}.${summary} Verify hours, eligibility, service area, and contact paths before submission.`,
    1000,
  );
}

function inferCategoriesFromText(text: string): string[] {
  const normalized = text.toLowerCase();
  return HEURISTIC_CATEGORY_KEYWORDS
    .filter((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)))
    .map((entry) => entry.category);
}

function normalizeCategoryTag(tag: string): { category?: string; customTerm?: string } {
  const normalized = tag.trim().toLowerCase();
  if (!normalized || normalized === 'other') {
    return {};
  }
  if (CATEGORY_TO_PICKER_CATEGORY[normalized as keyof typeof CATEGORY_TO_PICKER_CATEGORY]) {
    return { category: CATEGORY_TO_PICKER_CATEGORY[normalized as keyof typeof CATEGORY_TO_PICKER_CATEGORY] };
  }
  if (DIRECT_PICKER_CATEGORIES.has(normalized)) {
    return { category: normalized };
  }
  return { customTerm: normalized.replace(/_/g, ' ') };
}

function createScheduleFromHours(hours: ExtractedService['hours']): ResourceScheduleDayDraft[] {
  if (!hours?.length) {
    return [];
  }

  return hours.map((entry) => ({
    day: `${entry.dayOfWeek[0].toUpperCase()}${entry.dayOfWeek.slice(1)}` as ResourceScheduleDayDraft['day'],
    opens: entry.opensAt ?? '09:00',
    closes: entry.closesAt ?? '17:00',
    closed: entry.isClosed,
  }));
}

function patchFromExtractedService(service: ExtractedService, canonicalUrl: string): ResourceSubmissionAssistPatch {
  return {
    organization: {
      name: service.organizationName,
      url: canonicalUrl,
      email: service.email ?? undefined,
      phone: service.phones[0]?.number ?? undefined,
    },
    service: {
      name: service.serviceName,
      description: service.description,
      url: service.websiteUrl ?? canonicalUrl,
      email: service.email ?? undefined,
      applicationProcess: service.applicationProcess ?? undefined,
      fees: service.fees ?? undefined,
      phones: service.phones.map((phone) => ({
        number: phone.number,
        extension: '',
        type: phone.type === 'sms' ? 'text' : phone.type === 'fax' ? 'fax' : phone.type === 'tty' ? 'tty' : phone.type === 'hotline' ? 'hotline' : 'voice',
        description: phone.context ?? '',
      })),
    },
    locations: service.address ? [{
      address1: service.address.line1,
      address2: service.address.line2 ?? '',
      city: service.address.city,
      stateProvince: service.address.region,
      postalCode: service.address.postalCode,
      country: service.address.country,
      phones: service.phones.map((phone) => ({
        number: phone.number,
        extension: '',
        type: phone.type === 'sms' ? 'text' : phone.type === 'fax' ? 'fax' : phone.type === 'tty' ? 'tty' : phone.type === 'hotline' ? 'hotline' : 'voice',
        description: phone.context ?? '',
      })),
      languages: service.languages,
      schedule: createScheduleFromHours(service.hours),
    }] : undefined,
    access: {
      eligibilityDescription: service.eligibility?.description ?? undefined,
      minimumAge: service.eligibility?.ageMin != null ? String(service.eligibility.ageMin) : undefined,
      maximumAge: service.eligibility?.ageMax != null ? String(service.eligibility.ageMax) : undefined,
      serviceAreas: service.serviceAreaDescription ? [service.serviceAreaDescription] : [],
      languages: service.languages,
      requiredDocuments: service.eligibility?.documentationRequired ?? [],
    },
    evidence: {
      sourceUrl: canonicalUrl,
      contactEmail: service.email ?? undefined,
    },
  };
}

function mergeAssistPatches(
  base: ResourceSubmissionAssistPatch,
  override: ResourceSubmissionAssistPatch,
): ResourceSubmissionAssistPatch {
  return {
    organization: { ...(base.organization ?? {}), ...(override.organization ?? {}) },
    service: { ...(base.service ?? {}), ...(override.service ?? {}) },
    locations: override.locations?.length ? override.locations : base.locations,
    taxonomy: {
      ...(base.taxonomy ?? {}),
      ...(override.taxonomy ?? {}),
      categories: unique([...(base.taxonomy?.categories ?? []), ...(override.taxonomy?.categories ?? [])]),
      customTerms: unique([...(base.taxonomy?.customTerms ?? []), ...(override.taxonomy?.customTerms ?? [])]),
    },
    access: {
      ...(base.access ?? {}),
      ...(override.access ?? {}),
      serviceAreas: unique([...(base.access?.serviceAreas ?? []), ...(override.access?.serviceAreas ?? [])]),
      languages: unique([...(base.access?.languages ?? []), ...(override.access?.languages ?? [])]),
      requiredDocuments: unique([...(base.access?.requiredDocuments ?? []), ...(override.access?.requiredDocuments ?? [])]),
    },
    evidence: { ...(base.evidence ?? {}), ...(override.evidence ?? {}) },
  };
}

async function getConfiguredLlmClient(): Promise<LLMClient | null> {
  const config = getLLMConfigFromEnv();
  if (!config.endpoint || !config.apiKey) {
    return null;
  }
  return createLLMClient(config);
}

export async function assistResourceSubmissionFromSource(input: {
  draft: ResourceSubmissionDraft;
  sourceUrl: string;
}): Promise<ResourceSubmissionAssistResult> {
  const sourceUrl = input.sourceUrl.trim();
  if (!sourceUrl) {
    throw new ResourceSubmissionAssistError('Add a source URL before running AI assist.', 400);
  }

  const fetcher = createPageFetcher({ timeoutMs: 15000 });
  const fetchResult = await fetcher.fetch(sourceUrl);
  if (isFetchError(fetchResult)) {
    throw new ResourceSubmissionAssistError(fetchResult.message, 422);
  }

  const extractor = createHtmlTextExtractor();
  const extraction = extractor.extract(fetchResult.body);
  const canonicalUrl = fetchResult.canonicalUrl;
  const title = extraction.title ?? null;
  const metaDescription = extraction.metaDescription ?? null;
  const sourceName = titleCandidate(title) || hostnameLabel(canonicalUrl);
  const summaryDescription = limitText(metaDescription ?? firstParagraph(extraction.text, 320), 320);
  const detectedEmail = extractEmail(extraction.text);
  const detectedPhone = extractPhone(extraction.text);

  const heuristicPatch: ResourceSubmissionAssistPatch = {
    organization: {
      name: titleCandidate(title),
      description: limitText(metaDescription, 5000),
      url: canonicalUrl,
      email: detectedEmail,
      phone: detectedPhone,
    },
    service: input.draft.variant === 'listing' ? {
      name: titleCandidate(title),
      description: limitText(metaDescription ?? firstParagraph(extraction.text, 500), 5000),
      url: canonicalUrl,
      email: detectedEmail,
      phones: detectedPhone ? [{ number: detectedPhone, extension: '', type: 'voice', description: '' }] : [],
    } : undefined,
    taxonomy: {
      categories: inferCategoriesFromText(`${title ?? ''} ${metaDescription ?? ''} ${extraction.text.slice(0, 2000)}`),
    },
    evidence: {
      sourceUrl: canonicalUrl,
      sourceName,
      contactEmail: detectedEmail,
      notes: buildEvidenceNote(sourceName, canonicalUrl, summaryDescription),
    },
  };

  const warnings: string[] = [];
  let llmUsed = false;
  let confidence = Math.min(80, 35 + (title ? 15 : 0) + (metaDescription ? 15 : 0) + (detectedEmail ? 10 : 0) + (detectedPhone ? 10 : 0));
  let finalPatch = heuristicPatch;

  try {
    const client = await getConfiguredLlmClient();
    if (!client) {
      warnings.push('LLM assist is not configured. Applied source-based suggestions only.');
    } else {
      const result = await client.extract({
        content: extraction.text,
        sourceUrl: canonicalUrl,
        pageTitle: title ?? undefined,
        sourceQuality: 'vetted',
      });

      if (result.success && result.data.services[0]) {
        llmUsed = true;
        const llmPatch = patchFromExtractedService(result.data.services[0], canonicalUrl);

        const categorized = await client.categorize({ service: result.data.services[0] });
        if (categorized.success) {
          const categories: string[] = [];
          const customTerms: string[] = [];
          for (const tag of categorized.data.tags.map((entry) => entry.tag)) {
            const normalized = normalizeCategoryTag(tag);
            if (normalized.category) categories.push(normalized.category);
            if (normalized.customTerm) customTerms.push(normalized.customTerm);
          }
          llmPatch.taxonomy = {
            categories: unique(categories),
            customTerms: unique(customTerms),
          };
        } else {
          warnings.push(`AI categorization skipped: ${categorized.error.message}`);
        }

        finalPatch = mergeAssistPatches(heuristicPatch, llmPatch);
        const confidenceValues = result.data.confidences[0]
          ? Object.values(result.data.confidences[0])
              .map((entry) => entry?.confidence)
              .filter((value): value is number => typeof value === 'number')
          : [];
        if (confidenceValues.length > 0) {
          confidence = Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length);
        } else {
          confidence = 78;
        }
      }
    }
  } catch (error) {
    warnings.push(error instanceof Error ? `AI assist unavailable: ${error.message}` : 'AI assist unavailable.');
  }

  const preview = previewResourceSubmissionAssist(input.draft, finalPatch);
  return {
    patch: finalPatch,
    changedFields: preview.changedFields,
    cardsBefore: preview.cardsBefore,
    cardsAfter: preview.cardsAfter,
    source: {
      requestedUrl: sourceUrl,
      canonicalUrl,
      title,
      metaDescription,
      wordCount: extraction.wordCount,
    },
    summary: {
      llmUsed,
      confidence,
      categoriesSuggested: unique([
        ...(finalPatch.taxonomy?.categories ?? []),
        ...(finalPatch.taxonomy?.customTerms ?? []),
      ]),
      warnings,
    },
  };
}
