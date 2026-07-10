#!/usr/bin/env node
/**
 * Local open-data harvester -> ORAN NDJSON.
 *
 * Discovers authoritative LOCAL human-services datasets on the Socrata network
 * (state/city/county .gov open-data portals) via the public Discovery API, then
 * pulls + normalizes each dataset's heterogeneous schema into ORAN records. This is
 * the "local depth" layer — city food-pantry lists, county shelter directories, etc.
 *
 * Accuracy-first: Socrata domains are overwhelmingly official government portals;
 * we still require a name + (address or coordinates) per record, tag provenance per
 * source domain, and assign a moderate trust score. Every field comes from the
 * publisher; the term->category map is the only editorial layer. ArcGIS Hub's noisy
 * long tail is intentionally excluded here (curated separately).
 *
 * Usage: node scripts/import/sources/opendata-harvest.mjs [outFile]
 */
import { writeFileSync, appendFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const OUT = process.argv[2] || '/tmp/opendata.ndjson';
const ZIP = JSON.parse(readFileSync('/tmp/zip_centroids.json', 'utf8'));
const UA = 'Mozilla/5.0 (ORAN civic import; contact jackson@automatedempires.com)';

// curated high-precision resource terms -> ORAN category + verification
const TERMS = [
  ['food pantry', 'food', 60], ['food bank', 'food', 60], ['free meals', 'food', 58], ['soup kitchen', 'food', 60],
  ['homeless shelter', 'shelter', 62], ['emergency shelter', 'shelter', 62], ['warming center', 'crisis', 60], ['cooling center', 'crisis', 60],
  ['senior center', 'seniors', 60], ['community resource', 'human_services', 56], ['social services', 'human_services', 56],
  ['rental assistance', 'housing', 58], ['homeless services', 'shelter', 58], ['community services', 'human_services', 56],
  ['after school program', 'childcare', 56], ['job training', 'employment', 58], ['veterans services', 'veterans', 60],
  ['mental health services', 'mental_health', 56], ['legal aid', 'legal', 58], ['childcare', 'childcare', 56],
];

const first = (o, keys) => { const ks = Object.keys(o); for (const w of keys) { const k = ks.find((x) => x.toLowerCase() === w); if (k && o[k] != null && String(o[k]).trim() !== '') return String(o[k]).trim(); } return undefined; };
const NAME = ['name', 'organization', 'organization_name', 'agency', 'agency_name', 'program', 'program_name', 'site_name', 'sitename', 'facility', 'facility_name', 'resource_name', 'provider', 'provider_name', 'location_name', 'title', 'dba', 'resource', 'service_name'];
const ADDR = ['address', 'street_address', 'address_1', 'address1', 'addr', 'site_address', 'full_address', 'location_address', 'street', 'mailing_address'];
const CITY = ['city', 'city_name', 'town', 'municipality'];
const STATE = ['state', 'state_code', 'st', 'state_abbr'];
const ZIPK = ['zip', 'zip_code', 'zipcode', 'postal_code', 'postal', 'zip5'];
const PHONE = ['phone', 'telephone', 'phone_number', 'contact_phone', 'phone1', 'main_phone'];
const DESC = ['description', 'desc', 'details', 'service_description', 'program_description', 'services', 'notes', 'summary', 'about', 'overview'];
const URLK = ['web_link', 'website', 'url', 'link', 'web', 'webpage', 'more_info', 'website_url', 'weburl'];
const HOURS = ['hours_of_operation', 'hours', 'days_hours', 'operating_hours', 'schedule', 'hours_open'];

function coords(row) {
  // Socrata point/location fields
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v && typeof v === 'object') {
      if (v.latitude && v.longitude) return [parseFloat(v.latitude), parseFloat(v.longitude), v.human_address];
      if (v.coordinates && Array.isArray(v.coordinates)) return [parseFloat(v.coordinates[1]), parseFloat(v.coordinates[0]), null];
    }
  }
  const la = first(row, ['latitude', 'lat', 'y']); const lo = first(row, ['longitude', 'long', 'lon', 'lng', 'x']);
  if (la && lo) return [parseFloat(la), parseFloat(lo), null];
  return [NaN, NaN, null];
}

async function getJson(u, tries = 3) {
  for (let a = 0; a < tries; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (r.ok) return await r.json(); if (r.status === 429) await new Promise((x) => setTimeout(x, 3000)); } catch {}
    await new Promise((x) => setTimeout(x, 1000));
  }
  return null;
}

writeFileSync(OUT, '');
const seenDataset = new Set();
let totalEmitted = 0, totalGeo = 0, datasets = 0;

for (const [term, category, ver] of TERMS) {
  const disc = await getJson(`https://api.us.socrata.com/api/catalog/v1?q=${encodeURIComponent(term)}&only=dataset&limit=60`);
  const results = disc?.results || [];
  for (const d of results) {
    const id = d.resource?.id; const domain = d.metadata?.domain;
    if (!id || !domain || seenDataset.has(`${domain}/${id}`)) continue;
    // authoritative-domain guard: keep gov / official portals
    if (!/\.(gov|us)$|cityof|county|state|\.org$/i.test(domain)) continue;
    seenDataset.add(`${domain}/${id}`);
    const rows = await getJson(`https://${domain}/resource/${id}.json?$limit=5000`);
    if (!Array.isArray(rows) || !rows.length) continue;
    // QUALITY GATE: a real directory has distinct places per row; rosters/events/admin
    // tables repeat the same name. Drop datasets whose distinct-name ratio is low.
    const nameSet = new Set(rows.map((r) => (first(r, NAME) || '').toLowerCase().trim()).filter(Boolean));
    const ratio = nameSet.size / rows.length;
    if (nameSet.size < 5 || ratio < 0.5) { console.error(`  skip [${term}] ${domain}/${id} (roster/ratio ${ratio.toFixed(2)}, ${nameSet.size} names)`); continue; }
    // GATE 2: drop administrative/report exports (grant tracking, program-year rosters, client counts)
    const cols = Object.keys(rows[0] || {}).map((c) => c.toLowerCase());
    const ADMIN = ['reporttype', 'report_type', 'programyear', 'program_year', 'ceid', 'fiscal_year', 'unduplicated_clients', 'dfta_id', 'application_cycle', 'ceapplicationcycle', 'award', 'grant', 'contract_amount'];
    if (cols.some((c) => ADMIN.includes(c))) { console.error(`  skip [${term}] ${domain}/${id} (admin/report export)`); continue; }
    // GATE 3: a real, actionable directory carries contact/description signal for most rows
    const signalFrac = rows.filter((r) => first(r, PHONE) || first(r, URLK) || first(r, DESC)).length / rows.length;
    if (signalFrac < 0.25) { console.error(`  skip [${term}] ${domain}/${id} (thin: contact/desc ${signalFrac.toFixed(2)})`); continue; }
    datasets++;
    let buf = '', kept = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = first(row, NAME);
      if (!name || name.length < 3) continue;
      const [lat, lon, ha] = coords(row);
      const zip5 = (first(row, ZIPK) || ha?.zip || '').toString().slice(0, 5);
      let la = lat, lo = lon;
      if (!(Number.isFinite(la) && Number.isFinite(lo)) && ZIP[zip5]) { [la, lo] = ZIP[zip5]; }
      if (!(Number.isFinite(la) && Number.isFinite(lo))) continue; // require a locatable point
      const addr1 = first(row, ADDR) || ha?.address;
      const realDesc = first(row, DESC);
      const url = first(row, URLK);
      const hours = first(row, HOURS);
      const desc = (realDesc
        ? `${realDesc}${hours ? ` Hours: ${hours}.` : ''} (Source: ${domain}, open government data.)`
        : `Local ${term} listing published by ${domain} (open government data).${hours ? ` Hours: ${hours}.` : ''} Confirm current hours, eligibility, and availability with the provider.`).slice(0, 1000);
      const rec = {
        source: 'opendata', sourceId: `${domain}:${id}:${i}`, authorityClass: 'local_open_data',
        org: { name, key: `${domain}:${id}:${i}`, url: url || undefined },
        service: { name, category, url: url || undefined, description: desc },
        address: { address1: addr1, city: first(row, CITY) || ha?.city, state: first(row, STATE) || ha?.state, zip: zip5 || undefined, country: 'US' },
        phones: first(row, PHONE) ? [{ number: first(row, PHONE), type: 'voice' }] : [],
        verification: ver,
      };
      rec.location = { name, lat: la, lon: lo }; totalGeo++;
      buf += JSON.stringify(rec) + '\n'; kept++; totalEmitted++;
    }
    if (buf) appendFileSync(OUT, buf);
    if (kept) console.error(`  [${term}] ${domain}/${id}: ${kept}`);
  }
}
console.error(`Open-data harvest: ${datasets} datasets, ${totalEmitted} records (${totalGeo} geolocated) -> ${OUT}`);
