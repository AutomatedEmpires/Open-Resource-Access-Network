#!/usr/bin/env node
/**
 * HUD-Approved Housing Counseling Agencies — HUD Housing Counselor JSON API.
 * Loops over states/territories; real service address + lat/lon + phone.
 * Source: http://data.hud.gov/Housing_Counselor/search?State={ST}  (federal public domain)
 * Usage: node scripts/import/sources/hud-hca.mjs > /tmp/hud-hca.ndjson
 */
import { writeSync } from 'node:fs';

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','VI','GU','AS','MP'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const g = (o, ...keys) => { for (const k of keys) { const kk = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase()); if (kk && o[kk] != null && String(o[kk]).trim() !== '') return String(o[kk]).trim(); } return undefined; };

let out = '', emitted = 0; const seen = new Set();
for (const st of STATES) {
  let arr = null;
  for (let attempt = 0; attempt < 3 && !arr; attempt++) {
    try {
      const res = await fetch(`http://data.hud.gov/Housing_Counselor/search?State=${st}`, { headers: { 'User-Agent': 'Mozilla/5.0 (ORAN import)' } });
      if (res.ok) arr = await res.json();
      else await sleep(800);
    } catch { await sleep(800); }
  }
  if (!Array.isArray(arr)) { console.error(`  ${st}: no data`); continue; }
  let n = 0;
  for (const a of arr) {
    const agcid = g(a, 'agcid', 'agc_id');
    if (!agcid || seen.has(agcid)) continue;
    seen.add(agcid);
    const lat = parseFloat(g(a, 'agc_ADDR_LATITUDE', 'latitude') || 'NaN');
    const lon = parseFloat(g(a, 'agc_ADDR_LONGITUDE', 'longitude') || 'NaN');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const name = g(a, 'nme', 'agcname', 'name');
    if (!name) continue;
    const rec = {
      source: 'hud-hca', sourceId: agcid, authorityClass: 'government_service',
      org: { name, key: agcid, url: g(a, 'weburl', 'website'), email: g(a, 'email') },
      service: { name: 'HUD-Approved Housing Counseling', category: 'housing',
        description: 'Free or low-cost HUD-approved counseling on renting, buying, foreclosure prevention, reverse mortgages, and homelessness. Source: HUD.' },
      location: { name, lat, lon },
      address: { address1: [g(a, 'adr1'), g(a, 'adr2')].filter(Boolean).join(' ') || undefined, city: g(a, 'city'), state: g(a, 'statecd', 'state'), zip: g(a, 'zipcd', 'zip'), country: 'US' },
      phones: g(a, 'phone1', 'phone') ? [{ number: g(a, 'phone1', 'phone'), type: 'voice' }] : [],
      verification: 78,
    };
    out += JSON.stringify(rec) + '\n'; emitted++; n++;
  }
  console.error(`  ${st}: ${n}`);
  await sleep(200);
}
writeSync(1, out);
console.error(`HUD Housing Counseling: ${emitted} agencies emitted.`);
