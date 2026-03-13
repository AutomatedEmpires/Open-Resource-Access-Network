ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_username_lower
ON user_profiles (LOWER(username))
WHERE username IS NOT NULL;
