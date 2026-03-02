-- 0008_rename_assigned_to.sql
-- Rename verification_queue.assigned_to → assigned_to_user_id for consistency
-- with the Entra Object ID naming convention used across all other tables.
-- Also updates the existing index.
-- Idempotent: safe to run multiple times.

DO $$
BEGIN
  -- Only rename if old column exists and new column does not
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verification_queue' AND column_name = 'assigned_to'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'verification_queue' AND column_name = 'assigned_to_user_id'
  ) THEN
    ALTER TABLE verification_queue RENAME COLUMN assigned_to TO assigned_to_user_id;
  END IF;
END $$;

-- Recreate index on the renamed column (idempotent)
DROP INDEX IF EXISTS idx_vq_assigned;
CREATE INDEX IF NOT EXISTS idx_vq_assigned_user
  ON verification_queue(assigned_to_user_id);
