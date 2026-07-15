-- Migration: 0055_source_resource_purpose
-- Separates source trust from source intent. ORAN may use supporting datasets
-- (for example, retailer acceptance or geographic coverage) to enrich direct
-- services without publishing those records as standalone seeker resources.

ALTER TABLE source_systems
  ADD COLUMN IF NOT EXISTS resource_purpose TEXT NOT NULL DEFAULT 'service_catalog';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_systems_resource_purpose_check'
  ) THEN
    ALTER TABLE source_systems
      ADD CONSTRAINT source_systems_resource_purpose_check
      CHECK (resource_purpose IN (
        'service_catalog',
        'program_navigation',
        'supporting_reference',
        'excluded'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_source_systems_resource_purpose
  ON source_systems (resource_purpose);

-- Preserve already-collected retailer/merchant data as supporting context,
-- while preventing it from becoming a standalone service recommendation.
UPDATE source_systems
SET resource_purpose = 'supporting_reference',
    updated_at = NOW()
WHERE resource_purpose = 'service_catalog'
  AND (name ILIKE '%SNAP%' OR name ILIKE '%EBT%')
  AND (
    name ILIKE '%retailer%'
    OR name ILIKE '%merchant%'
    OR name ILIKE '%store%'
    OR name ILIKE '%accept%'
  );
