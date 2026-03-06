-- Migration: 0031_multi_provider_auth
-- Purpose: Add columns to user_profiles for multi-provider auth (Google, credentials).
--          Adds email, password_hash, phone, auth_provider.
--          Approval→role promotion support: function to promote user on claim approval.

BEGIN;

-- ────────────────────────────────────────────────────────
-- 1. Extend user_profiles for multi-provider auth
-- ────────────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS email        TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS phone        TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'azure-ad';

-- Email uniqueness (partial — only for non-null emails)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email
  ON user_profiles (email) WHERE email IS NOT NULL;

-- Auth provider validation
ALTER TABLE user_profiles
  ADD CONSTRAINT chk_user_profiles_auth_provider
  CHECK (auth_provider IN ('azure-ad', 'google', 'credentials'));

COMMENT ON COLUMN user_profiles.email IS 'User email. Required for credentials provider. Optional for OAuth providers.';
COMMENT ON COLUMN user_profiles.password_hash IS 'bcrypt hash. Only populated for credentials provider.';
COMMENT ON COLUMN user_profiles.phone IS 'Optional phone number.';
COMMENT ON COLUMN user_profiles.auth_provider IS 'Identity provider: azure-ad, google, or credentials.';

COMMIT;
