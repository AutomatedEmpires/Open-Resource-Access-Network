import { z } from 'zod';

export const RESOURCE_SUBMISSION_VARIANTS = ['listing', 'claim'] as const;
export type ResourceSubmissionVariant = (typeof RESOURCE_SUBMISSION_VARIANTS)[number];

export const RESOURCE_SUBMISSION_CHANNELS = ['host', 'public'] as const;
export type ResourceSubmissionChannel = (typeof RESOURCE_SUBMISSION_CHANNELS)[number];

export const RESOURCE_SUBMISSION_MODES = ['draft', 'review', 'history'] as const;
export type ResourceSubmissionMode = (typeof RESOURCE_SUBMISSION_MODES)[number];

export interface ResourceSubmissionCardSummary {
  id: string;
  title: string;
  description: string;
  state: 'complete' | 'recommended' | 'incomplete';
  requiredCompleted: number;
  requiredTotal: number;
  missing: string[];
}

export interface ResourceSubmissionReviewMeta {
  submissionId: string | null;
  status: string | null;
  submissionType: string | null;
  targetType: string | null;
  targetId: string | null;
  submittedByUserId: string | null;
  submittedByLabel: string | null;
  assignedToUserId: string | null;
  assignedToLabel: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  submittedAt: string | null;
  slaDeadline: string | null;
  confidenceScore: number | null;
  verificationConfidence: number | null;
  reverifyAt: string | null;
  reviewerNotes: string | null;
  sourceRecordId: string | null;
}

export const resourcePhoneSchema = z.object({
  number: z.string().trim().max(30).default(''),
  extension: z.string().trim().max(10).default(''),
  type: z.enum(['voice', 'fax', 'text', 'hotline', 'tty']).default('voice'),
  description: z.string().trim().max(200).default(''),
});

export type ResourcePhoneDraft = z.infer<typeof resourcePhoneSchema>;

export const resourceScheduleDaySchema = z.object({
  day: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  opens: z.string().trim().regex(/^\d{2}:\d{2}$/).default('09:00'),
  closes: z.string().trim().regex(/^\d{2}:\d{2}$/).default('17:00'),
  closed: z.boolean().default(true),
});

export type ResourceScheduleDayDraft = z.infer<typeof resourceScheduleDaySchema>;

const WEEK_TEMPLATE = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const resourceLocationSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().max(500).default(''),
  description: z.string().trim().max(5000).default(''),
  transportation: z.string().trim().max(1000).default(''),
  address1: z.string().trim().max(500).default(''),
  address2: z.string().trim().max(500).default(''),
  city: z.string().trim().max(200).default(''),
  region: z.string().trim().max(200).default(''),
  stateProvince: z.string().trim().max(200).default(''),
  postalCode: z.string().trim().max(20).default(''),
  country: z.string().trim().max(100).default('US'),
  latitude: z.string().trim().max(32).default(''),
  longitude: z.string().trim().max(32).default(''),
  phones: z.array(resourcePhoneSchema).default([]),
  languages: z.array(z.string().trim().min(1).max(100)).default([]),
  accessibility: z.array(z.string().trim().min(1).max(200)).default([]),
  schedule: z.array(resourceScheduleDaySchema).default(
    WEEK_TEMPLATE.map((day) => ({ day, opens: '09:00', closes: '17:00', closed: true })),
  ),
});

export type ResourceLocationDraft = z.infer<typeof resourceLocationSchema>;

export const resourceSubmissionDraftSchema = z.object({
  variant: z.enum(RESOURCE_SUBMISSION_VARIANTS).default('listing'),
  channel: z.enum(RESOURCE_SUBMISSION_CHANNELS).default('host'),
  ownerOrganizationId: z.string().uuid().nullable().default(null),
  existingServiceId: z.string().uuid().nullable().default(null),
  organization: z.object({
    name: z.string().trim().max(500).default(''),
    description: z.string().trim().max(5000).default(''),
    url: z.string().trim().max(2000).default(''),
    email: z.string().trim().max(500).default(''),
    phone: z.string().trim().max(30).default(''),
    taxStatus: z.string().trim().max(200).default(''),
    taxId: z.string().trim().max(100).default(''),
    yearIncorporated: z.string().trim().max(4).default(''),
    legalStatus: z.string().trim().max(200).default(''),
  }),
  service: z.object({
    name: z.string().trim().max(500).default(''),
    description: z.string().trim().max(5000).default(''),
    url: z.string().trim().max(2000).default(''),
    email: z.string().trim().max(500).default(''),
    applicationProcess: z.string().trim().max(2000).default(''),
    fees: z.string().trim().max(1000).default(''),
    waitTime: z.string().trim().max(500).default(''),
    interpretationServices: z.string().trim().max(1000).default(''),
    accreditations: z.string().trim().max(1000).default(''),
    licenses: z.string().trim().max(1000).default(''),
    phones: z.array(resourcePhoneSchema).default([]),
  }),
  locations: z.array(resourceLocationSchema).default([]),
  taxonomy: z.object({
    categories: z.array(z.string().trim().min(1).max(100)).default([]),
    customTerms: z.array(z.string().trim().min(1).max(120)).default([]),
  }),
  access: z.object({
    eligibilityDescription: z.string().trim().max(3000).default(''),
    minimumAge: z.string().trim().max(4).default(''),
    maximumAge: z.string().trim().max(4).default(''),
    serviceAreas: z.array(z.string().trim().min(1).max(200)).default([]),
    languages: z.array(z.string().trim().min(1).max(100)).default([]),
    requiredDocuments: z.array(z.string().trim().min(1).max(200)).default([]),
  }),
  evidence: z.object({
    sourceUrl: z.string().trim().max(2000).default(''),
    sourceName: z.string().trim().max(300).default(''),
    contactEmail: z.string().trim().max(500).default(''),
    submitterRelationship: z.string().trim().max(300).default(''),
    notes: z.string().trim().max(5000).default(''),
  }),
});

export type ResourceSubmissionDraft = z.infer<typeof resourceSubmissionDraftSchema>;

export const RESOURCE_SUBMISSION_CARD_ORDER: Record<ResourceSubmissionVariant, string[]> = {
  listing: ['organization', 'service', 'locations', 'taxonomy', 'access', 'evidence', 'review'],
  claim: ['organization', 'evidence', 'review'],
};

function countRequired(completedChecks: boolean[]): { done: number; total: number } {
  return {
    done: completedChecks.filter(Boolean).length,
    total: completedChecks.length,
  };
}

function buildSummary(
  id: string,
  title: string,
  description: string,
  missing: string[],
  requiredDone: number,
  requiredTotal: number,
  hasRecommendedGap = false,
): ResourceSubmissionCardSummary {
  return {
    id,
    title,
    description,
    state: missing.length > 0 ? 'incomplete' : hasRecommendedGap ? 'recommended' : 'complete',
    requiredCompleted: requiredDone,
    requiredTotal,
    missing,
  };
}

export function createEmptyResourceSubmissionDraft(
  variant: ResourceSubmissionVariant,
  channel: ResourceSubmissionChannel,
): ResourceSubmissionDraft {
  return resourceSubmissionDraftSchema.parse({
    variant,
    channel,
    locations: variant === 'listing' ? [resourceLocationSchema.parse({})] : [],
  });
}

export function normalizeResourceSubmissionDraft(
  value: unknown,
  fallbackVariant: ResourceSubmissionVariant,
  fallbackChannel: ResourceSubmissionChannel,
): ResourceSubmissionDraft {
  const parsed = resourceSubmissionDraftSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return createEmptyResourceSubmissionDraft(fallbackVariant, fallbackChannel);
}

export function computeResourceSubmissionCards(
  draft: ResourceSubmissionDraft,
  reviewMeta: ResourceSubmissionReviewMeta | null = null,
): ResourceSubmissionCardSummary[] {
  const organizationChecks = countRequired([
    draft.organization.name.trim().length > 0,
    draft.organization.description.trim().length > 0,
    Boolean(
      draft.organization.url.trim() ||
      draft.organization.email.trim() ||
      draft.organization.phone.trim(),
    ),
  ]);
  const organizationMissing: string[] = [];
  if (!draft.organization.name.trim()) organizationMissing.push('Organization name');
  if (!draft.organization.description.trim()) organizationMissing.push('Organization description');
  if (!draft.organization.url.trim() && !draft.organization.email.trim() && !draft.organization.phone.trim()) {
    organizationMissing.push('At least one verification contact path');
  }

  const cards: ResourceSubmissionCardSummary[] = [
    buildSummary(
      'organization',
      'Organization identity',
      'Who provides the resource and how reviewers can verify them.',
      organizationMissing,
      organizationChecks.done,
      organizationChecks.total,
      !draft.organization.url.trim(),
    ),
  ];

  if (draft.variant === 'listing') {
    const serviceChecks = countRequired([
      draft.service.name.trim().length > 0,
      draft.service.description.trim().length > 0,
    ]);
    const serviceMissing: string[] = [];
    if (!draft.service.name.trim()) serviceMissing.push('Service name');
    if (!draft.service.description.trim()) serviceMissing.push('Service description');

    const locationsChecks = countRequired([
      draft.locations.length > 0,
      draft.locations.some((location) => Boolean(location.city.trim() || location.stateProvince.trim() || location.address1.trim())),
    ]);
    const locationsMissing: string[] = [];
    if (draft.locations.length === 0) locationsMissing.push('At least one location');
    if (!draft.locations.some((location) => Boolean(location.city.trim() || location.stateProvince.trim() || location.address1.trim()))) {
      locationsMissing.push('Location address or city/state');
    }

    const taxonomyChecks = countRequired([
      draft.taxonomy.categories.length > 0 || draft.taxonomy.customTerms.length > 0,
    ]);
    const taxonomyMissing: string[] = [];
    if (draft.taxonomy.categories.length === 0 && draft.taxonomy.customTerms.length === 0) {
      taxonomyMissing.push('At least one category or taxonomy term');
    }

    const accessChecks = countRequired([
      draft.access.serviceAreas.length > 0,
      draft.access.eligibilityDescription.trim().length > 0,
    ]);
    const accessMissing: string[] = [];
    if (draft.access.serviceAreas.length === 0) accessMissing.push('Service area');
    if (!draft.access.eligibilityDescription.trim()) accessMissing.push('Eligibility or access notes');

    cards.push(
      buildSummary(
        'service',
        'Listing basics',
        'What the service is, what it does, and how it is accessed.',
        serviceMissing,
        serviceChecks.done,
        serviceChecks.total,
        !draft.service.applicationProcess.trim() || !draft.service.fees.trim(),
      ),
      buildSummary(
        'locations',
        'Locations and hours',
        'Where the service is delivered and when it is available.',
        locationsMissing,
        locationsChecks.done,
        locationsChecks.total,
        !draft.locations.some((location) => location.schedule.some((day) => !day.closed)),
      ),
      buildSummary(
        'taxonomy',
        'Taxonomy and tags',
        'How this resource should be classified for discovery and export.',
        taxonomyMissing,
        taxonomyChecks.done,
        taxonomyChecks.total,
      ),
      buildSummary(
        'access',
        'Access and eligibility',
        'Service area, requirements, languages, and documents.',
        accessMissing,
        accessChecks.done,
        accessChecks.total,
        draft.access.requiredDocuments.length === 0,
      ),
    );
  }

  const evidenceChecks = countRequired([
    draft.evidence.submitterRelationship.trim().length > 0 || draft.channel === 'public',
    draft.evidence.notes.trim().length > 0,
  ]);
  const evidenceMissing: string[] = [];
  if (!draft.evidence.submitterRelationship.trim() && draft.channel !== 'public') {
    evidenceMissing.push('Submitter relationship');
  }
  if (!draft.evidence.notes.trim()) evidenceMissing.push('Reviewer notes or evidence summary');

  cards.push(
    buildSummary(
      'evidence',
      'Evidence and source',
      'Why this listing is trustworthy and what the reviewer should verify.',
      evidenceMissing,
      evidenceChecks.done,
      evidenceChecks.total,
      !draft.evidence.sourceUrl.trim() && !draft.evidence.contactEmail.trim(),
    ),
    buildSummary(
      'review',
      'Review and trust',
      'Submitter, reviewer, timestamps, status, and reverification signals.',
      [],
      reviewMeta ? 1 : 0,
      1,
      reviewMeta === null || (!reviewMeta.submittedAt && !reviewMeta.status),
    ),
  );

  return cards.filter((card) => RESOURCE_SUBMISSION_CARD_ORDER[draft.variant].includes(card.id));
}

export function isResourceSubmissionComplete(draft: ResourceSubmissionDraft): boolean {
  return computeResourceSubmissionCards(draft)
    .filter((card) => card.id !== 'review')
    .every((card) => card.state !== 'incomplete');
}
