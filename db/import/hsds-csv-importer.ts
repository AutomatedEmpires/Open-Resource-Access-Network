/**
 * ORAN HSDS CSV Importer
 *
 * Imports Human Services Data Specification (HSDS) formatted CSV files
 * into ORAN's staging tables for admin review before publishing.
 *
 * Usage:
 *   npx ts-node db/import/hsds-csv-importer.ts --dir ./my-import [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import readline from 'readline';
import { z } from 'zod';

// ============================================================
// RAW CSV ROW TYPES
// ============================================================

export interface RawOrganizationRow {
  id?: string;
  name: string;
  description?: string;
  url?: string;
  email?: string;
  tax_status?: string;
  tax_id?: string;
  year_incorporated?: string;
  legal_status?: string;
  logo_url?: string;
  uri?: string;
}

export interface RawLocationRow {
  id?: string;
  organization_id: string;
  name?: string;
  alternate_name?: string;
  description?: string;
  transportation?: string;
  latitude?: string;
  longitude?: string;
}

export interface RawServiceRow {
  id?: string;
  organization_id: string;
  program_id?: string;
  name: string;
  alternate_name?: string;
  description?: string;
  url?: string;
  email?: string;
  status?: string;
  interpretation_services?: string;
  application_process?: string;
  wait_time?: string;
  fees?: string;
  accreditations?: string;
  licenses?: string;
}

export interface RawServiceAtLocationRow {
  id?: string;
  service_id: string;
  location_id: string;
  description?: string;
}

export interface RawPhoneRow {
  id?: string;
  location_id?: string;
  service_id?: string;
  organization_id?: string;
  number: string;
  extension?: string;
  type?: string;
  language?: string;
  description?: string;
}

export interface RawAddressRow {
  id?: string;
  location_id: string;
  attention?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  region?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
}

export interface RawScheduleRow {
  id?: string;
  service_id?: string;
  location_id?: string;
  valid_from?: string;
  valid_to?: string;
  dtstart?: string;
  until?: string;
  wkst?: string;
  days?: string;
  opens_at?: string;
  closes_at?: string;
  description?: string;
}

// ============================================================
// ZOD VALIDATION SCHEMAS
// ============================================================

const urlSchema = z.string().url().optional().or(z.literal(''));
const emailSchema = z.string().email().optional().or(z.literal(''));

export const OrganizationRowSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Organization name is required').max(255),
  description: z.string().optional(),
  url: urlSchema,
  email: emailSchema,
  tax_status: z.string().optional(),
  tax_id: z
    .string()
    .regex(/^\d{2}-\d{7}$/, 'tax_id must be in EIN format XX-XXXXXXX')
    .optional()
    .or(z.literal('')),
  year_incorporated: z
    .string()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().min(1800).max(new Date().getFullYear()).optional()),
  legal_status: z.string().optional(),
  logo_url: urlSchema,
  uri: z.string().optional(),
});

export const LocationRowSchema = z.object({
  id: z.string().uuid().optional(),
  organization_id: z.string().min(1, 'organization_id is required'),
  name: z.string().optional(),
  alternate_name: z.string().optional(),
  description: z.string().optional(),
  transportation: z.string().optional(),
  latitude: z
    .string()
    .transform((v) => (v ? parseFloat(v) : undefined))
    .pipe(z.number().min(-90).max(90).optional()),
  longitude: z
    .string()
    .transform((v) => (v ? parseFloat(v) : undefined))
    .pipe(z.number().min(-180).max(180).optional()),
});

export const ServiceRowSchema = z.object({
  id: z.string().uuid().optional(),
  organization_id: z.string().min(1, 'organization_id is required'),
  program_id: z.string().optional(),
  name: z.string().min(1, 'Service name is required').max(255),
  alternate_name: z.string().optional(),
  description: z.string().optional(),
  url: urlSchema,
  email: emailSchema,
  status: z.enum(['active', 'inactive', 'defunct']).default('active'),
  interpretation_services: z.string().optional(),
  application_process: z.string().optional(),
  wait_time: z.string().optional(),
  fees: z.string().optional(),
  accreditations: z.string().optional(),
  licenses: z.string().optional(),
});

export const AddressRowSchema = z.object({
  id: z.string().uuid().optional(),
  location_id: z.string().min(1, 'location_id is required'),
  attention: z.string().optional(),
  address_1: z.string().min(1, 'address_1 is required'),
  address_2: z.string().optional(),
  city: z.string().min(1, 'city is required'),
  region: z.string().optional(),
  state_province: z.string().min(1, 'state_province is required'),
  postal_code: z.string().optional(),
  country: z.string().length(2, 'country must be 2-letter ISO code').default('US'),
});

// ============================================================
// IMPORT RESULT TYPES
// ============================================================

export interface ImportError {
  row: number;
  file: string;
  field?: string;
  value?: string;
  error: string;
}

export interface ImportWarning {
  row: number;
  file: string;
  field?: string;
  message: string;
}

export interface ImportReport {
  batchId: string;
  totalRows: number;
  validRows: number;
  errors: ImportError[];
  warnings: ImportWarning[];
  dryRun: boolean;
}

// ============================================================
// CSV PARSING UTILITIES
// ============================================================

async function parseCSV(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  let isFirstLine = true;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const values = parseCSVLine(line);
    if (isFirstLine) {
      headers = values;
      isFirstLine = false;
    } else {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h.trim()] = (values[i] ?? '').trim();
      });
      rows.push(row);
    }
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// VALIDATION FUNCTIONS
// ============================================================

export function validateOrganizationRows(
  rows: Record<string, string>[],
  fileName: string
): { valid: z.infer<typeof OrganizationRowSchema>[]; errors: ImportError[]; warnings: ImportWarning[] } {
  const valid: z.infer<typeof OrganizationRowSchema>[] = [];
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2; // +2 for header row + 1-indexing
    const result = OrganizationRowSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
      if (!row.url) {
        warnings.push({ row: rowNum, file: fileName, field: 'url', message: 'Missing URL — organization will not have a website link' });
      }
    } else {
      result.error.issues.forEach((issue) => {
        errors.push({
          row: rowNum,
          file: fileName,
          field: issue.path.join('.'),
          value: String(row[String(issue.path[0])] ?? ''),
          error: issue.message,
        });
      });
    }
  });

  return { valid, errors, warnings };
}

export function validateServiceRows(
  rows: Record<string, string>[],
  fileName: string
): { valid: z.infer<typeof ServiceRowSchema>[]; errors: ImportError[]; warnings: ImportWarning[] } {
  const valid: z.infer<typeof ServiceRowSchema>[] = [];
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2;
    const result = ServiceRowSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
      if (!row.description) {
        warnings.push({ row: rowNum, file: fileName, field: 'description', message: 'Missing description — will reduce confidence score' });
      }
    } else {
      result.error.issues.forEach((issue) => {
        errors.push({
          row: rowNum,
          file: fileName,
          field: issue.path.join('.'),
          value: String(row[String(issue.path[0])] ?? ''),
          error: issue.message,
        });
      });
    }
  });

  return { valid, errors, warnings };
}

// ============================================================

export interface DiffResult {
  type: 'NEW' | 'UPDATED' | 'UNCHANGED';
  fields: Record<string, { old: unknown; new: unknown }>;
}

export function detectDiff(
  staged: Record<string, unknown>,
  existing: Record<string, unknown>
): DiffResult {
  const changedFields: Record<string, { old: unknown; new: unknown }> = {};

  for (const key of Object.keys(staged)) {
    if (staged[key] !== existing[key]) {
      changedFields[key] = { old: existing[key], new: staged[key] };
    }
  }

  if (Object.keys(changedFields).length === 0) {
    return { type: 'UNCHANGED', fields: {} };
  }

  return { type: 'UPDATED', fields: changedFields };
}

// ============================================================
// MAIN IMPORTER
// ============================================================

interface ImporterOptions {
  dir: string;
  batchId?: string;
  dryRun?: boolean;
}

export async function runImport(options: ImporterOptions): Promise<ImportReport> {
  const { dir, batchId = `batch-${Date.now()}`, dryRun = false } = options;

  const report: ImportReport = {
    batchId,
    totalRows: 0,
    validRows: 0,
    errors: [],
    warnings: [],
    dryRun,
  };

  // Process organizations.csv
  const orgFile = path.join(dir, 'organizations.csv');
  if (fs.existsSync(orgFile)) {
    const rows = await parseCSV(orgFile);
    report.totalRows += rows.length;
    const { valid, errors, warnings } = validateOrganizationRows(rows, 'organizations.csv');
    report.validRows += valid.length;
    report.errors.push(...errors);
    report.warnings.push(...warnings);

    if (!dryRun) {
      // TODO: Insert valid rows into staging table
      console.log(`[IMPORT] Would stage ${valid.length} organizations`);
    }
  }

  // Process services.csv
  const svcFile = path.join(dir, 'services.csv');
  if (fs.existsSync(svcFile)) {
    const rows = await parseCSV(svcFile);
    report.totalRows += rows.length;
    const { valid, errors, warnings } = validateServiceRows(rows, 'services.csv');
    report.validRows += valid.length;
    report.errors.push(...errors);
    report.warnings.push(...warnings);

    if (!dryRun) {
      console.log(`[IMPORT] Would stage ${valid.length} services`);
    }
  }

  if (dryRun) {
    console.log('[DRY RUN] No data was written to the database.');
  }

  console.log(`[IMPORT] Batch: ${batchId}`);
  console.log(`[IMPORT] Total rows: ${report.totalRows}, Valid: ${report.validRows}, Errors: ${report.errors.length}`);

  return report;
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => a.startsWith('--dir='))?.split('=')[1] ?? args[args.indexOf('--dir') + 1];
  const dryRun = args.includes('--dry-run');
  const batchArg = args.find((a) => a.startsWith('--batch-id='))?.split('=')[1];

  if (!dirArg) {
    console.error('Usage: ts-node hsds-csv-importer.ts --dir <path> [--dry-run] [--batch-id <id>]');
    process.exit(1);
  }

  runImport({ dir: dirArg, dryRun, batchId: batchArg })
    .then((report) => {
      if (report.errors.length > 0) {
        console.error('Import completed with errors:', JSON.stringify(report.errors, null, 2));
        process.exit(1);
      }
      console.log('Import completed successfully.');
    })
    .catch((err) => {
      console.error('Import failed:', err);
      process.exit(1);
    });
}
