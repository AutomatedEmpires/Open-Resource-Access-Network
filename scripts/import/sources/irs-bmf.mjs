#!/usr/bin/env node
/**
 * IRS Exempt Organizations Business Master File (EO BMF) -> ORAN NDJSON.
 *
 * Source: IRS SOI EO BMF regional extracts (public domain):
 *   https://www.irs.gov/pub/irs-soi/eo{1,2,3,4}.csv (+ eo_pr.csv Puerto Rico)
 * ~1.8M tax-exempt orgs; 28 columns. We keep only human-services categories and
 * exclude private foundations (grant-makers, not walk-in services).
 *
 * IMPORTANT (integrity): the BMF certifies tax-exempt STATUS, not service delivery.
 * These are surfaced as lower-trust ORGANIZATION records ("contact to confirm") with
 * ZIP-centroid coordinates (the street is often a PO box). Nothing is invented — every
 * field is from the IRS extract; the ZIP centroid is real Census gazetteer data.
 *
 * Usage: node scripts/import/sources/irs-bmf.mjs [outFile]  (downloads the CSVs itself)
 */
import { createReadStream, createWriteStream, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const OUT = process.argv[2] || '/tmp/irs-bmf.ndjson';
const ZIP = JSON.parse(readFileSync('/tmp/zip_centroids.json', 'utf8'));
const FILES = ['eo1', 'eo2', 'eo3', 'eo4', 'eo_pr'];
const UA = 'Mozilla/5.0 (ORAN import)';

// column indices (0-based; header verified)
const EIN = 0, NAME = 1, ICO = 2, STREET = 3, CITY = 4, STATE = 5, ZIPC = 6, FOUNDATION = 13, STATUS = 16, NTEE = 26;

// NTEE major letter -> ORAN category (+ high-value sub-code overrides)
function classify(ntee) {
  const c = (ntee || '').trim().toUpperCase();
  if (!c) return null;
  const L = c[0];
  if (!'EFKLPI'.includes(L)) return null;
  const sub = c.slice(0, 3);
  // sub-code overrides for the clearest walk-in services
  if (sub === 'K31' || sub === 'K30' || sub === 'K34' || sub === 'K35' || sub === 'K36') return { category: 'food', ver: 58, label: 'Food Bank / Pantry' };
  if (sub === 'L41') return { category: 'shelter', ver: 58, label: 'Homeless Shelter' };
  if (sub === 'P85' || sub === 'L40') return { category: 'shelter', ver: 56, label: 'Homeless Services' };
  if (sub === 'F40' || sub === 'F42') return { category: 'crisis', ver: 58, label: 'Crisis Intervention' };
  if (sub === 'I80' || sub === 'I83') return { category: 'legal', ver: 56, label: 'Legal Aid' };
  const byLetter = {
    E: { category: 'healthcare', ver: 50, label: 'Health Organization' },
    F: { category: 'mental_health', ver: 52, label: 'Mental Health Organization' },
    K: { category: 'food', ver: 54, label: 'Food & Nutrition Organization' },
    L: { category: 'housing', ver: 54, label: 'Housing Organization' },
    P: { category: 'human_services', ver: 52, label: 'Human Services Organization' },
    I: { category: 'legal', ver: 52, label: 'Legal / Victim Services' },
  };
  return byLetter[L];
}

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
function tc(s) { return s ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : s; }

const outStream = createWriteStream(OUT);
let total = 0, kept = 0, geoed = 0;
for (const f of FILES) {
  const local = `/tmp/${f}.csv`;
  if (!existsSync(local)) {
    process.stderr.write(`  downloading ${f}.csv ...\n`);
    const res = await fetch(`https://www.irs.gov/pub/irs-soi/${f}.csv`, { headers: { 'User-Agent': UA } });
    if (!res.ok) { process.stderr.write(`  ${f}: HTTP ${res.status}, skipping\n`); continue; }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(local));
  }
  let first = true;
  const rl = createInterface({ input: createReadStream(local, { encoding: 'latin1' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line.trim()) continue;
    total++;
    const c = parse(line);
    if (c[STATUS]?.trim() !== '01') continue;                 // active exemption only
    const found = (c[FOUNDATION] || '').trim();
    if (found === '02' || found === '03' || found === '04') continue; // drop private foundations (grant-makers)
    const cls = classify(c[NTEE]);
    if (!cls) continue;
    const ein = (c[EIN] || '').trim();
    const name = tc((c[NAME] || '').trim());
    if (!ein || !name) continue;
    const zip5 = (c[ZIPC] || '').trim().slice(0, 5);
    const cen = ZIP[zip5];
    const street = tc((c[STREET] || '').trim());
    const rec = {
      source: 'irs-bmf', sourceId: ein, authorityClass: 'nonprofit_registry',
      org: { name, key: ein },
      service: { name: cls.label, category: cls.category,
        description: `${cls.label} — IRS tax-exempt nonprofit (EIN ${ein}). Listing reflects federal tax-exempt status, not verified services; contact the organization to confirm services, hours, and eligibility.` },
      address: { address1: street || undefined, city: tc((c[CITY] || '').trim()) || undefined, state: (c[STATE] || '').trim() || undefined, zip: zip5 || undefined, country: 'US' },
      phones: [],
      verification: cls.ver,
    };
    if (cen) { rec.location = { name, lat: cen[0], lon: cen[1] }; geoed++; }
    if (!outStream.write(JSON.stringify(rec) + '\n')) await new Promise((r) => outStream.once('drain', r));
    kept++;
  }
  process.stderr.write(`  ${f}: running total kept=${kept}\n`);
}
outStream.end();
process.stderr.write(`IRS BMF: scanned ${total}, kept ${kept} (${geoed} geocoded) -> ${OUT}\n`);
