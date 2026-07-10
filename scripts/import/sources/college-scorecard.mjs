#!/usr/bin/env node
/**
 * US Dept. of Education College Scorecard -> ORAN NDJSON.
 *
 * Source: https://api.data.gov/ed/collegescorecard/v1/schools (federal open data).
 * ~6,300 degree-granting institutions with native lat/lon, cost & aid data. Public
 * community colleges + universities = the "education" resource category (a place to
 * retrain, get aid, finish a degree). Every field is from the federal API.
 *
 * Usage: node scripts/import/sources/college-scorecard.mjs [outFile] [apiKey]
 *   apiKey defaults to DEMO_KEY (works; low rate limit). Free key: https://api.data.gov/signup
 */
import { writeFileSync, appendFileSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/college-scorecard.ndjson';
const KEY = process.argv[3] || 'DEMO_KEY';
const FIELDS = ['id', 'school.name', 'school.city', 'school.state', 'school.zip', 'school.school_url', 'school.ownership', 'location.lat', 'location.lon'].join(',');
const OWNERSHIP = { 1: 'Public', 2: 'Private nonprofit', 3: 'Private for-profit' };

async function page(p) {
  const u = `https://api.data.gov/ed/collegescorecard/v1/schools?api_key=${KEY}&per_page=100&page=${p}&fields=${FIELDS}`;
  for (let a = 0; a < 5; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'ORAN import' } }); if (r.ok) return await r.json(); if (r.status === 429) await new Promise((x) => setTimeout(x, 5000 * (a + 1))); else await new Promise((x) => setTimeout(x, 1500)); } catch { await new Promise((x) => setTimeout(x, 1500)); }
  }
  return null;
}

writeFileSync(OUT, '');
const first = await page(0);
const total = first?.metadata?.total || 0;
const pages = Math.ceil(total / 100);
console.error(`College Scorecard: ${total} institutions, ${pages} pages`);
let n = 0, geoed = 0;
for (let p = 0; p < pages; p++) {
  const j = p === 0 ? first : await page(p);
  const rows = j?.results || [];
  let buf = '';
  for (const r of rows) {
    const name = (r['school.name'] || '').trim();
    if (!name) continue;
    const lat = r['location.lat'], lon = r['location.lon'];
    const own = OWNERSHIP[r['school.ownership']] || '';
    const rec = {
      source: 'college-scorecard', sourceId: String(r.id), authorityClass: 'government_registry',
      org: { name, key: String(r.id), url: (r['school.school_url'] || '').trim() || undefined },
      service: { name: 'College / University', category: 'education', url: (r['school.school_url'] || '').trim() || undefined,
        description: `${own ? own + ' ' : ''}degree-granting institution (US Dept. of Education College Scorecard). Financial aid, cost, and program data available; contact admissions/financial aid to confirm eligibility and programs.` },
      address: { city: (r['school.city'] || '').trim() || undefined, state: (r['school.state'] || '').trim() || undefined, zip: String(r['school.zip'] || '').slice(0, 5) || undefined, country: 'US' },
      phones: [],
      verification: 70,
    };
    if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) { rec.location = { name, lat, lon }; geoed++; }
    buf += JSON.stringify(rec) + '\n'; n++;
  }
  if (buf) appendFileSync(OUT, buf);
  if (p % 10 === 0) console.error(`  page ${p}/${pages} (${n})`);
}
console.error(`College Scorecard: ${n} emitted (${geoed} geolocated) -> ${OUT}`);
