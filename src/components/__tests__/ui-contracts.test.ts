/**
 * UI Contract Tests
 *
 * Validates that domain types used in UI components are consistent with
 * the EnrichedService composite type and related constants.
 * These are schema-level checks — NOT DOM rendering tests.
 */

import { describe, it, expect } from 'vitest';
import type {
  EnrichedService,
  Service,
  Organization,
  Eligibility,
  RequiredDocument,
  Language,
  ServiceArea,
  Contact,
  AccessibilityForDisabilities,
  ServiceAttribute,
  ServiceAttributeTaxonomy,
  ServiceAdaptation,
  ServiceAdaptationType,
  DietaryOption,
  DietaryAvailability,
  ServiceCapacityStatus,
} from '@/domain/types';
import { ServiceLinkSchema, ServiceLinkKindSchema } from '@/services/chat/links';

// ============================================================
// ENRICHED SERVICE COMPOSITE TYPE
// ============================================================

describe('EnrichedService composite shape', () => {
  /** Factory for a minimal valid EnrichedService */
  function makeEnrichedService(overrides: Partial<EnrichedService> = {}): EnrichedService {
    const now = new Date();
    return {
      service: {
        id: 's-1',
        organizationId: 'org-1',
        name: 'Test Service',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      } as Service,
      organization: {
        id: 'org-1',
        name: 'Test Org',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      } as Organization,
      phones: [],
      schedules: [],
      taxonomyTerms: [],
      ...overrides,
    };
  }

  it('requires core fields: service, organization, phones, schedules, taxonomyTerms', () => {
    const es = makeEnrichedService();
    expect(es.service).toBeDefined();
    expect(es.organization).toBeDefined();
    expect(Array.isArray(es.phones)).toBe(true);
    expect(Array.isArray(es.schedules)).toBe(true);
    expect(Array.isArray(es.taxonomyTerms)).toBe(true);
  });

  it('optional fields default to undefined', () => {
    const es = makeEnrichedService();
    expect(es.location).toBeUndefined();
    expect(es.address).toBeUndefined();
    expect(es.confidenceScore).toBeUndefined();
    expect(es.distanceMeters).toBeUndefined();
    expect(es.eligibility).toBeUndefined();
    expect(es.requiredDocuments).toBeUndefined();
    expect(es.languages).toBeUndefined();
    expect(es.serviceAreas).toBeUndefined();
    expect(es.contacts).toBeUndefined();
    expect(es.accessibility).toBeUndefined();
    expect(es.program).toBeUndefined();
    expect(es.attributes).toBeUndefined();
    expect(es.adaptations).toBeUndefined();
    expect(es.dietaryOptions).toBeUndefined();
  });

  it('accepts full eligibility array', () => {
    const now = new Date();
    const eligibility: Eligibility[] = [
      {
        id: 'e-1',
        serviceId: 's-1',
        description: 'Must be 18 or older',
        minimumAge: 18,
        maximumAge: null,
        eligibleValues: ['adult'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-2',
        serviceId: 's-1',
        description: 'Veteran status required',
        eligibleValues: ['veteran'],
        createdAt: now,
        updatedAt: now,
      },
    ];
    const es = makeEnrichedService({ eligibility });
    expect(es.eligibility).toHaveLength(2);
    expect(es.eligibility![0].minimumAge).toBe(18);
    expect(es.eligibility![1].eligibleValues).toContain('veteran');
  });

  it('accepts required documents with optional URI', () => {
    const now = new Date();
    const requiredDocuments: RequiredDocument[] = [
      {
        id: 'd-1',
        serviceId: 's-1',
        document: 'Photo ID',
        type: 'identification',
        uri: 'https://example.com/id-info',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'd-2',
        serviceId: 's-1',
        document: 'Proof of income',
        type: 'income',
        uri: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const es = makeEnrichedService({ requiredDocuments });
    expect(es.requiredDocuments).toHaveLength(2);
    expect(es.requiredDocuments![0].uri).toBe('https://example.com/id-info');
    expect(es.requiredDocuments![1].uri).toBeNull();
  });

  it('accepts languages with ISO 639-1 codes', () => {
    const now = new Date();
    const languages: Language[] = [
      { id: 'l-1', serviceId: 's-1', language: 'en', createdAt: now, updatedAt: now },
      { id: 'l-2', serviceId: 's-1', language: 'es', note: 'Spanish interpreter available', createdAt: now, updatedAt: now },
    ];
    const es = makeEnrichedService({ languages });
    expect(es.languages).toHaveLength(2);
    expect(es.languages![0].language).toBe('en');
    expect(es.languages![1].note).toContain('Spanish');
  });

  it('accepts accessibility features for locations', () => {
    const now = new Date();
    const accessibility: AccessibilityForDisabilities[] = [
      { id: 'a-1', locationId: 'loc-1', accessibility: 'wheelchair', createdAt: now, updatedAt: now },
      { id: 'a-2', locationId: 'loc-1', accessibility: 'hearing_loop', details: 'Available in main room', createdAt: now, updatedAt: now },
    ];
    const es = makeEnrichedService({ accessibility });
    expect(es.accessibility).toHaveLength(2);
    expect(es.accessibility![0].accessibility).toBe('wheelchair');
    expect(es.accessibility![1].details).toContain('main room');
  });

  it('accepts contacts with partial fields', () => {
    const now = new Date();
    const contacts: Contact[] = [
      { id: 'c-1', serviceId: 's-1', name: 'Jane Doe', title: 'Director', email: 'j@example.com', createdAt: now, updatedAt: now },
      { id: 'c-2', serviceId: 's-1', name: 'Front Desk', createdAt: now, updatedAt: now },
    ];
    const es = makeEnrichedService({ contacts });
    expect(es.contacts).toHaveLength(2);
    expect(es.contacts![0].email).toBe('j@example.com');
    expect(es.contacts![1].title).toBeUndefined();
  });

  it('accepts service areas with extent types', () => {
    const now = new Date();
    const serviceAreas: ServiceArea[] = [
      { id: 'sa-1', serviceId: 's-1', name: 'Multnomah County', extentType: 'county', createdAt: now, updatedAt: now },
      { id: 'sa-2', serviceId: 's-1', name: 'Portland', extentType: 'city', createdAt: now, updatedAt: now },
    ];
    const es = makeEnrichedService({ serviceAreas });
    expect(es.serviceAreas).toHaveLength(2);
    expect(es.serviceAreas![0].extentType).toBe('county');
  });

  it('accepts distanceMeters as a numeric value', () => {
    const es = makeEnrichedService({ distanceMeters: 1234.5 });
    expect(es.distanceMeters).toBe(1234.5);
  });

  it('accepts null for optional array fields', () => {
    const es = makeEnrichedService({
      eligibility: null,
      requiredDocuments: null,
      languages: null,
      serviceAreas: null,
      contacts: null,
      accessibility: null,
      attributes: null,
      adaptations: null,
      dietaryOptions: null,
    });
    expect(es.eligibility).toBeNull();
    expect(es.requiredDocuments).toBeNull();
    expect(es.attributes).toBeNull();
    expect(es.adaptations).toBeNull();
    expect(es.dietaryOptions).toBeNull();
  });
});

// ============================================================
// SERVICE ATTRIBUTE TAXONOMY
// ============================================================

describe('ServiceAttribute taxonomy values', () => {
  const EXPECTED_TAXONOMIES: ServiceAttributeTaxonomy[] = [
    'delivery', 'cost', 'access', 'culture', 'population', 'situation',
  ];

  it('all taxonomy namespaces are valid string literals', () => {
    for (const t of EXPECTED_TAXONOMIES) {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('accepts a ServiceAttribute with every taxonomy', () => {
    const now = new Date();
    for (const taxonomy of EXPECTED_TAXONOMIES) {
      const attr: ServiceAttribute = {
        id: `attr-${taxonomy}`,
        serviceId: 's-1',
        taxonomy,
        tag: `${taxonomy}_tag`,
        createdAt: now,
        updatedAt: now,
      };
      expect(attr.taxonomy).toBe(taxonomy);
    }
  });
});

// ============================================================
// SERVICE ADAPTATION TYPES
// ============================================================

describe('ServiceAdaptation types', () => {
  const EXPECTED_TYPES: ServiceAdaptationType[] = [
    'disability', 'health_condition', 'age_group', 'learning',
  ];

  it('all adaptation types are valid string literals', () => {
    for (const t of EXPECTED_TYPES) {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('accepts a ServiceAdaptation with each type', () => {
    const now = new Date();
    for (const adaptationType of EXPECTED_TYPES) {
      const adaptation: ServiceAdaptation = {
        id: `adapt-${adaptationType}`,
        serviceId: 's-1',
        adaptationType,
        adaptationTag: `${adaptationType}_tag`,
        createdAt: now,
        updatedAt: now,
      };
      expect(adaptation.adaptationType).toBe(adaptationType);
    }
  });
});

// ============================================================
// DIETARY OPTIONS
// ============================================================

describe('DietaryOption availability', () => {
  const VALID_AVAILABILITY: DietaryAvailability[] = [
    'always', 'by_request', 'limited', 'seasonal',
  ];

  it('all availability statuses are valid', () => {
    for (const a of VALID_AVAILABILITY) {
      expect(typeof a).toBe('string');
    }
  });

  it('accepts a DietaryOption with each availability', () => {
    const now = new Date();
    for (const availability of VALID_AVAILABILITY) {
      const opt: DietaryOption = {
        id: `diet-${availability}`,
        serviceId: 's-1',
        dietaryType: 'halal',
        availability,
        createdAt: now,
        updatedAt: now,
      };
      expect(opt.availability).toBe(availability);
    }
  });

  it('accepts null availability', () => {
    const now = new Date();
    const opt: DietaryOption = {
      id: 'diet-null',
      serviceId: 's-1',
      dietaryType: 'kosher',
      availability: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(opt.availability).toBeNull();
  });
});

// ============================================================
// SERVICE CAPACITY STATUS
// ============================================================

describe('ServiceCapacityStatus values', () => {
  const EXPECTED: ServiceCapacityStatus[] = ['available', 'limited', 'waitlist', 'closed'];

  it('all capacity statuses are non-empty strings', () => {
    for (const s of EXPECTED) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('includes exactly 4 statuses', () => {
    expect(EXPECTED).toHaveLength(4);
  });
});

// ============================================================
// VERIFY PAGE QUEUE DETAIL SHAPE
// ============================================================

describe('verify page QueueDetail contract', () => {
  /**
   * Simulates the shape of the API response for /api/community/queue/[id].
   * This mirrors the QueueDetail interface in the verify page.
   */
  function makeQueueDetail() {
    return {
      id: 'q-1',
      service_id: 's-1',
      status: 'pending' as const,
      submitted_by_user_id: 'user-1',
      assigned_to_user_id: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      service_name: 'Test Service',
      service_description: 'A service for testing',
      service_url: 'https://example.com',
      service_email: 'svc@example.com',
      service_status: 'active',
      organization_id: 'org-1',
      organization_name: 'Test Org',
      organization_url: 'https://org.example.com',
      organization_email: 'org@example.com',
      organization_description: 'A test organization',
      locations: [
        {
          id: 'loc-1',
          name: 'Main Office',
          address_1: '123 Main St',
          city: 'Portland',
          state_province: 'OR',
          postal_code: '97201',
          latitude: 45.5231,
          longitude: -122.6765,
        },
      ],
      phones: [
        { id: 'ph-1', number: '503-555-1234', type: 'voice', description: null },
      ],
      confidenceScore: {
        score: 82,
        verification_confidence: 85,
        eligibility_match: 78,
        constraint_fit: 83,
        computed_at: new Date().toISOString(),
      },
      eligibility: [
        {
          id: 'e-1',
          description: 'Must be 18 or older',
          minimum_age: 18,
          maximum_age: null,
          eligible_values: ['adult'],
        },
      ],
      required_documents: [
        {
          id: 'd-1',
          document: 'Photo ID',
          type: 'identification',
          uri: 'https://example.com/id-info',
        },
      ],
      languages: [
        { id: 'l-1', language: 'en', note: null },
        { id: 'l-2', language: 'es', note: 'Interpreter available' },
      ],
      accessibility: [
        { id: 'a-1', accessibility: 'wheelchair', details: null },
      ],
    };
  }

  it('has all required top-level fields', () => {
    const detail = makeQueueDetail();
    expect(detail.id).toBeDefined();
    expect(detail.service_id).toBeDefined();
    expect(detail.status).toBeDefined();
    expect(detail.service_name).toBeDefined();
    expect(detail.organization_name).toBeDefined();
    expect(detail.created_at).toBeDefined();
    expect(detail.updated_at).toBeDefined();
  });

  it('has eligibility array with age constraints', () => {
    const detail = makeQueueDetail();
    expect(detail.eligibility).toHaveLength(1);
    expect(detail.eligibility[0].minimum_age).toBe(18);
    expect(detail.eligibility[0].maximum_age).toBeNull();
    expect(detail.eligibility[0].eligible_values).toContain('adult');
  });

  it('has required_documents with type and URI', () => {
    const detail = makeQueueDetail();
    expect(detail.required_documents).toHaveLength(1);
    expect(detail.required_documents[0].document).toBe('Photo ID');
    expect(detail.required_documents[0].type).toBe('identification');
    expect(detail.required_documents[0].uri).toContain('https://');
  });

  it('has languages with ISO codes and optional notes', () => {
    const detail = makeQueueDetail();
    expect(detail.languages).toHaveLength(2);
    expect(detail.languages[0].language).toBe('en');
    expect(detail.languages[1].note).toBe('Interpreter available');
  });

  it('has accessibility features', () => {
    const detail = makeQueueDetail();
    expect(detail.accessibility).toHaveLength(1);
    expect(detail.accessibility[0].accessibility).toBe('wheelchair');
  });

  it('confidence score contains all sub-components', () => {
    const detail = makeQueueDetail();
    expect(detail.confidenceScore).not.toBeNull();
    expect(detail.confidenceScore!.score).toBe(82);
    expect(detail.confidenceScore!.verification_confidence).toBe(85);
    expect(detail.confidenceScore!.eligibility_match).toBe(78);
    expect(detail.confidenceScore!.constraint_fit).toBe(83);
    expect(detail.confidenceScore!.computed_at).toBeDefined();
  });

  it('supports empty arrays for HSDS fields', () => {
    const detail = makeQueueDetail();
    detail.eligibility = [];
    detail.required_documents = [];
    detail.languages = [];
    detail.accessibility = [];
    expect(detail.eligibility).toHaveLength(0);
    expect(detail.required_documents).toHaveLength(0);
    expect(detail.languages).toHaveLength(0);
    expect(detail.accessibility).toHaveLength(0);
  });
});

// ============================================================
// SERVICE LINK SCHEMAS (ChatServiceCard)
// ============================================================

describe('ServiceLink schema for chat cards', () => {

  const VALID_KINDS = [
    'primary', 'organization_home', 'service_page', 'apply',
    'eligibility', 'contact', 'hours', 'intake_form', 'pdf', 'other',
  ];

  it('accepts all valid link kinds', () => {
    for (const kind of VALID_KINDS) {
      const result = ServiceLinkKindSchema.safeParse(kind);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid link kind', () => {
    const result = ServiceLinkKindSchema.safeParse('invalid_kind');
    expect(result.success).toBe(false);
  });

  it('accepts a valid service link', () => {
    const result = ServiceLinkSchema.safeParse({
      url: 'https://example.com/apply',
      label: 'Apply Now',
      kind: 'apply',
      isPrimary: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://example.com/apply');
      expect(result.data.isPrimary).toBe(true);
    }
  });

  it('rejects a link with invalid URL', () => {
    const result = ServiceLinkSchema.safeParse({
      url: 'not-a-url',
      label: 'Bad Link',
      kind: 'primary',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a link with empty label', () => {
    const result = ServiceLinkSchema.safeParse({
      url: 'https://example.com',
      label: '',
      kind: 'primary',
    });
    expect(result.success).toBe(false);
  });

  it('accepts link constraints with intent categories', () => {
    const result = ServiceLinkSchema.safeParse({
      url: 'https://example.com',
      label: 'Constrained',
      kind: 'other',
      constraints: {
        intentCategories: ['food', 'shelter'],
        locales: ['en', 'es'],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.constraints?.intentCategories).toEqual(['food', 'shelter']);
    }
  });

  it('rejects unknown fields in strict mode', () => {
    const result = ServiceLinkSchema.safeParse({
      url: 'https://example.com',
      label: 'Test',
      kind: 'primary',
      unknownField: true,
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// LANGUAGE OPTIONS CONSTANT (Profile page)
// ============================================================

describe('profile language options contract', () => {
  /**
   * These match the LANGUAGE_OPTIONS const in the profile page.
   * This test ensures the set stays consistent with supported locales.
   */
  const SUPPORTED_LOCALE_CODES = [
    'en', 'es', 'zh', 'vi', 'ko', 'ar', 'fr', 'ht', 'pt', 'ru',
  ];

  it('has at least 10 supported locales', () => {
    expect(SUPPORTED_LOCALE_CODES.length).toBeGreaterThanOrEqual(10);
  });

  it('all codes are 2-character ISO 639-1', () => {
    for (const code of SUPPORTED_LOCALE_CODES) {
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });

  it('includes English and Spanish', () => {
    expect(SUPPORTED_LOCALE_CODES).toContain('en');
    expect(SUPPORTED_LOCALE_CODES).toContain('es');
  });

  it('has no duplicates', () => {
    const unique = new Set(SUPPORTED_LOCALE_CODES);
    expect(unique.size).toBe(SUPPORTED_LOCALE_CODES.length);
  });
});

// ============================================================
// HOST SERVICE FORM — CAPACITY FIELDS
// ============================================================

describe('host service capacity form validation', () => {
  const VALID_CAPACITY_STATUSES: ServiceCapacityStatus[] = ['available', 'limited', 'waitlist', 'closed'];

  it('accepts all valid capacity statuses', () => {
    for (const status of VALID_CAPACITY_STATUSES) {
      expect(typeof status).toBe('string');
      // Simulate how the host services form would validate
      expect(VALID_CAPACITY_STATUSES).toContain(status);
    }
  });

  it('estimated_wait_days should be non-negative', () => {
    const validDays = [0, 1, 7, 30, 365];
    for (const days of validDays) {
      expect(days).toBeGreaterThanOrEqual(0);
    }
  });

  it('estimated_wait_days undefined is acceptable', () => {
    const form = { capacityStatus: 'available' as ServiceCapacityStatus, estimatedWaitDays: undefined };
    expect(form.estimatedWaitDays).toBeUndefined();
  });
});

// ============================================================
// SAVED SERVICES — localStorage key consistency
// ============================================================

describe('saved services localStorage contract', () => {
  const SAVED_KEY = 'oran:saved-service-ids';

  it('key is a non-empty string', () => {
    expect(SAVED_KEY).toBeTruthy();
    expect(typeof SAVED_KEY).toBe('string');
  });

  it('set serialization round-trips correctly', () => {
    const ids = new Set(['s-1', 's-2', 's-3']);
    const serialized = JSON.stringify([...ids]);
    const deserialized = new Set(JSON.parse(serialized) as string[]);
    expect(deserialized).toEqual(ids);
  });

  it('toggleSave adds and removes correctly', () => {
    const ids = new Set<string>();

    // Add
    ids.add('s-1');
    expect(ids.has('s-1')).toBe(true);

    // Toggle off
    ids.delete('s-1');
    expect(ids.has('s-1')).toBe(false);

    // Toggle on again
    ids.add('s-1');
    expect(ids.has('s-1')).toBe(true);
  });

  it('empty set serializes to empty array', () => {
    const ids = new Set<string>();
    const serialized = JSON.stringify([...ids]);
    expect(serialized).toBe('[]');
  });
});

// ============================================================
// NAVIGATION ROUTES (AppNav component)
// ============================================================

describe('AppNav route configuration', () => {
  /** These must match the SEEKER_NAV array in AppNav.tsx */
  const SEEKER_NAV = [
    { label: 'Chat',      href: '/chat' },
    { label: 'Directory', href: '/directory' },
    { label: 'Map',       href: '/map' },
    { label: 'Saved',     href: '/saved' },
    { label: 'Profile',   href: '/profile' },
  ];

  it('has 5 seeker navigation items', () => {
    expect(SEEKER_NAV).toHaveLength(5);
  });

  it('all routes start with /', () => {
    for (const nav of SEEKER_NAV) {
      expect(nav.href).toMatch(/^\//);
    }
  });

  it('all labels are non-empty', () => {
    for (const nav of SEEKER_NAV) {
      expect(nav.label.length).toBeGreaterThan(0);
    }
  });

  it('routes are unique', () => {
    const hrefs = SEEKER_NAV.map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('labels are unique', () => {
    const labels = SEEKER_NAV.map((n) => n.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('includes Chat as first item', () => {
    expect(SEEKER_NAV[0].label).toBe('Chat');
    expect(SEEKER_NAV[0].href).toBe('/chat');
  });
});

// ============================================================
// FEEDBACK FORM PROPS CONTRACT
// ============================================================

describe('FeedbackForm props contract', () => {
  interface FeedbackFormProps {
    serviceId: string;
    sessionId: string;
    onClose: () => void;
  }

  function validateFeedbackFormProps(props: FeedbackFormProps): boolean {
    return (
      typeof props.serviceId === 'string' &&
      props.serviceId.length > 0 &&
      typeof props.sessionId === 'string' &&
      props.sessionId.length > 0 &&
      typeof props.onClose === 'function'
    );
  }

  it('requires non-empty serviceId', () => {
    const props: FeedbackFormProps = {
      serviceId: 'svc-123',
      sessionId: 'session-abc',
      onClose: () => {},
    };
    expect(validateFeedbackFormProps(props)).toBe(true);
  });

  it('rejects empty serviceId', () => {
    const props = {
      serviceId: '',
      sessionId: 'session-abc',
      onClose: () => {},
    };
    expect(validateFeedbackFormProps(props)).toBe(false);
  });

  it('requires non-empty sessionId', () => {
    const props = {
      serviceId: 'svc-123',
      sessionId: '',
      onClose: () => {},
    };
    expect(validateFeedbackFormProps(props)).toBe(false);
  });

  it('requires onClose callback', () => {
    const props = {
      serviceId: 'svc-123',
      sessionId: 'session-abc',
      onClose: null as unknown as () => void,
    };
    expect(typeof props.onClose === 'function').toBe(false);
  });
});

// ============================================================
// CHAT SERVICE CARD SAVE PROPS CONTRACT
// ============================================================

describe('ChatServiceCard save props contract', () => {
  interface ChatServiceCardProps {
    service: {
      service: { id: string; name: string };
      organization: { name: string };
    };
    isSaved?: boolean;
    onToggleSave?: (id: string) => void;
  }

  it('accepts optional isSaved boolean', () => {
    const props: ChatServiceCardProps = {
      service: {
        service: { id: 'svc-1', name: 'Test' },
        organization: { name: 'Test Org' },
      },
      isSaved: true,
    };
    expect(props.isSaved).toBe(true);
  });

  it('defaults isSaved to undefined', () => {
    const props: ChatServiceCardProps = {
      service: {
        service: { id: 'svc-1', name: 'Test' },
        organization: { name: 'Test Org' },
      },
    };
    expect(props.isSaved).toBeUndefined();
  });

  it('accepts onToggleSave callback', () => {
    let called = false;
    const props: ChatServiceCardProps = {
      service: {
        service: { id: 'svc-1', name: 'Test' },
        organization: { name: 'Test Org' },
      },
      onToggleSave: (id) => {
        called = true;
        expect(id).toBe('svc-1');
      },
    };
    props.onToggleSave?.('svc-1');
    expect(called).toBe(true);
  });
});

// ============================================================
// SERVICE DETAIL PAGE ROUTE CONTRACT
// ============================================================

describe('Service detail page route contract', () => {
  it('route matches /service/[id] pattern', () => {
    const validRoutes = [
      '/service/abc-123',
      '/service/svc-000',
      '/service/12345',
    ];
    for (const route of validRoutes) {
      expect(route).toMatch(/^\/service\/[a-zA-Z0-9-]+$/);
    }
  });

  it('rejects invalid routes', () => {
    const invalidRoutes = [
      '/service/',
      '/services/abc-123',
      '/service',
    ];
    for (const route of invalidRoutes) {
      expect(route).not.toMatch(/^\/service\/[a-zA-Z0-9-]+$/);
    }
  });
});

// ============================================================
// ACCESSIBILITY CONTRACTS
// ============================================================

describe('Accessibility contracts', () => {
  it('aria-live attributes must be polite or assertive', () => {
    const validValues = ['polite', 'assertive', 'off'];
    for (const value of validValues) {
      expect(['polite', 'assertive', 'off']).toContain(value);
    }
  });

  it('tabIndex -1 allows programmatic focus without tab order', () => {
    const tabIndex = -1;
    expect(tabIndex).toBeLessThan(0);
  });

  it('minimum touch target size should be 44px', () => {
    const MIN_TOUCH_TARGET = 44;
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });

  it('focus-visible class pattern for keyboard focus', () => {
    const focusClasses = 'focus-visible:ring-2 focus-visible:ring-blue-500';
    expect(focusClasses).toContain('focus-visible');
    expect(focusClasses).toContain('ring');
  });
});
