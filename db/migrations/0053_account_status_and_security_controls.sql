ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS security_note TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_by_user_id TEXT;

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_account_status_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_account_status_check
  CHECK (account_status IN ('active', 'frozen'));

CREATE INDEX IF NOT EXISTS idx_user_profiles_account_status
  ON user_profiles(account_status);
