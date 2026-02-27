# ORAN Import Pipeline

The import pipeline ingests HSDS-formatted CSV data into ORAN's staging tables for review before publishing to the live database.

---

## Pipeline Stages

```
CSV Upload
    │
    ▼
┌─────────────────────┐
│  1. Validate        │  ← Zod schema validation of each row
└─────────────────────┘
    │ validation errors?
    ├── YES → Return error report. Stop.
    │
    ▼
┌─────────────────────┐
│  2. Stage           │  ← Insert into staging tables (not live)
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  3. Diff Detection  │  ← Compare staged vs. existing records
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  4. Admin Review    │  ← Human reviews diff in admin UI
└─────────────────────┘
    │ approved?
    ├── NO → Reject / edit and re-stage
    │
    ▼
┌─────────────────────┐
│  5. Publish         │  ← Copy staged records to live tables
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  6. Score Recalc    │  ← Recompute confidence scores for affected services
└─────────────────────┘
```

---

## HSDS CSV Format

ORAN accepts HSDS-compliant CSV exports. The minimum required files for a complete import batch:

| File                | Required | Description |
|---------------------|----------|-------------|
| `organizations.csv` | Yes      | Organization records |
| `locations.csv`     | Yes      | Location records |
| `services.csv`      | Yes      | Service records |
| `service_at_location.csv` | Yes | Service-location joins |
| `phones.csv`        | No       | Phone numbers |
| `addresses.csv`     | Yes      | Physical addresses |
| `schedules.csv`     | No       | Operating hours |

---

## Validation Rules

### Organization
- `name` required, max 255 chars
- `url` must be valid URL if present
- `email` must be valid email format if present
- `tax_id` format: `XX-XXXXXXX` (EIN format) if present

### Location
- `organization_id` must reference existing org or staged org in same batch
- `latitude` must be valid WGS84 latitude (-90 to 90) if present
- `longitude` must be valid WGS84 longitude (-180 to 180) if present

### Service
- `name` required, max 255 chars
- `status` must be one of: `active`, `inactive`, `defunct`
- `organization_id` must reference existing or staged org

### Address
- `address_1` required
- `city` required
- `state_province` required
- `postal_code` format validated per `country` code
- `country` required (ISO 3166-1 alpha-2)

---

## Staging Tables

Staging tables mirror live tables with additional columns:
- `import_batch_id` — UUID linking rows to an import batch
- `import_status` — `pending`, `approved`, `rejected`
- `import_diff` — JSONB diff vs. existing record (if updating)
- `imported_by` — Clerk user ID of importer
- `imported_at` — Timestamp

---

## Diff Detection

For each staged record:
1. Attempt to match to existing record by `id` (if present) or by name+address fuzzy match
2. If match found: compute field-level diff and store in `import_diff`
3. If no match: mark as `NEW`
4. If existing record has no match in import: flag as potential deletion (requires explicit confirmation)

---

## Error Reporting

Import errors are returned as a structured report:

```json
{
  "batchId": "uuid",
  "totalRows": 150,
  "validRows": 142,
  "errors": [
    {
      "row": 23,
      "file": "services.csv",
      "field": "status",
      "value": "open",
      "error": "Invalid status value. Expected: active|inactive|defunct"
    }
  ],
  "warnings": [
    {
      "row": 45,
      "file": "locations.csv",
      "field": "latitude",
      "message": "Missing latitude/longitude — record will not appear in map view"
    }
  ]
}
```

---

## Importer Usage

```bash
# Run HSDS CSV importer
npx ts-node db/import/hsds-csv-importer.ts \
  --dir ./import-batch-2024-01 \
  --batch-id my-batch-001 \
  --dry-run

# With actual write
npx ts-node db/import/hsds-csv-importer.ts \
  --dir ./import-batch-2024-01 \
  --batch-id my-batch-001
```
