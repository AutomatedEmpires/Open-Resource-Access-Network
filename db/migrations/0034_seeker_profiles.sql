-- 0034_seeker_profiles.sql
-- Dedicated authenticated seeker profile persistence.
-- Keeps seeker-specific matching context separate from the shared user_profiles
-- auth / role table used by seeker, host, community-admin, and ORAN admin portals.

BEGIN;

CREATE TABLE IF NOT EXISTS seeker_profiles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             TEXT NOT NULL UNIQUE REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  service_interests   TEXT[] NOT NULL DEFAULT '{}',
  age_group           TEXT,
  household_type      TEXT,
  housing_situation   TEXT,
  self_identifiers    TEXT[] NOT NULL DEFAULT '{}',
  current_services    TEXT[] NOT NULL DEFAULT '{}',
  accessibility_needs TEXT[] NOT NULL DEFAULT '{}',
  pronouns            TEXT,
  profile_headline    TEXT,
  avatar_emoji        TEXT,
  accent_theme        TEXT NOT NULL DEFAULT 'ocean',
  contact_phone       TEXT,
  contact_email       TEXT,
  additional_context  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  TEXT,
  updated_by_user_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_seeker_profiles_user
  ON seeker_profiles(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_seeker_profiles'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_seeker_profiles
      BEFORE UPDATE ON seeker_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE seeker_profiles IS 'Authenticated seeker-only matching context. Separate from shared auth and role profile data.';
COMMENT ON COLUMN seeker_profiles.service_interests IS 'Selected service categories for matching and ranking.';
COMMENT ON COLUMN seeker_profiles.self_identifiers IS 'Optional self-identified audience tags such as veteran or disability.';
COMMENT ON COLUMN seeker_profiles.current_services IS 'Programs already received to reduce duplicate recommendations.';
COMMENT ON COLUMN seeker_profiles.accessibility_needs IS 'Optional accessibility or accommodation preferences that help match appropriate services.';
COMMENT ON COLUMN seeker_profiles.pronouns IS 'Optional self-described pronouns for a more personal profile experience.';
COMMENT ON COLUMN seeker_profiles.profile_headline IS 'Optional short description of what matters most to the seeker.';
COMMENT ON COLUMN seeker_profiles.avatar_emoji IS 'Optional lightweight avatar choice for personalization without image upload storage.';
COMMENT ON COLUMN seeker_profiles.accent_theme IS 'UI accent theme preference for the signed-in seeker profile.';
COMMENT ON COLUMN seeker_profiles.contact_phone IS 'Optional seeker phone number. Treat as sensitive personal data.';
COMMENT ON COLUMN seeker_profiles.contact_email IS 'Optional seeker email. Treat as sensitive personal data.';
COMMENT ON COLUMN seeker_profiles.additional_context IS 'Free-text matching hints provided by the seeker. Avoid storing secrets or high-risk identifiers.';

COMMIT;
