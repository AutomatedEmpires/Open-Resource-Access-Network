-- 0001_updated_at_triggers.sql
-- Ensure updated_at is set on UPDATE for tables that include the column.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_organizations'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_organizations
      BEFORE UPDATE ON organizations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_locations'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_locations
      BEFORE UPDATE ON locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_services'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_services
      BEFORE UPDATE ON services
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_verification_queue'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_verification_queue
      BEFORE UPDATE ON verification_queue
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_feature_flags'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_feature_flags
      BEFORE UPDATE ON feature_flags
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
