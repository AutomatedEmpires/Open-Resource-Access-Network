# ORAN Import Pipeline

See the full pipeline documentation in [/docs/solutions/IMPORT_PIPELINE.md](../../docs/solutions/IMPORT_PIPELINE.md).

## Quick Start

```bash
# Validate-only dry run
npx ts-node db/import/hsds-csv-importer.ts --dir ./my-import --dry-run

# Full import
npx ts-node db/import/hsds-csv-importer.ts --dir ./my-import
```

## Expected Directory Structure

```
my-import/
├── organizations.csv          # Required: org data
├── locations.csv              # Required: location data
├── services.csv               # Required: service data
├── service_at_location.csv    # Required: service-location links
├── phones.csv                 # Optional
├── addresses.csv              # Required
├── schedules.csv              # Optional
├── service_attributes.csv     # Optional: ORAN tags (delivery, cost, access, etc.)
├── service_adaptations.csv    # Optional: disability/health accommodations
└── dietary_options.csv        # Optional: food service dietary restrictions
```

## CSV Column Headers

Each CSV file must include a header row with HSDS field names. See [DATA_MODEL.md](../../docs/DATA_MODEL.md) for field definitions.

### ORAN Extension: service_attributes.csv

Tags services with searchable attributes across 6 dimensions.

| Column | Required | Description |
|--------|----------|-------------|
| service_id | Yes | UUID of the service |
| taxonomy | Yes | One of: `delivery`, `cost`, `access`, `culture`, `population`, `situation` |
| tag | Yes | Tag value (see [TAGGING_GUIDE.md](../../docs/governance/TAGGING_GUIDE.md)) |
| details | No | Human-readable elaboration |

Example:

```csv
service_id,taxonomy,tag,details
abc123,delivery,in_person,
abc123,delivery,virtual,Telehealth appointments available
abc123,cost,free,
abc123,access,no_id_required,
abc123,culture,spanish_speaking_staff,Bilingual staff on Tuesdays
```

### ORAN Extension: service_adaptations.csv

Service-level disability/health accommodations (distinct from location accessibility).

| Column | Required | Description |
|--------|----------|-------------|
| service_id | Yes | UUID of the service |
| adaptation_type | Yes | One of: `disability`, `health_condition`, `age_group`, `learning` |
| adaptation_tag | Yes | Tag value (see [TAGGING_GUIDE.md](../../docs/governance/TAGGING_GUIDE.md)) |
| details | No | Description of the accommodation |

Example:

```csv
service_id,adaptation_type,adaptation_tag,details
abc123,disability,deaf,ASL interpreter available by appointment
abc123,disability,autism,Sensory accommodations and visual schedules
abc123,age_group,senior,Geriatric-focused programming
```

### ORAN Extension: dietary_options.csv

For food services: dietary restrictions accommodated.

| Column | Required | Description |
|--------|----------|-------------|
| service_id | Yes | UUID of the service |
| dietary_type | Yes | e.g., `halal`, `kosher`, `vegan`, `gluten_free` |
| availability | No | `always`, `by_request`, `limited`, `seasonal` (default: `always`) |
| details | No | Elaboration |

Example:

```csv
service_id,dietary_type,availability,details
abc123,halal,by_request,Call 24 hours in advance
abc123,vegan,always,
abc123,kosher,limited,When donated
```

## LLM-Assisted Tagging

For automated ingestion from unstructured sources (website scrapes, PDFs), see:

- `src/services/ingestion/tagging-prompt.ts` — LLM prompt templates
- `docs/governance/TAGGING_GUIDE.md` — Complete tagging reference
