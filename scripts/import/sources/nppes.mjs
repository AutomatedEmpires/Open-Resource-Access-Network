#!/usr/bin/env node
/**
 * CMS NPPES NPI registry -> ORAN NDJSON.
 *
 * Source: CMS NPPES monthly full-replacement file (public domain), ~9.6M providers.
 *   https://download.cms.gov/nppes/NPPES_Data_Dissemination_<Month>_<Year>.zip
 *   main CSV: npidata_pfile_<range>.csv (330 columns).
 *
 * We keep ONLY Entity Type 2 (organizations = facilities) that are ACTIVE and whose
 * primary taxonomy is a genuine safety-net / accessible resource type (pharmacies,
 * FQHCs, community mental health, substance-use treatment, hospitals, clinics, home
 * health, hospice, nursing/long-term care, public-health agencies). Private single-
 * specialty groups, labs, DME suppliers, billing and transport are excluded — a
 * directory of every specialist is not a resource network.
 *
 * NPPES has no coordinates: we geocode to the Census ZCTA ZIP centroid (real Census
 * data, ZIP-level precision, never invented). Nothing here is model-generated —
 * models only defined the taxonomy->category mapping; every fact is from CMS.
 *
 * Usage: node scripts/import/sources/nppes.mjs [csvPath] [outDir] [--shard N]
 * Emits sharded NDJSON to outDir (default /tmp/nppes_shards) for the loader.
 */
import { createReadStream, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const CSV = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '/tmp/npidata_pfile_20050523-20260607.csv';
const OUTDIR = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '/tmp/nppes_shards';
const shardArgI = process.argv.indexOf('--shard');
const SHARD = shardArgI >= 0 ? parseInt(process.argv[shardArgI + 1], 10) : 250000;
const ZIP = JSON.parse(readFileSync('/tmp/zip_centroids.json', 'utf8'));
mkdirSync(OUTDIR, { recursive: true });

// column indices (verified against the June 2026 fileheader)
const NPI = 0, ENTITY = 1, ORGNAME = 4, A1 = 28, A2 = 29, CITY = 30, STATE = 31, ZIPC = 32, PHONE = 34, DEACT = 39, TAX1 = 47;

function parse(line) {
  const out = []; let cur = '', inq = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inq) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += ch; }
    else { if (ch === '"') inq = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur);
  return out;
}

// Title-case an ALLCAPS NPPES name/address for display
function tc(s) {
  if (!s) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Pllc|Pc|Pa|Dds|Md|Do|Np|Ii|Iii|Iv|Va|Us|Ems|Ymca)\b/gi, (m) => m.toUpperCase());
}

// taxonomy_1 -> {category, ver, label} | null (null = excluded)
function classify(code) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null;
  const p = (pre) => c.startsWith(pre);
  if (p('3336')) return { category: 'pharmacy', ver: 70, label: 'Pharmacy' };
  if (c === '283Q00000X') return { category: 'mental_health', ver: 74, label: 'Psychiatric Hospital' };
  if (c === '283X00000X') return { category: 'healthcare', ver: 72, label: 'Rehabilitation Hospital' };
  if (p('282') || p('281') || p('273') || p('275N')) return { category: 'healthcare', ver: 74, label: 'Hospital' };
  if (p('261Q')) {
    if (c === '261QF0400X') return { category: 'healthcare', ver: 82, label: 'Federally Qualified Health Center' };
    if (c === '261QR1300X') return { category: 'healthcare', ver: 80, label: 'Rural Health Clinic' };
    if (c === '261QM2800X') return { category: 'substance_use', ver: 74, label: 'Opioid Treatment / Methadone Clinic' };
    if (c === '261QR0405X') return { category: 'substance_use', ver: 74, label: 'Substance Use Disorder Clinic' };
    if (p('261QM')) return { category: 'mental_health', ver: 72, label: 'Community Mental Health Center' };
    if (c === '261QU0200X') return { category: 'healthcare', ver: 72, label: 'Urgent Care Center' };
    if (c === '261QE0700X') return { category: 'healthcare', ver: 72, label: 'Dialysis Center' };
    if (c === '261QP2300X') return { category: 'healthcare', ver: 74, label: 'Primary Care Clinic' };
    if (p('261QP09')) return { category: 'healthcare', ver: 74, label: 'Public Health Clinic' };
    if (c === '261QD0000X') return { category: 'dental', ver: 70, label: 'Dental Clinic' };
    return { category: 'healthcare', ver: 66, label: 'Clinic / Health Center' };
  }
  if (p('251S')) return { category: 'mental_health', ver: 72, label: 'Community/Behavioral Health Center' };
  if (p('251E')) return { category: 'healthcare', ver: 66, label: 'Home Health Agency' };
  if (c === '251G00000X' || c === '315D00000X') return { category: 'healthcare', ver: 68, label: 'Hospice' };
  if (p('251K')) return { category: 'human_services', ver: 64, label: 'Public Health / Welfare Agency' };
  if (p('251V')) return { category: 'human_services', ver: 62, label: 'Charitable / Community Agency' };
  if (c === '251C00000X' || p('253')) return { category: 'human_services', ver: 62, label: 'Community Service Agency' };
  if (c === '314000000X' || p('313M')) return { category: 'seniors', ver: 66, label: 'Nursing Facility' };
  if (p('3104') || p('3105') || p('311') || p('310')) return { category: 'seniors', ver: 62, label: 'Assisted Living / Care Home' };
  if (p('315P') || p('315X')) return { category: 'disability', ver: 62, label: 'Intermediate Care Facility' };
  if (p('3245') || c === '324500000X') return { category: 'substance_use', ver: 70, label: 'Substance Abuse Treatment Facility' };
  if (c === '320900000X' || c === '322D00000X' || c === '323P00000X') return { category: 'mental_health', ver: 68, label: 'Residential Mental Health Facility' };
  if (c === '320800000X') return { category: 'disability', ver: 62, label: 'Residential Facility' };
  if (p('1223') || p('122')) return { category: 'dental', ver: 62, label: 'Dental Practice' };
  if (c === '193200000X') return { category: 'healthcare', ver: 60, label: 'Multi-Specialty Clinic' };
  if (p('251B')) return { category: 'human_services', ver: 62, label: 'Case Management' };
  if (p('251J')) return { category: 'healthcare', ver: 62, label: 'Nursing / Home Care' };
  // Tier 2 — accessible care providers (scarce, high-need); ranked below facilities
  if (p('101Y') || p('1041') || p('1044') || p('103T') || p('103K') || p('103G')) return { category: 'mental_health', ver: 58, label: 'Mental Health / Counseling Provider' };
  if (p('2084P')) return { category: 'mental_health', ver: 62, label: 'Psychiatry' };
  if (c === '207Q00000X') return { category: 'healthcare', ver: 58, label: 'Family Medicine' };
  if (c === '207R00000X') return { category: 'healthcare', ver: 58, label: 'Internal Medicine' };
  if (p('2080')) return { category: 'healthcare', ver: 58, label: 'Pediatrics' };
  if (c === '208D00000X') return { category: 'healthcare', ver: 58, label: 'General Practice' };
  if (p('207V')) return { category: 'healthcare', ver: 60, label: 'Obstetrics & Gynecology' };
  return null; // labs, DME, transport, single-specialty specialists, therapy-only, optometry, etc.
}

let rows = 0, kept = 0, geoed = 0, shardNo = 0, first = true;
let buf = [];
function flushShard() {
  if (!buf.length) return;
  shardNo++;
  const f = `${OUTDIR}/nppes-${String(shardNo).padStart(4, '0')}.ndjson`;
  writeFileSync(f, buf.join('\n') + '\n');
  console.error(`  wrote ${f} (${buf.length})`);
  buf = [];
}

const rl = createInterface({ input: createReadStream(CSV, { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const line of rl) {
  if (first) { first = false; continue; }
  rows++;
  if (rows % 1000000 === 0) console.error(`  scanned ${rows}, kept ${kept}...`);
  // cheap reject before full parse: entity type 2 appears as ,"2", near start
  const f = parse(line);
  if (f[ENTITY] !== '2') continue;
  if (f[DEACT] && f[DEACT].trim() !== '') continue;
  const cls = classify(f[TAX1]);
  if (!cls) continue;
  const npi = f[NPI].trim();
  const name = tc(f[ORGNAME].trim());
  if (!npi || !name) continue;
  const zip5 = (f[ZIPC] || '').trim().slice(0, 5);
  const cen = ZIP[zip5];
  const rec = {
    source: 'nppes', sourceId: npi, authorityClass: 'government_registry',
    org: { name, key: npi },
    service: { name: cls.label, category: cls.category,
      description: `${cls.label} (CMS NPI ${npi}). Verify current hours, services, and eligibility before visiting.` },
    address: { address1: tc(f[A1].trim()) || undefined, city: tc(f[CITY].trim()) || undefined, state: (f[STATE] || '').trim() || undefined, zip: zip5 || undefined, country: 'US' },
    phones: (f[PHONE] || '').trim() ? [{ number: f[PHONE].trim(), type: 'voice' }] : [],
    verification: cls.ver,
  };
  if (cen) { rec.location = { name, lat: cen[0], lon: cen[1] }; geoed++; }
  buf.push(JSON.stringify(rec));
  kept++;
  if (buf.length >= SHARD) flushShard();
}
flushShard();
console.error(`NPPES: scanned ${rows}, kept ${kept} (${geoed} geocoded, ${kept - geoed} no ZIP centroid), ${shardNo} shards.`);
