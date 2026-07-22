-- Permit the canonical federation layer to use the shared external-identifier
-- registry. The normalizer has always written these entity kinds, but the
-- original 0032 constraint only admitted live-table entity kinds.

BEGIN;

ALTER TABLE public.entity_identifiers
  ADD CONSTRAINT entity_identifiers_entity_type_v2_check
  CHECK (entity_type IN (
    'organization',
    'service',
    'location',
    'canonical_organization',
    'canonical_service',
    'canonical_location'
  )) NOT VALID;

ALTER TABLE public.entity_identifiers
  VALIDATE CONSTRAINT entity_identifiers_entity_type_v2_check;

ALTER TABLE public.entity_identifiers
  DROP CONSTRAINT IF EXISTS entity_identifiers_entity_type_check;

ALTER TABLE public.entity_identifiers
  RENAME CONSTRAINT entity_identifiers_entity_type_v2_check
  TO entity_identifiers_entity_type_check;

-- Exact active canonical source identifiers are global identities. Distinct
-- schemes are used for organization, service, and location identifiers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_ids_canonical_source_identity
  ON public.entity_identifiers (identifier_scheme, identifier_value)
  WHERE entity_type IN (
    'canonical_organization',
    'canonical_service',
    'canonical_location'
  ) AND status = 'active';

COMMIT;
