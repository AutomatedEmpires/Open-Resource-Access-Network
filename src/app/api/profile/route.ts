/**
 * GET/PUT /api/profile
 *
 * User profile management API. Requires authentication.
 * GET returns the user's shared profile and seeker-specific matching context.
 * PUT creates/updates shared profile preferences plus authenticated seeker profile fields.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/services/auth/session';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';
import {
  EMPTY_SEEKER_PROFILE,
  normalizeSeekerProfile,
  type SeekerProfile,
  UpdateProfileSchema,
} from '@/services/profile/contracts';

// ============================================================
// CONSTANTS
// ============================================================

const PROFILE_RATE_LIMIT_MAX = 20;

// ============================================================
// TYPES
// ============================================================

interface UserProfileRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  auth_provider: string | null;
  preferred_locale: string | null;
  approximate_city: string | null;
}

interface SeekerProfileRow {
  user_id: string;
  service_interests: string[] | null;
  age_group: string | null;
  household_type: string | null;
  housing_situation: string | null;
  self_identifiers: string[] | null;
  current_services: string[] | null;
  accessibility_needs: string[] | null;
  transportation_barrier: boolean | null;
  preferred_delivery_modes: string[] | null;
  urgency_window: string | null;
  documentation_barriers: string[] | null;
  digital_access_barrier: boolean | null;
  employment_status: string | null;
  income_range: string | null;
  household_size: number | null;
  veteran_service_preference: boolean | null;
  onboarding_profile_consent: boolean | null;
  onboarding_consent_version: string | null;
  onboarding_completed_at: string | Date | null;
  pronouns: string | null;
  profile_headline: string | null;
  avatar_emoji: string | null;
  accent_theme: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  additional_context: string | null;
}

interface ProfileResponse {
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  authProvider: string | null;
  preferredLocale: string | null;
  approximateCity: string | null;
  seekerProfile: SeekerProfile | null;
}

// ============================================================
// RATE LIMIT HELPER
// ============================================================

function checkProfileRateLimit(ip: string) {
  const rateLimit = checkRateLimitShared(`profile:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: PROFILE_RATE_LIMIT_MAX,
  });
  return rateLimit;
}

function normalizeDbTimestamp(value: string | Date | null): string {
  if (!value) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function mapSeekerProfileRow(row: SeekerProfileRow | undefined): SeekerProfile | null {
  if (!row) return null;

  return normalizeSeekerProfile({
    serviceInterests: (row.service_interests ?? EMPTY_SEEKER_PROFILE.serviceInterests) as SeekerProfile['serviceInterests'],
    ageGroup: (row.age_group ?? '') as SeekerProfile['ageGroup'],
    householdType: (row.household_type ?? '') as SeekerProfile['householdType'],
    housingSituation: (row.housing_situation ?? '') as SeekerProfile['housingSituation'],
    selfIdentifiers: (row.self_identifiers ?? EMPTY_SEEKER_PROFILE.selfIdentifiers) as SeekerProfile['selfIdentifiers'],
    currentServices: (row.current_services ?? EMPTY_SEEKER_PROFILE.currentServices) as SeekerProfile['currentServices'],
    accessibilityNeeds: (row.accessibility_needs ?? EMPTY_SEEKER_PROFILE.accessibilityNeeds) as SeekerProfile['accessibilityNeeds'],
    transportationBarrier: row.transportation_barrier ?? false,
    preferredDeliveryModes: (row.preferred_delivery_modes ?? EMPTY_SEEKER_PROFILE.preferredDeliveryModes) as SeekerProfile['preferredDeliveryModes'],
    urgencyWindow: (row.urgency_window ?? '') as SeekerProfile['urgencyWindow'],
    documentationBarriers: (row.documentation_barriers ?? EMPTY_SEEKER_PROFILE.documentationBarriers) as SeekerProfile['documentationBarriers'],
    digitalAccessBarrier: row.digital_access_barrier ?? false,
    employmentStatus: (row.employment_status ?? '') as SeekerProfile['employmentStatus'],
    incomeRange: (row.income_range ?? '') as SeekerProfile['incomeRange'],
    householdSize: row.household_size ?? null,
    veteranServicePreference: row.veteran_service_preference ?? false,
    onboardingProfileConsent: row.onboarding_profile_consent ?? false,
    onboardingConsentVersion: row.onboarding_consent_version ?? '',
    onboardingCompletedAt: normalizeDbTimestamp(row.onboarding_completed_at),
    pronouns: row.pronouns ?? '',
    profileHeadline: row.profile_headline ?? '',
    avatarEmoji: row.avatar_emoji ?? '',
    accentTheme: (row.accent_theme as SeekerProfile['accentTheme']) ?? 'ocean',
    contactPhone: row.contact_phone ?? '',
    contactEmail: row.contact_email ?? '',
    additionalContext: row.additional_context ?? '',
  });
}

// ============================================================
// GET HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Profile service is temporarily unavailable.' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = getIp(req);
  const rateLimit = await checkProfileRateLimit(ip);
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  // Authentication required
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const rows = await executeQuery<UserProfileRow>(
      `SELECT user_id, display_name, email, phone, auth_provider, preferred_locale, approximate_city
       FROM user_profiles
       WHERE user_id = $1`,
      [authCtx.userId]
    );

    const seekerRows = await executeQuery<SeekerProfileRow>(
      `SELECT user_id, service_interests, age_group, household_type, housing_situation,
              self_identifiers, current_services, accessibility_needs,
              transportation_barrier, preferred_delivery_modes, urgency_window,
              documentation_barriers, digital_access_barrier,
              employment_status, income_range, household_size, veteran_service_preference,
              onboarding_profile_consent, onboarding_consent_version,
              onboarding_completed_at, pronouns,
              profile_headline, avatar_emoji, accent_theme,
              contact_phone, contact_email, additional_context
         FROM seeker_profiles
        WHERE user_id = $1`,
      [authCtx.userId]
    );

    if (rows.length === 0 && seekerRows.length === 0) {
      return NextResponse.json({ profile: null });
    }

    const row = rows[0];
    const profile: ProfileResponse = {
      userId: row?.user_id ?? authCtx.userId,
      displayName: row?.display_name ?? null,
      email: row?.email ?? null,
      phone: row?.phone ?? null,
      authProvider: row?.auth_provider ?? null,
      preferredLocale: row?.preferred_locale ?? null,
      approximateCity: row?.approximate_city ?? null,
      seekerProfile: mapSeekerProfileRow(seekerRows[0]),
    };

    return NextResponse.json({ profile });
  } catch (error) {
    await captureException(error, {
      feature: 'api_profile_get',
      userId: authCtx.userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================
// PUT HANDLER
// ============================================================

export async function PUT(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Profile service is temporarily unavailable.' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = getIp(req);
  const rateLimit = await checkProfileRateLimit(ip);
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  // Authentication required
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate request
  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { approximateCity, preferredLocale, displayName, phone, seekerProfile } = parsed.data;

  try {
    // Identity and authorization fields always come from the authenticated
    // Clerk -> ORAN context, never from the request body.
    const rows = await executeQuery<UserProfileRow>(
      `INSERT INTO user_profiles (
         user_id, clerk_user_id, auth_provider,
         display_name, phone, preferred_locale, approximate_city
       )
       VALUES ($1, $2, 'clerk', $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         clerk_user_id = EXCLUDED.clerk_user_id,
         auth_provider = 'clerk',
         auth_migrated_at = CASE
           WHEN user_profiles.clerk_user_id IS DISTINCT FROM EXCLUDED.clerk_user_id
             OR user_profiles.auth_provider IS DISTINCT FROM 'clerk'
           THEN COALESCE(user_profiles.auth_migrated_at, now())
           ELSE user_profiles.auth_migrated_at
         END,
         display_name = COALESCE($3, user_profiles.display_name),
         phone = COALESCE($4, user_profiles.phone),
         preferred_locale = COALESCE($5, user_profiles.preferred_locale),
         approximate_city = COALESCE($6, user_profiles.approximate_city),
         updated_at = now()
       RETURNING user_id, display_name, email, phone, auth_provider, preferred_locale, approximate_city`,
      [
        authCtx.userId,
        authCtx.clerkUserId,
        displayName?.trim() || null,
        phone?.trim() || null,
        preferredLocale ?? null,
        approximateCity ?? null,
      ]
    );

    if (seekerProfile) {
      const normalized = normalizeSeekerProfile(seekerProfile);
      await executeQuery(
        `INSERT INTO seeker_profiles (
            user_id,
            service_interests,
            age_group,
            household_type,
            housing_situation,
            self_identifiers,
            current_services,
            accessibility_needs,
            transportation_barrier,
            preferred_delivery_modes,
            urgency_window,
            documentation_barriers,
            digital_access_barrier,
            employment_status,
            income_range,
            household_size,
            veteran_service_preference,
            onboarding_profile_consent,
            onboarding_consent_version,
            onboarding_completed_at,
            pronouns,
            profile_headline,
            avatar_emoji,
            accent_theme,
            contact_phone,
            contact_email,
            additional_context,
            updated_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $1)
          ON CONFLICT (user_id) DO UPDATE SET
            service_interests = EXCLUDED.service_interests,
            age_group = EXCLUDED.age_group,
            household_type = EXCLUDED.household_type,
            housing_situation = EXCLUDED.housing_situation,
            self_identifiers = EXCLUDED.self_identifiers,
            current_services = EXCLUDED.current_services,
            accessibility_needs = EXCLUDED.accessibility_needs,
            transportation_barrier = EXCLUDED.transportation_barrier,
            preferred_delivery_modes = EXCLUDED.preferred_delivery_modes,
            urgency_window = EXCLUDED.urgency_window,
            documentation_barriers = EXCLUDED.documentation_barriers,
            digital_access_barrier = EXCLUDED.digital_access_barrier,
            employment_status = EXCLUDED.employment_status,
            income_range = EXCLUDED.income_range,
            household_size = EXCLUDED.household_size,
            veteran_service_preference = EXCLUDED.veteran_service_preference,
            onboarding_profile_consent = EXCLUDED.onboarding_profile_consent,
            onboarding_consent_version = EXCLUDED.onboarding_consent_version,
            onboarding_completed_at = EXCLUDED.onboarding_completed_at,
            pronouns = EXCLUDED.pronouns,
            profile_headline = EXCLUDED.profile_headline,
            avatar_emoji = EXCLUDED.avatar_emoji,
            accent_theme = EXCLUDED.accent_theme,
            contact_phone = EXCLUDED.contact_phone,
            contact_email = EXCLUDED.contact_email,
            additional_context = EXCLUDED.additional_context,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = now()`,
        [
          authCtx.userId,
          normalized.serviceInterests,
          normalized.ageGroup || null,
          normalized.householdType || null,
          normalized.housingSituation || null,
          normalized.selfIdentifiers,
          normalized.currentServices,
          normalized.accessibilityNeeds,
          normalized.transportationBarrier,
          normalized.preferredDeliveryModes,
          normalized.urgencyWindow || null,
          normalized.documentationBarriers,
          normalized.digitalAccessBarrier,
          normalized.employmentStatus || null,
          normalized.incomeRange || null,
          normalized.householdSize,
          normalized.veteranServicePreference,
          normalized.onboardingProfileConsent,
          normalized.onboardingConsentVersion || null,
          normalized.onboardingCompletedAt || null,
          normalized.pronouns || null,
          normalized.profileHeadline || null,
          normalized.avatarEmoji || null,
          normalized.accentTheme,
          normalized.contactPhone || null,
          normalized.contactEmail || null,
          normalized.additionalContext || null,
        ]
      );
    }

    const seekerRows = await executeQuery<SeekerProfileRow>(
      `SELECT user_id, service_interests, age_group, household_type, housing_situation,
              self_identifiers, current_services, accessibility_needs,
              transportation_barrier, preferred_delivery_modes, urgency_window,
              documentation_barriers, digital_access_barrier,
              employment_status, income_range, household_size, veteran_service_preference,
              onboarding_profile_consent, onboarding_consent_version,
              onboarding_completed_at, pronouns,
              profile_headline, avatar_emoji, accent_theme,
              contact_phone, contact_email, additional_context
         FROM seeker_profiles
        WHERE user_id = $1`,
      [authCtx.userId]
    );

    const row = rows[0];
    const profile: ProfileResponse = {
      userId: row.user_id,
      displayName: row.display_name ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      authProvider: row.auth_provider ?? null,
      preferredLocale: row.preferred_locale,
      approximateCity: row.approximate_city,
      seekerProfile: mapSeekerProfileRow(seekerRows[0]),
    };

    return NextResponse.json({ profile });
  } catch (error) {
    await captureException(error, {
      feature: 'api_profile_put',
      userId: authCtx.userId,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
