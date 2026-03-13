# HSDS Distribution API

HSDS routes are ORAN's standards-oriented public distribution surface.

They exist for interoperability, export/profile discovery, and external ecosystem use. They are
not the primary seeker retrieval API. Seeker discovery uses `/api/search`, and point lookup of
already-known service IDs uses `/api/services`.

## Endpoints

- `/api/hsds/profile` — ORAN HSDS profile metadata
- `/api/hsds/services` — paginated published service list
- `/api/hsds/services/[id]` — published service detail
- `/api/hsds/organizations` — paginated published organization list
- `/api/hsds/organizations/[id]` — published organization detail

## Contract

- Public, read-only, published-record-only
- No raw source assertions or extracted candidates
- No seeker-specific ranking semantics
- Built on the shared published-record read model used by the wider public distribution layer
- Compatible with the broader resource-distribution contract in `docs/contracts/RESOURCE_DISTRIBUTION_API.md`
