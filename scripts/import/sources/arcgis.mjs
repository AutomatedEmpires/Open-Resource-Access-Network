#!/usr/bin/env node
/**
 * Generic ArcGIS Feature/Map-Server -> ORAN NDJSON puller.
 *
 * Paginates any ArcGIS REST layer as GeoJSON (native lat/lon, no geocoding), maps
 * common attribute names to ORAN's normalized record, and emits NDJSON. Reused for
 * every authoritative ArcGIS layer (NCES schools, USDA summer-meal sites, HUD housing
 * counseling, etc.). Every field comes from the source layer — nothing invented.
 *
 * Usage:
 *   node arcgis.mjs --url <.../FeatureServer/0> --source <key> --category <cat> --ver <n> \
 *        [--label "Service name"] [--name FIELD] [--id FIELD] [--addr FIELD] [--city FIELD] \
 *        [--state FIELD] [--zip FIELD] [--phone FIELD] [--where "1=1"] [--out file] [--inspect]
 */
const args = process.argv.slice(2);
const A = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const BASE = A('url'); const SOURCE = A('source'); const CATEGORY = A('category');
const VER = parseInt(A('ver', '65'), 10); const LABEL = A('label'); const OUT = A('out', `/tmp/${SOURCE}.ndjson`);
const WHERE = A('where', '1=1'); const PAGE = parseInt(A('page', '2000'), 10);
const AUTH = A('authority', 'government_service');
if (!BASE) { console.error('Missing --url'); process.exit(2); }

// field-name candidate lists (case-insensitive), plus optional explicit override
const cand = {
  name: [A('name'), 'NAME', 'FACILITY', 'FACILITYNAME', 'FAC_NAME', 'F_NAME', 'AGENCY', 'AGENCYNAME', 'ORGNAME', 'ORG_NAME', 'SITE_NAME', 'SITENAME', 'PROVIDER', 'NAME1', 'BUSINESS'],
  addr: [A('addr'), 'ADDRESS', 'STREET', 'ADDR', 'ADDRESS1', 'ADDR1', 'SITE_ADDRESS', 'STREETADDRESS', 'LOCADDR', 'FULLADDR'],
  city: [A('city'), 'CITY', 'CITY_NAME', 'PHYSCITY', 'LOCCITY'],
  state: [A('state'), 'STATE', 'STATE_NAME', 'ST', 'STABBR', 'PHYSSTATE', 'STATECD'],
  zip: [A('zip'), 'ZIP', 'ZIPCODE', 'ZIP_CODE', 'POSTAL', 'POSTALCODE', 'PHYSZIP', 'ZIPCD'],
  phone: [A('phone'), 'TELEPHONE', 'PHONE', 'PHONE_NUM', 'PHONENUM', 'CONTACT', 'PHONE1', 'TELEPHON'],
  id: [A('id'), 'OBJECTID', 'FID', 'ID', 'GLOBALID'],
};
function pick(props, list) {
  const keys = Object.keys(props);
  for (const want of list) {
    if (!want) continue;
    const k = keys.find((x) => x.toLowerCase() === want.toLowerCase());
    if (k && props[k] != null && String(props[k]).trim() !== '') return String(props[k]).trim();
  }
  return undefined;
}

async function fetchPage(offset) {
  const u = `${BASE}/query?where=${encodeURIComponent(WHERE)}&outFields=*&outSR=4326&f=geojson&resultOffset=${offset}&resultRecordCount=${PAGE}&orderByFields=${encodeURIComponent(cand.id.find(Boolean) || 'OBJECTID')}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (ORAN import)' } });
      if (res.ok) return await res.json();
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } catch { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); }
  }
  return null;
}

import { writeFileSync, appendFileSync } from 'node:fs';

// inspect mode: dump first feature's property keys+values then exit
if (has('inspect')) {
  const j = await fetchPage(0);
  const f = j?.features?.[0];
  console.log('feature count on page:', j?.features?.length);
  console.log('geometry:', JSON.stringify(f?.geometry));
  console.log('properties:', JSON.stringify(f?.properties, null, 1));
  process.exit(0);
}

writeFileSync(OUT, '');
let offset = 0, total = 0, geoed = 0;
for (;;) {
  const j = await fetchPage(offset);
  const feats = j?.features || [];
  if (!feats.length) break;
  let buf = '';
  for (const ft of feats) {
    const p = ft.properties || {};
    let lon, lat;
    if (ft.geometry?.coordinates) { [lon, lat] = ft.geometry.coordinates; }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      lat = parseFloat(pick(p, ['LAT', 'LATITUDE', 'Y', 'YCOORD']) || 'NaN');
      lon = parseFloat(pick(p, ['LON', 'LONG', 'LONGITUDE', 'X', 'XCOORD']) || 'NaN');
    }
    const name = pick(p, cand.name);
    const id = pick(p, cand.id) || `${offset}-${total}`;
    if (!name) continue;
    const rec = {
      source: SOURCE, sourceId: id, authorityClass: AUTH,
      org: { name, key: id },
      service: { name: LABEL || name, category: CATEGORY },
      address: { address1: pick(p, cand.addr), city: pick(p, cand.city), state: pick(p, cand.state), zip: (pick(p, cand.zip) || '').slice(0, 5) || undefined, country: 'US' },
      phones: pick(p, cand.phone) ? [{ number: pick(p, cand.phone), type: 'voice' }] : [],
      verification: VER,
    };
    if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) { rec.location = { name, lat, lon }; geoed++; }
    buf += JSON.stringify(rec) + '\n';
    total++;
  }
  appendFileSync(OUT, buf);
  console.error(`  ${SOURCE}: ${total} (offset ${offset})`);
  if (feats.length < PAGE && !j.exceededTransferLimit) break;
  offset += feats.length;
}
console.error(`${SOURCE}: ${total} records emitted (${geoed} geolocated) -> ${OUT}`);
