#!/usr/bin/env node
/**
 * ACF Office of Head Start — Head Start / Early Head Start service locations.
 * Source: https://s3foa.s3.us-east-1.amazonaws.com/HS_Service_Locations.csv
 * Federal (ACF/OHS), daily-updated, real address+lat/lon+phone. Every field from source.
 * Usage: node scripts/import/sources/headstart.mjs > /tmp/headstart.ndjson
 */
import { writeSync } from 'node:fs';

const URL = 'https://s3foa.s3.us-east-1.amazonaws.com/HS_Service_Locations.csv';

function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const idx = (h, name) => h.map((x) => x.trim().toLowerCase()).indexOf(name);
function deslug(s) {
  if (!s) return s;
  let t = s.replace(/^\d+_/, '').replace(/_[a-z]{2}$/i, '').replace(/_/g, ' ').trim();
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0 (ORAN import)' } });
if (!res.ok) { console.error(`Head Start fetch HTTP ${res.status}`); process.exit(1); }
const rows = parseCsv(await res.text());
const h = rows[0];
const c = {
  grant: idx(h, 'grant_number'), ptype: idx(h, 'program_type'), org: idx(h, 'recipient_name'),
  site: idx(h, 'service_location_name'), a1: idx(h, 'address_line_one'), a2: idx(h, 'address_line_two'),
  city: idx(h, 'city'), state: idx(h, 'state'), zip: idx(h, 'zip'), zip4: idx(h, 'zip_4'),
  lat: idx(h, 'latitude'), lon: idx(h, 'longitude'), status: idx(h, 'status'),
  sphone: idx(h, 'service_location_phone_number'), rphone: idx(h, 'registration_phone_number'),
};

let out = '', emitted = 0, skipped = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r]; if (!row || row.length < h.length - 2) { skipped++; continue; }
  if ((row[c.status] || '').trim().toLowerCase() !== 'open') { skipped++; continue; }
  const lat = parseFloat(row[c.lat]); const lon = parseFloat(row[c.lon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) { skipped++; continue; }
  const orgName = deslug((row[c.org] || '').trim());
  const site = (row[c.site] || '').trim();
  const grant = (row[c.grant] || '').trim();
  if (!orgName || !grant) { skipped++; continue; }
  const ptype = (row[c.ptype] || '').trim();
  const z4 = (row[c.zip4] || '').trim();
  const zip = (row[c.zip] || '').trim() + (z4 && z4 !== '-1' ? '' : '');
  const phones = [];
  if ((row[c.sphone] || '').trim()) phones.push({ number: (row[c.sphone] || '').trim(), type: 'voice' });
  if ((row[c.rphone] || '').trim() && row[c.rphone] !== row[c.sphone]) phones.push({ number: (row[c.rphone] || '').trim(), type: 'intake' });
  const rec = {
    source: 'headstart', sourceId: `${grant}:${site || row[c.a1]}`.slice(0, 120), authorityClass: 'government_service',
    org: { name: orgName, key: grant, description: 'Head Start grantee (ACF Office of Head Start).' },
    service: {
      name: ptype && /early/i.test(ptype) ? 'Early Head Start (free early childhood care & education)' : 'Head Start (free early childhood education & child care)',
      description: `Free ${/early/i.test(ptype) ? 'Early Head Start (birth–3)' : 'Head Start (ages 3–5)'} early-childhood program for income-eligible families, operated by ${orgName}. Source: HHS ACF Office of Head Start.`,
      category: 'childcare',
    },
    location: { name: site || orgName, lat, lon },
    address: { address1: (row[c.a1] || '').trim() || undefined, city: (row[c.city] || '').trim() || undefined, state: (row[c.state] || '').trim() || undefined, zip: zip || undefined, country: 'US' },
    phones, verification: 80,
  };
  out += JSON.stringify(rec) + '\n'; emitted++;
  if (out.length > 1_000_000) { writeSync(1, out); out = ''; }
}
if (out) writeSync(1, out);
console.error(`Head Start: ${emitted} open sites, ${skipped} skipped (of ${rows.length - 1}).`);
