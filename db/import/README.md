# ORAN Import Pipeline

See the full pipeline documentation in [/docs/IMPORT_PIPELINE.md](../../docs/IMPORT_PIPELINE.md).

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
├── organizations.csv
├── locations.csv
├── services.csv
├── service_at_location.csv
├── phones.csv          (optional)
├── addresses.csv
└── schedules.csv       (optional)
```

## CSV Column Headers

Each CSV file must include a header row with HSDS field names. See [DATA_MODEL.md](../../docs/DATA_MODEL.md) for field definitions.
