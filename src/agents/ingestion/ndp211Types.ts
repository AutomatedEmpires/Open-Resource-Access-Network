/**
 * 211 NDP (National Data Platform) API V2 — Zod schemas & TypeScript types.
 *
 * These types model the response shapes of the 211 NDP Export V2, Query V2,
 * and Search V2 APIs as documented at https://apiportal.211.org/apis.
 *
 * The 211 NDP API is **not** standard HSDS — it has its own shape for
 * taxonomy, eligibility, fees, meta, etc. This file captures that shape
 * so that the connector can map it into ORAN's source assertion model.
 */

import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────

export const Ndp211AccessSchema = z.enum([
  'public', 'private', 'referral', 'directory', 'research', 'website',
]);

export const Ndp211AddressTypeSchema = z.enum(['physical', 'mailing', 'other']);

export const Ndp211PhoneTypeSchema = z.enum([
  'unknown', 'hotline', 'after_hours', 'toll_free', 'intake',
  'admin', 'main', 'alternate', 'fax', 'tty', 'contact', 'other',
]);

export const Ndp211ScheduleTypeSchema = z.enum([
  'regular', 'seasonal', 'temporary', 'other',
]);

export const Ndp211OpenDaySchema = z.enum([
  'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
]);

export const Ndp211MetaStatusSchema = z.enum([
  'active', 'inactive', 'deleted', 'draft',
]);

export const Ndp211FeeTypeSchema = z.enum([
  'unknown', 'no_fee', 'partial_fee', 'full_fee', 'other', 'not_applicable',
]);

export const Ndp211ServiceAreaTypeSchema = z.enum([
  'unknown', 'postal_code', 'locality', 'county', 'state', 'country', 'place',
]);

export const Ndp211EligibilityTypeSchema = z.enum([
  'unknown', 'crisis', 'low_income', 'residency', 'disability', 'veteran',
  'senior', 'youth', 'uninsured', 'transgender', 'homelessness',
  'victim_of_violence', 'student', 'food_insecurity', 'medical_issue',
  'home_ownership', 'other',
]);

export const Ndp211DocumentTypeSchema = z.enum([
  'other', 'birth_certificate', 'drivers_license', 'picture_id', 'passport',
  'proof_of_income', 'proof_of_residency', 'proof_of_health_insurance',
  'social_security', 'proof_of_insurance', 'proof_of_immunization',
  'proof_of_immigration', 'proof_of_citizenship',
]);

export const Ndp211LegalStatusSchema = z.enum([
  'none_or_unknown', 'non_profit', 'government', 'charity', 'for_profit', 'other',
]);

export const Ndp211TaxStatusSchema = z.enum([
  'none_or_unknown', 'non_profit', 'government', 'charity', 'for_profit', 'other',
]);

export const Ndp211AccessibilityTypeSchema = z.enum([
  'unknown', 'wheel_chair_access', 'designated_parking',
  'accessible_bathroom', 'elevator', 'outside_ramps',
]);

// ── Sub-objects ───────────────────────────────────────────────

export const Ndp211PhoneSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  type: Ndp211PhoneTypeSchema.nullable().optional(),
  number: z.string().nullable().optional(),
  extension: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  isMain: z.boolean().nullable().optional(),
  access: Ndp211AccessSchema.nullable().optional(),
}).passthrough();

export const Ndp211ContactSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phones: z.array(Ndp211PhoneSchema).default([]),
  isMain: z.boolean().nullable().optional(),
  access: Ndp211AccessSchema.nullable().optional(),
}).passthrough();

export const Ndp211ScheduleOpenSchema = z.object({
  day: Ndp211OpenDaySchema.nullable().optional(),
  opensAt: z.string().nullable().optional(),
  closesAt: z.string().nullable().optional(),
}).passthrough();

export const Ndp211ScheduleSchema = z.object({
  id: z.string().nullable().optional(),
  type: Ndp211ScheduleTypeSchema.nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  open: z.array(Ndp211ScheduleOpenSchema).default([]),
  description: z.string().nullable().optional(),
}).passthrough();

export const Ndp211MetaTemporaryMessageSchema = z.object({
  message: z.string().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
}).passthrough();

export const Ndp211MetaSchema = z.object({
  idResource: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  access: Ndp211AccessSchema.nullable().optional(),
  status: Ndp211MetaStatusSchema.nullable().optional(),
  reasonInactive: z.string().nullable().optional(),
  lastUpdated: z.string().nullable().optional(),
  lastVerified: z.string().nullable().optional(),
  created: z.string().nullable().optional(),
  temporaryMessage: Ndp211MetaTemporaryMessageSchema.nullable().optional(),
}).passthrough();

export const Ndp211TaxonomyTargetSchema = z.object({
  code: z.string().nullable().optional(),
  term: z.string().nullable().optional(),
}).passthrough();

export const Ndp211TaxonomySchema = z.object({
  id: z.string().nullable().optional(),
  taxonomyTerm: z.string().nullable().optional(),
  taxonomyCode: z.string().nullable().optional(),
  taxonomyTermLevel1: z.string().nullable().optional(),
  taxonomyTermLevel2: z.string().nullable().optional(),
  taxonomyTermLevel3: z.string().nullable().optional(),
  taxonomyTermLevel4: z.string().nullable().optional(),
  taxonomyTermLevel5: z.string().nullable().optional(),
  taxonomyTermLevel6: z.string().nullable().optional(),
  targets: z.array(Ndp211TaxonomyTargetSchema).default([]),
}).passthrough();

export const Ndp211FeesSchema = z.object({
  type: Ndp211FeeTypeSchema.nullable().optional(),
  description: z.string().nullable().optional(),
}).passthrough();

export const Ndp211EligibilitySchema = z.object({
  description: z.string().nullable().optional(),
  types: z.array(Ndp211EligibilityTypeSchema).default([]),
}).passthrough();

export const Ndp211LanguagesSchema = z.object({
  description: z.string().nullable().optional(),
  codes: z.array(z.string()).default([]),
}).passthrough();

export const Ndp211DocumentSchema = z.object({
  description: z.string().nullable().optional(),
  types: z.array(Ndp211DocumentTypeSchema).default([]),
}).passthrough();

export const Ndp211ServiceAreaGeoComponentSchema = z.object({
  postalCode: z.string().nullable().optional(),
  locality: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
}).passthrough();

export const Ndp211ServiceAreaSchema = z.object({
  id: z.string().nullable().optional(),
  type: Ndp211ServiceAreaTypeSchema.nullable().optional(),
  value: z.string().nullable().optional(),
  geoJson: z.unknown().nullable().optional(),
  geoComponents: z.array(Ndp211ServiceAreaGeoComponentSchema).default([]),
}).passthrough();

export const Ndp211AddressSchema = z.object({
  id: z.string().nullable().optional(),
  type: Ndp211AddressTypeSchema.nullable().optional(),
  postalCode: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  geocode: z.unknown().nullable().optional(),
  description: z.string().nullable().optional(),
  access: Ndp211AccessSchema.nullable().optional(),
}).passthrough();

export const Ndp211AccessibilitySchema = z.object({
  description: z.string().nullable().optional(),
  types: z.union([
    Ndp211AccessibilityTypeSchema,
    z.array(Ndp211AccessibilityTypeSchema),
  ]).nullable().optional(),
}).passthrough();

// ── Top-level entities ────────────────────────────────────────

export const Ndp211ServiceSchema = z.object({
  id: z.string(),
  idProgram: z.string().nullable().optional(),
  idOrganization: z.string().nullable().optional(),
  name: z.string(),
  alternateNames: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
  contacts: z.array(Ndp211ContactSchema).default([]),
  phones: z.array(Ndp211PhoneSchema).default([]),
  schedules: z.array(Ndp211ScheduleSchema).default([]),
  taxonomy: z.array(Ndp211TaxonomySchema).default([]),
  applicationProcess: z.string().nullable().optional(),
  interpretationServices: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  waitTime: z.string().nullable().optional(),
  fees: Ndp211FeesSchema.nullable().optional(),
  accreditations: z.array(z.string()).default([]),
  licenses: z.array(z.string()).default([]),
  languages: Ndp211LanguagesSchema.nullable().optional(),
  funding: z.string().nullable().optional(),
  eligibility: Ndp211EligibilitySchema.nullable().optional(),
  serviceAreas: z.array(Ndp211ServiceAreaSchema).default([]),
  documents: Ndp211DocumentSchema.nullable().optional(),
  locationIds: z.array(z.string()).default([]),
  meta: Ndp211MetaSchema.nullable().optional(),
}).passthrough();

export const Ndp211LocationSchema = z.object({
  id: z.string(),
  idOrganization: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  alternateNames: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
  contacts: z.array(Ndp211ContactSchema).default([]),
  phones: z.array(Ndp211PhoneSchema).default([]),
  schedules: z.array(Ndp211ScheduleSchema).default([]),
  longitude: z.number().nullable().optional(),
  latitude: z.number().nullable().optional(),
  addresses: z.array(Ndp211AddressSchema).default([]),
  accessibility: Ndp211AccessibilitySchema.nullable().optional(),
  transportation: z.string().nullable().optional(),
  languages: Ndp211LanguagesSchema.nullable().optional(),
  url: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  serviceIds: z.array(z.string()).default([]),
  meta: Ndp211MetaSchema.nullable().optional(),
}).passthrough();

export const Ndp211ServiceAtLocationSchema = z.object({
  id: z.string(),
  idOrganization: z.string().nullable().optional(),
  idService: z.string().nullable().optional(),
  idLocation: z.string().nullable().optional(),
  contacts: z.array(Ndp211ContactSchema).default([]),
  phones: z.array(Ndp211PhoneSchema).default([]),
  schedules: z.array(Ndp211ScheduleSchema).default([]),
  url: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  meta: Ndp211MetaSchema.nullable().optional(),
}).passthrough();

export const Ndp211ProgramSchema = z.object({
  id: z.string(),
  idOrganization: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  alternateNames: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
}).passthrough();

export const Ndp211OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  alternateNames: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  yearIncorporated: z.number().nullable().optional(),
  taxStatus: Ndp211TaxStatusSchema.nullable().optional(),
  taxId: z.string().nullable().optional(),
  legalStatus: Ndp211LegalStatusSchema.nullable().optional(),
  funding: z.string().nullable().optional(),
  contacts: z.array(Ndp211ContactSchema).default([]),
  phones: z.array(Ndp211PhoneSchema).default([]),
  services: z.array(Ndp211ServiceSchema).default([]),
  programs: z.array(Ndp211ProgramSchema).default([]),
  locations: z.array(Ndp211LocationSchema).default([]),
  servicesAtLocations: z.array(Ndp211ServiceAtLocationSchema).default([]),
  meta: Ndp211MetaSchema.nullable().optional(),
  dataOwner: z.string().nullable().optional(),
  dataOwnerDisplayName: z.string().nullable().optional(),
  dataSteward: z.string().nullable().optional(),
  dataStewardDisplayName: z.string().nullable().optional(),
}).passthrough();

// ── Inferred types ────────────────────────────────────────────

export type Ndp211Organization = z.infer<typeof Ndp211OrganizationSchema>;
export type Ndp211Service = z.infer<typeof Ndp211ServiceSchema>;
export type Ndp211Location = z.infer<typeof Ndp211LocationSchema>;
export type Ndp211ServiceAtLocation = z.infer<typeof Ndp211ServiceAtLocationSchema>;
export type Ndp211Phone = z.infer<typeof Ndp211PhoneSchema>;
export type Ndp211Contact = z.infer<typeof Ndp211ContactSchema>;
export type Ndp211Taxonomy = z.infer<typeof Ndp211TaxonomySchema>;
export type Ndp211Meta = z.infer<typeof Ndp211MetaSchema>;
export type Ndp211Address = z.infer<typeof Ndp211AddressSchema>;
export type Ndp211Schedule = z.infer<typeof Ndp211ScheduleSchema>;
export type Ndp211ServiceArea = z.infer<typeof Ndp211ServiceAreaSchema>;
export type Ndp211Eligibility = z.infer<typeof Ndp211EligibilitySchema>;
export type Ndp211Fees = z.infer<typeof Ndp211FeesSchema>;
