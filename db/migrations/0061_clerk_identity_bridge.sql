-- 0061_clerk_identity_bridge.sql
-- Clerk owns identity; ORAN continues to own canonical user IDs, roles,
-- memberships, account status, and authorization history.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT,
  ADD COLUMN IF NOT EXISTS auth_migrated_at TIMESTAMPTZ,
  ALTER COLUMN auth_provider SET DEFAULT 'clerk';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_clerk_user_id
  ON public.user_profiles (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.clerk_user_id IS
  'Clerk identity ID mapped to the stable ORAN user_id. New accounts use the Clerk ID for both values.';

COMMENT ON COLUMN public.user_profiles.auth_migrated_at IS
  'Time an existing ORAN identity was explicitly linked to Clerk; never inferred from email alone.';

COMMENT ON COLUMN public.user_profiles.auth_provider IS
  'Identity provider for the account. Clerk is the default for new profiles; historical values are retained.';

COMMIT;
