# Search Contract

## Scope

Defines retrieval behavior, filtering, and search response integrity.

## Inputs

- Query text
- Optional geospatial or category filters
- Pagination/sort controls

## Required Guarantees

- Results are sourced from stored records only.
- No fabricated providers, addresses, phone numbers, or URLs.
- Query handling must respect privacy and abuse controls.

## Failure Modes

- Empty or low-confidence result set -> return explicit no-result response and safe guidance.
- Backend degradation -> fail safely without fabricated fallback data.

## Validation

- Search query-builder tests
- End-to-end checks on primary search journeys

## References

- `docs/SCORING_MODEL.md`
- `docs/DATA_MODEL.md`
- `src/services/search/**`
