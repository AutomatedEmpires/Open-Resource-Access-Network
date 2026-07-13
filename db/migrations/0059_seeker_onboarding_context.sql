-- 0059_seeker_onboarding_context.sql
-- Optional, consented seeker context collected by the progressive onboarding flow.
-- Exact income, precise location, immigration status, and identity-document data are not stored.

BEGIN;

ALTER TABLE seeker_profiles
  ADD COLUMN IF NOT EXISTS employment_status TEXT,
  ADD COLUMN IF NOT EXISTS income_range TEXT,
  ADD COLUMN IF NOT EXISTS household_size SMALLINT,
  ADD COLUMN IF NOT EXISTS veteran_service_preference BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_profile_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_consent_version TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seeker_profiles_employment_status_check'
  ) THEN
    ALTER TABLE seeker_profiles
      ADD CONSTRAINT seeker_profiles_employment_status_check
      CHECK (
        employment_status IS NULL OR employment_status IN (
          'employed_full_time',
          'employed_part_time',
          'self_employed',
          'unemployed_looking',
          'not_currently_working',
          'student',
          'retired',
          'prefer_not_to_say'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seeker_profiles_income_range_check'
  ) THEN
    ALTER TABLE seeker_profiles
      ADD CONSTRAINT seeker_profiles_income_range_check
      CHECK (
        income_range IS NULL OR income_range IN (
          'no_income',
          'under_1500_monthly',
          '1500_2999_monthly',
          '3000_4999_monthly',
          '5000_plus_monthly',
          'prefer_not_to_say'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'seeker_profiles_household_size_check'
  ) THEN
    ALTER TABLE seeker_profiles
      ADD CONSTRAINT seeker_profiles_household_size_check
      CHECK (household_size IS NULL OR household_size BETWEEN 1 AND 20);
  END IF;
END $$;

COMMENT ON COLUMN seeker_profiles.employment_status IS 'Optional broad work-status band supplied by the seeker for program matching.';
COMMENT ON COLUMN seeker_profiles.income_range IS 'Optional broad monthly household-income band. Exact income is intentionally not collected.';
COMMENT ON COLUMN seeker_profiles.household_size IS 'Optional household count used for eligibility matching; limited to a reasonable non-identifying range.';
COMMENT ON COLUMN seeker_profiles.veteran_service_preference IS 'Optional request to include veteran or military-family services; this is a service preference and must not be treated as proof of veteran identity.';
COMMENT ON COLUMN seeker_profiles.onboarding_profile_consent IS 'True only when the seeker explicitly chose to save onboarding answers to their profile.';
COMMENT ON COLUMN seeker_profiles.onboarding_consent_version IS 'Version of the privacy explanation accepted when onboarding context was saved.';
COMMENT ON COLUMN seeker_profiles.onboarding_completed_at IS 'Time the seeker explicitly saved onboarding context to their profile.';

COMMIT;
