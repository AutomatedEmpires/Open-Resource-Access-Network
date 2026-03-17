import {
  computeResourceSubmissionCards,
  createEmptyResourceSubmissionDraft,
  resourceVerificationTrackSchema,
  type ResourceAttributeTagDraft,
  type ResourceLocationDraft,
  type ResourceSubmissionCardSummary,
  type ResourceSubmissionDraft,
} from '@/domain/resourceSubmission';

export interface ResourceSubmissionAssistPatch {
  organization?: Partial<ResourceSubmissionDraft['organization']>;
  service?: Partial<ResourceSubmissionDraft['service']>;
  locations?: Array<Partial<ResourceLocationDraft>>;
  taxonomy?: Partial<ResourceSubmissionDraft['taxonomy']>;
  access?: Partial<ResourceSubmissionDraft['access']>;
  evidence?: Partial<ResourceSubmissionDraft['evidence']>;
}

export interface ResourceSubmissionAssistSourceSummary {
  requestedUrl: string;
  canonicalUrl: string;
  title: string | null;
  metaDescription: string | null;
  wordCount: number;
}

export interface ResourceSubmissionAssistSummary {
  llmUsed: boolean;
  confidence: number;
  categoriesSuggested: string[];
  warnings: string[];
}

export interface ResourceSubmissionAssistResult {
  patch: ResourceSubmissionAssistPatch;
  changedFields: string[];
  cardsBefore: ResourceSubmissionCardSummary[];
  cardsAfter: ResourceSubmissionCardSummary[];
  source: ResourceSubmissionAssistSourceSummary;
  summary: ResourceSubmissionAssistSummary;
}

function fillString(current: string | null | undefined, suggestion: string | undefined): string {
  const normalizedCurrent = current?.trim() ?? '';
  const trimmedSuggestion = suggestion?.trim() ?? '';
  if (normalizedCurrent || !trimmedSuggestion) {
    return current ?? '';
  }
  return trimmedSuggestion;
}

function mergeStringArray(current: string[] | undefined, additions: string[] | undefined): string[] {
  const normalizedCurrent = current ?? [];
  if (!additions?.length) {
    return normalizedCurrent;
  }

  const seen = new Set(normalizedCurrent.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  const next = [...normalizedCurrent];
  for (const candidate of additions) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }

  return next;
}

function mergeAttributeTags(
  current: ResourceAttributeTagDraft[] | undefined,
  additions: ResourceAttributeTagDraft[] | undefined,
): ResourceAttributeTagDraft[] {
  const normalizedCurrent = current ?? [];
  if (!additions?.length) {
    return normalizedCurrent;
  }

  const seen = new Set(normalizedCurrent.map((entry) => `${entry.dimension}:${entry.tag}`));
  const next = [...normalizedCurrent];
  for (const candidate of additions) {
    const parsed = resourceVerificationSafeAttributeTag(candidate);
    if (!parsed) continue;
    const key = `${parsed.dimension}:${parsed.tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(parsed);
  }
  return next;
}

function resourceVerificationSafeAttributeTag(candidate: ResourceAttributeTagDraft): ResourceAttributeTagDraft | null {
  if (!candidate.tag.trim()) {
    return null;
  }
  return {
    dimension: candidate.dimension,
    tag: candidate.tag.trim(),
  };
}

function mergeVerificationTrack(
  current: ResourceSubmissionDraft['evidence']['verification']['url'],
  addition: Partial<ResourceSubmissionDraft['evidence']['verification']['url']> | undefined,
): ResourceSubmissionDraft['evidence']['verification']['url'] {
  const normalizedCurrent = resourceVerificationTrackSchema.parse(current ?? {});
  if (!addition) {
    return normalizedCurrent;
  }

  return resourceVerificationTrackSchema.parse({
    ...normalizedCurrent,
    status: addition.status ?? normalizedCurrent.status,
    lastCheckedAt: fillString(normalizedCurrent.lastCheckedAt, addition.lastCheckedAt),
    method: fillString(normalizedCurrent.method, addition.method),
    canonicalValue: fillString(normalizedCurrent.canonicalValue, addition.canonicalValue),
    notes: fillString(normalizedCurrent.notes, addition.notes),
  });
}

function mergePhoneEntries<PhoneEntry extends { number: string; type: string }>(
  current: PhoneEntry[] | undefined,
  additions: PhoneEntry[] | undefined,
): PhoneEntry[] {
  const normalizedCurrent = current ?? [];
  if (!additions?.length) {
    return normalizedCurrent;
  }

  const seen = new Set(
    normalizedCurrent
      .filter((entry) => entry.number.trim())
      .map((entry) => `${entry.type}:${entry.number.replace(/\D+/g, '')}`),
  );
  const next = [...normalizedCurrent];

  for (const candidate of additions) {
    const number = candidate.number.trim();
    if (!number) continue;
    const key = `${candidate.type}:${number.replace(/\D+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(candidate);
  }

  return next;
}

function hasMeaningfulSchedule(schedule: ResourceLocationDraft['schedule'] | undefined): boolean {
  return (schedule ?? []).some((entry) => !entry.closed || entry.opens !== '09:00' || entry.closes !== '17:00');
}

function mergeSchedule(
  current: ResourceLocationDraft['schedule'] | undefined,
  suggestion: ResourceLocationDraft['schedule'] | undefined,
): ResourceLocationDraft['schedule'] {
  const normalizedCurrent = current ?? createEmptyResourceSubmissionDraft('listing', 'host').locations[0].schedule;
  if (!suggestion?.length) {
    return normalizedCurrent;
  }
  if (hasMeaningfulSchedule(normalizedCurrent)) {
    return normalizedCurrent;
  }
  if (!hasMeaningfulSchedule(suggestion)) {
    return normalizedCurrent;
  }
  return suggestion;
}

function mergeLocation(
  current: ResourceLocationDraft,
  patch: Partial<ResourceLocationDraft> | undefined,
): ResourceLocationDraft {
  if (!patch) {
    return current;
  }

  return {
    ...current,
    name: fillString(current.name, patch.name),
    description: fillString(current.description, patch.description),
    transportation: fillString(current.transportation, patch.transportation),
    placeLabel: fillString(current.placeLabel, patch.placeLabel),
    geoPrecision: patch.geoPrecision ?? current.geoPrecision,
    address1: fillString(current.address1, patch.address1),
    address2: fillString(current.address2, patch.address2),
    city: fillString(current.city, patch.city),
    region: fillString(current.region, patch.region),
    stateProvince: fillString(current.stateProvince, patch.stateProvince),
    postalCode: fillString(current.postalCode, patch.postalCode),
    country: fillString(current.country, patch.country),
    latitude: fillString(current.latitude, patch.latitude),
    longitude: fillString(current.longitude, patch.longitude),
    phones: mergePhoneEntries(current.phones, patch.phones),
    languages: mergeStringArray(current.languages, patch.languages),
    accessibility: mergeStringArray(current.accessibility, patch.accessibility),
    schedule: mergeSchedule(current.schedule, patch.schedule),
  };
}

export function applyResourceSubmissionAssistPatch(
  draft: ResourceSubmissionDraft,
  patch: ResourceSubmissionAssistPatch,
): ResourceSubmissionDraft {
  return {
    ...draft,
    organization: {
      ...draft.organization,
      name: fillString(draft.organization.name, patch.organization?.name),
      description: fillString(draft.organization.description, patch.organization?.description),
      url: fillString(draft.organization.url, patch.organization?.url),
      email: fillString(draft.organization.email, patch.organization?.email),
      phone: fillString(draft.organization.phone, patch.organization?.phone),
      taxStatus: fillString(draft.organization.taxStatus, patch.organization?.taxStatus),
      taxId: fillString(draft.organization.taxId, patch.organization?.taxId),
      yearIncorporated: fillString(draft.organization.yearIncorporated, patch.organization?.yearIncorporated),
      legalStatus: fillString(draft.organization.legalStatus, patch.organization?.legalStatus),
    },
    service: {
      ...draft.service,
      name: fillString(draft.service.name, patch.service?.name),
      description: fillString(draft.service.description, patch.service?.description),
      url: fillString(draft.service.url, patch.service?.url),
      email: fillString(draft.service.email, patch.service?.email),
      applicationProcess: fillString(draft.service.applicationProcess, patch.service?.applicationProcess),
      fees: fillString(draft.service.fees, patch.service?.fees),
      waitTime: fillString(draft.service.waitTime, patch.service?.waitTime),
      interpretationServices: fillString(draft.service.interpretationServices, patch.service?.interpretationServices),
      accreditations: fillString(draft.service.accreditations, patch.service?.accreditations),
      licenses: fillString(draft.service.licenses, patch.service?.licenses),
      phones: mergePhoneEntries(draft.service.phones, patch.service?.phones),
    },
    taxonomy: {
      categories: mergeStringArray(draft.taxonomy.categories, patch.taxonomy?.categories),
      attributeTags: mergeAttributeTags(draft.taxonomy.attributeTags, patch.taxonomy?.attributeTags),
      customTerms: mergeStringArray(draft.taxonomy.customTerms, patch.taxonomy?.customTerms),
    },
    access: {
      eligibilityDescription: fillString(draft.access.eligibilityDescription, patch.access?.eligibilityDescription),
      minimumAge: fillString(draft.access.minimumAge, patch.access?.minimumAge),
      maximumAge: fillString(draft.access.maximumAge, patch.access?.maximumAge),
      serviceAreaType: patch.access?.serviceAreaType ?? draft.access.serviceAreaType,
      serviceAreas: mergeStringArray(draft.access.serviceAreas, patch.access?.serviceAreas),
      serviceAreaPostalCodes: mergeStringArray(draft.access.serviceAreaPostalCodes, patch.access?.serviceAreaPostalCodes),
      languages: mergeStringArray(draft.access.languages, patch.access?.languages),
      requiredDocuments: mergeStringArray(draft.access.requiredDocuments, patch.access?.requiredDocuments),
    },
    evidence: {
      sourceUrl: fillString(draft.evidence.sourceUrl, patch.evidence?.sourceUrl),
      sourceName: fillString(draft.evidence.sourceName, patch.evidence?.sourceName),
      contactEmail: fillString(draft.evidence.contactEmail, patch.evidence?.contactEmail),
      submitterRelationship: fillString(draft.evidence.submitterRelationship, patch.evidence?.submitterRelationship),
      notes: fillString(draft.evidence.notes, patch.evidence?.notes),
      verification: {
        url: mergeVerificationTrack(draft.evidence.verification.url, patch.evidence?.verification?.url),
        email: mergeVerificationTrack(draft.evidence.verification.email, patch.evidence?.verification?.email),
        phone: mergeVerificationTrack(draft.evidence.verification.phone, patch.evidence?.verification?.phone),
        provenanceNotes: fillString(draft.evidence.verification.provenanceNotes, patch.evidence?.verification?.provenanceNotes),
      },
    },
    locations: draft.variant === 'claim'
      ? draft.locations
      : (() => {
          const currentLocations = draft.locations.length > 0
            ? draft.locations
            : [createEmptyResourceSubmissionDraft('listing', draft.channel).locations[0]];
          const patchLocations = patch.locations ?? [];
          const maxLength = Math.max(currentLocations.length, patchLocations.length || 0);
          const merged: ResourceLocationDraft[] = [];
          for (let index = 0; index < maxLength; index += 1) {
            const currentLocation = currentLocations[index]
              ?? createEmptyResourceSubmissionDraft('listing', draft.channel).locations[0];
            const patchLocation = patchLocations[index];
            merged.push(mergeLocation(currentLocation, patchLocation));
          }
          return merged;
        })(),
  };
}

function collectChangedLeafPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return [];
  }

  const beforeObject = before && typeof before === 'object' && !Array.isArray(before) ? before as Record<string, unknown> : null;
  const afterObject = after && typeof after === 'object' && !Array.isArray(after) ? after as Record<string, unknown> : null;
  if (beforeObject && afterObject) {
    const changed: string[] = [];
    const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]);
    for (const key of keys) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      changed.push(...collectChangedLeafPaths(beforeObject[key], afterObject[key], nextPrefix));
    }
    return changed;
  }

  return prefix ? [prefix] : [];
}

export function listResourceSubmissionAssistChanges(
  before: ResourceSubmissionDraft,
  after: ResourceSubmissionDraft,
): string[] {
  return collectChangedLeafPaths(before, after).sort();
}

export function previewResourceSubmissionAssist(
  draft: ResourceSubmissionDraft,
  patch: ResourceSubmissionAssistPatch,
) {
  const nextDraft = applyResourceSubmissionAssistPatch(draft, patch);
  return {
    nextDraft,
    changedFields: listResourceSubmissionAssistChanges(draft, nextDraft),
    cardsBefore: computeResourceSubmissionCards(draft),
    cardsAfter: computeResourceSubmissionCards(nextDraft),
  };
}
