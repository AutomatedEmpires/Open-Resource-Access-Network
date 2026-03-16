ALTER TABLE services
  ADD COLUMN IF NOT EXISTS integrity_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_hold_reason text,
  ADD COLUMN IF NOT EXISTS integrity_held_by_user_id text;

CREATE INDEX IF NOT EXISTS idx_services_integrity_hold_at
  ON services (integrity_hold_at)
  WHERE integrity_hold_at IS NOT NULL;
