-- Migration: Extend source_record_type CHECK constraint
-- Adds 'organization_bundle' and 'service_at_location' to the allowed
-- values for source_records.source_record_type.
--
-- The 211 NDP connector stores full organization bundles as
-- 'organization_bundle' records and junction links as
-- 'service_at_location' records. Both are valid HSDS-aligned
-- record types that the original migration (0032) did not
-- anticipate.

ALTER TABLE source_records
  DROP CONSTRAINT IF EXISTS source_records_source_record_type_check;

ALTER TABLE source_records
  ADD CONSTRAINT source_records_source_record_type_check
  CHECK (
    source_record_type IN (
      'organization', 'service', 'location',
      'taxonomy', 'taxonomy_term', 'mixed_bundle',
      'organization_bundle', 'service_at_location'
    )
  );
