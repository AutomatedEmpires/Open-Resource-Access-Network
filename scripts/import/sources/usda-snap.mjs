#!/usr/bin/env node
/**
 * USDA FNS — SNAP Retailer Location Data (currently-authorized SNAP/EBT retailers).
 * ~254k real stores with street address + lat/lon (NO phone). Federal public domain.
 * Clearly categorized as "SNAP/EBT retailer" (where you can SPEND benefits), NOT free food.
 * Source (ArcGIS Hub CSV): datasets/8b260f9a10b0459aa441ad8588c2251c_0
 * Usage: node --max-old-space-size=4096 scripts/import/sources/usda-snap.mjs > /tmp/snap.ndjson
 */
import { writeSync } from 'node:fs';

const URL = 'https://hub.arcgis.com/api/v3/datasets/8b260f9a10b0459aa441ad8588c2251c_0/downloads/data?format=csv&spatialRefId=4326&where=1%3D1';

function parseCsvStream(text, onRow) {
  let row = [], field = '', inQ = false, first = true, header = null;
  const emit = () => {
    row.push(field); field = '';
    if (first) { header = row; first = false; } else onRow(header, row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') emit();
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) emit();
}
const findIdx = (h, ...names) => { const n = h.map((x) => x.trim().toLowerCase()); for (const nm of names) { const i = n.indexOf(nm.toLowerCase()); if (i >= 0) return i; } return -1; };

const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0 (ORAN import)' }, redirect: 'follow' });
if (!res.ok) { console.error(`SNAP fetch HTTP ${res.status}`); process.exit(1); }
const text = await res.text();

let cols = null, out = '', emitted = 0, skipped = 0;
parseCsvStream(text, (h, row) => {
  if (!cols) {
    cols = {
      name: findIdx(h, 'Store_Name', 'store_name'), addr: findIdx(h, 'Store_Street_Address', 'address'),
      addr2: findIdx(h, 'Additonal_Address', 'Additional_Address'), city: findIdx(h, 'City'), state: findIdx(h, 'State'),
      zip: findIdx(h, 'Zip_Code', 'Zip'), zip4: findIdx(h, 'Zip4'), county: findIdx(h, 'County'),
      type: findIdx(h, 'Store_Type'), lat: findIdx(h, 'Latitude'), lon: findIdx(h, 'Longitude'), id: findIdx(h, 'Record_ID', 'ObjectId'),
    };
  }
  const lat = parseFloat(row[cols.lat]); const lon = parseFloat(row[cols.lon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) { skipped++; return; }
  const name = (row[cols.name] || '').trim();
  const id = (row[cols.id] || '').trim() || `${name}:${row[cols.lat]},${row[cols.lon]}`;
  if (!name) { skipped++; return; }
  const stype = (row[cols.type] || '').trim();
  const rec = {
    source: 'usda-snap', sourceId: id, authorityClass: 'government_service',
    org: { name, key: id },
    service: {
      name: 'SNAP/EBT accepted here',
      description: `${stype ? stype + ' — ' : ''}authorized to accept SNAP/EBT benefits. This is a place to SPEND SNAP benefits (not a free-food or food-bank site). Source: USDA FNS SNAP Retailer Locator.`,
      category: 'snap_retailer',
    },
    location: { name, lat, lon },
    address: {
      address1: [(row[cols.addr] || '').trim(), cols.addr2 >= 0 ? (row[cols.addr2] || '').trim() : ''].filter(Boolean).join(' '),
      city: (row[cols.city] || '').trim() || undefined, state: (row[cols.state] || '').trim() || undefined,
      zip: (row[cols.zip] || '').trim() || undefined, country: 'US',
    },
    phones: [], verification: 68,
  };
  out += JSON.stringify(rec) + '\n'; emitted++;
  if (out.length > 2_000_000) { writeSync(1, out); out = ''; }
});
if (out) writeSync(1, out);
console.error(`USDA SNAP: ${emitted} retailers emitted, ${skipped} skipped.`);
