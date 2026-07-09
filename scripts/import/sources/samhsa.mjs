#!/usr/bin/env node
/**
 * SAMHSA FindTreatment.gov behavioral-health treatment locator -> ORAN NDJSON.
 *
 * Source: https://findtreatment.gov/locator/exportsAsJson/v2 (SAMHSA, public).
 * Pulls substance-use (sType=SA) and mental-health (sType=MH) treatment facilities
 * nationwide. Native lat/lon, phone, website — authoritative, current (2025 data).
 * Every field is from SAMHSA; nothing invented.
 *
 * Usage: node scripts/import/sources/samhsa.mjs [outFile]
 */
import { writeFileSync, appendFileSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/samhsa.ndjson';
const UA = 'Mozilla/5.0 (ORAN import)';
const TYPES = [
  { t: 'SA', category: 'substance_use', label: 'Substance Use Treatment' },
  { t: 'MH', category: 'mental_health', label: 'Mental Health Treatment' },
];
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function getPage(type, page) {
  const u = `https://findtreatment.gov/locator/exportsAsJson/v2?sAddr=-98.5,39.5&sType=${type}&limitType=none&pageSize=2000&page=${page}`;
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
  }
  return null;
}

writeFileSync(OUT, '');
let total = 0, geoed = 0;
for (const { t, category, label } of TYPES) {
  const first = await getPage(t, 1);
  if (!first) { process.stderr.write(`  ${t}: no data\n`); continue; }
  const pages = first.totalPages || 1;
  process.stderr.write(`  ${t}: ${first.recordCount} records, ${pages} pages\n`);
  for (let p = 1; p <= pages; p++) {
    const j = p === 1 ? first : await getPage(t, p);
    const rows = j?.rows || [];
    let buf = '';
    for (const r of rows) {
      const name = (r.name1 || '').trim();
      if (!name) continue;
      const lat = parseFloat(r.latitude), lon = parseFloat(r.longitude);
      const key = slug(`${name}-${r.street1 || ''}-${r.zip || ''}`);
      const svcDetail = Array.isArray(r.services) ? (r.services.find((s) => s.f2 === 'TC')?.f3 || '') : '';
      const rec = {
        source: 'samhsa', sourceId: `${t}-${key}`, authorityClass: 'government_service',
        org: { name, key, url: r.website || undefined },
        service: { name: label, category, url: r.website || undefined,
          description: `${label} facility (SAMHSA FindTreatment.gov).${svcDetail ? ' ' + svcDetail + '.' : ''} Call to confirm current services, availability, and eligibility.` },
        address: { address1: [r.street1, r.street2].filter(Boolean).join(' ').trim() || undefined, city: (r.city || '').trim() || undefined, state: (r.state || '').trim() || undefined, zip: (r.zip || '').trim().slice(0, 5) || undefined, country: 'US' },
        phones: (r.phone || '').trim() ? [{ number: String(r.phone).trim(), type: 'voice' }] : [],
        verification: 76,
      };
      if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) { rec.location = { name, lat, lon }; geoed++; }
      buf += JSON.stringify(rec) + '\n';
      total++;
    }
    if (buf) appendFileSync(OUT, buf);
    if (p % 2 === 0 || p === pages) process.stderr.write(`  ${t}: page ${p}/${pages} (total ${total})\n`);
  }
}
process.stderr.write(`SAMHSA: ${total} records emitted (${geoed} geolocated) -> ${OUT}\n`);
