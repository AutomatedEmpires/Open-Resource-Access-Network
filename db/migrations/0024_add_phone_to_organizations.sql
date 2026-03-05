-- Add phone column to organizations table
-- Phone is captured during org claim but was only stored in submission payload JSON.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone TEXT;
