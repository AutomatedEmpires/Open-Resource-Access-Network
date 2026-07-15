#!/usr/bin/env node
/**
 * HUD Public Housing Authorities — HUD Resource Locator (ArcGIS), MapServer layer 1.
 * Federal public-domain; real org name + standardized address + phone + lat/lon.
 * Usage: node scripts/import/sources/hud-pha.mjs > /tmp/hud-pha.ndjson
 */
import { writeSync } from 'node:fs';

const BASE = 'https://egis.hud.gov/arcgis/rest/services/hrl/HudResourceLocator/MapServer/1/query';
const PAGE = 1000;

function p(props, ...names) {
  for (const n of names) { const k = Object.keys(props).find((x) => x.toLowerCase() === n.toLowerCase()); if (k && props[k] != null && String(props[k]).trim() !== '') return String(props[k]).trim(); }
  return undefined;
}

let offset = 0, emitted = 0, out = '';
for (;;) {
  const url = `${BASE}?where=1%3D1&outFields=*&f=geojson&resultOffset=${offset}&resultRecordCount=${PAGE}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`HUD PHA HTTP ${res.status} at offset ${offset}`); break; }
  const gj = await res.json();
  const feats = gj.features || [];
  if (feats.length === 0) break;
  for (const f of feats) {
    const pr = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const lon = parseFloat(coords[0]); const lat = parseFloat(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const name = p(pr, 'FORMAL_PARTICIPANT_NAME', 'PARTICIPANT_NAME', 'NAME');
    if (!name) continue;
    const code = p(pr, 'PARTICIPANT_CODE', 'PHA_CODE', 'OBJECTID') || `${name}:${p(pr, 'STD_ZIP5', 'ZIP') || ''}`;
    const prog = p(pr, 'HA_PROGRAM_TYPE', 'PROGRAM_TYPE');
    const phone = p(pr, 'HA_PHN_NUM', 'PHONE');
    const rec = {
      source: 'hud-pha', sourceId: String(code), authorityClass: 'government_service',
      org: { name, key: String(code), email: p(pr, 'HA_EMAIL_ADDR_TEXT', 'EMAIL') },
      service: { name: 'Public Housing Authority', category: 'housing',
        description: `Public Housing Authority${prog ? ` (${prog})` : ''} administering federal rental assistance and public housing. Contact for Housing Choice Vouchers (Section 8), public housing, and waitlists. Source: HUD Resource Locator.` },
      location: { name, lat, lon },
      address: { address1: p(pr, 'STD_ADDR', 'ADDRESS'), city: p(pr, 'STD_CITY', 'CITY'), state: p(pr, 'STD_ST', 'STATE'), zip: p(pr, 'STD_ZIP5', 'ZIP'), country: 'US' },
      phones: phone ? [{ number: phone, type: 'voice' }] : [],
      verification: 80,
    };
    out += JSON.stringify(rec) + '\n'; emitted++;
  }
  if (out.length > 500_000) { writeSync(1, out); out = ''; }
  if (feats.length < PAGE) break;
  offset += PAGE;
}
if (out) writeSync(1, out);
console.error(`HUD PHA: ${emitted} authorities emitted.`);
