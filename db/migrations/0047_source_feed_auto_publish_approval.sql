ALTER TABLE source_feed_states
  ADD COLUMN IF NOT EXISTS auto_publish_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_publish_approved_by TEXT;
