#!/usr/bin/env node
/**
 * HRSA Health Center Program — ETL to ORAN normalized NDJSON.
 *
 * Source: HRSA/BPHC "Health Center Service Delivery and Look-Alike Sites" (federal
 * public-domain, updated daily). Every field below comes from the source row —
 * nothing is invented. Writes NDJSON for scripts/import/seed-resources.mjs.
 *
 * Usage: node scripts/import/sources/hrsa.mjs > /tmp/hrsa.ndjson
 */
import { writeSync } from 'node:fs';

const URL = 'https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function col(headers, exact, ...keywords) {
  const norm = headers.map((h) => h.trim().toLowerCase());
  let i = norm.indexOf(exact);
  if (i >= 0) return i;
  return norm.findIndex((h) => keywords.every((k) => h.includes(k)));
}

function cleanUrl(u) {
  if (!u) return undefined;
  const t = u.trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t) || /\.[a-z]{2,}$/i.test(t.split('/')[0])) return `http://${t}`;
  return undefined;
}

const res = await fetch(URL);
if (!res.ok) { console.error(`HRSA fetch HTTP ${res.status}`); process.exit(1); }
const text = await res.text();
const rows = parseCsv(text);
const headers = rows[0];

const iSite = col(headers, 'site name', 'site', 'name');
const iAddr = col(headers, 'site address', 'site', 'address');
const iCity = col(headers, 'site city', 'site', 'city');
const iState = col(headers, 'site state abbreviation', 'site', 'state');
const iZip = col(headers, 'site postal code', 'site', 'postal');
const iPhone = col(headers, 'site telephone number', 'site', 'telephone');
const iWeb = col(headers, 'site web address', 'site', 'web');
const iLat = col(headers, '__none__', 'primary', 'y coordinate');
const iLon = col(headers, '__none__', 'primary', 'x coordinate');
const iOrg = col(headers, 'health center name', 'health center', 'name');
const iOrgNum = col(headers, 'health center number', 'health center', 'number');
const iSiteId = col(headers, 'bphc assigned number', 'bphc', 'assigned');
const iStatus = col(headers, 'site status description', 'site', 'status');
const iType = col(headers, 'health center type description', 'type', 'description');

let out = '', emitted = 0, skipped = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.length < headers.length - 2) { skipped++; continue; }
  const status = (row[iStatus] || '').trim().toLowerCase();
  if (status && status !== 'active') { skipped++; continue; }
  const lat = parseFloat(row[iLat]); const lon = parseFloat(row[iLon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) { skipped++; continue; }
  const siteId = (row[iSiteId] || '').trim();
  const orgNum = (row[iOrgNum] || '').trim();
  const orgName = (row[iOrg] || '').trim();
  const siteName = (row[iSite] || '').trim();
  if (!siteId || !orgName) { skipped++; continue; }
  const isLAL = (row[iType] || '').toLowerCase().includes('look');

  const rec = {
    source: 'hrsa',
    sourceId: siteId,
    authorityClass: 'government_service',
    org: { name: orgName, key: orgNum || orgName, url: cleanUrl(row[iWeb]) },
    service: {
      name: 'Community health center (primary & preventive care)',
      description: `Federally Qualified Health Center${isLAL ? ' Look-Alike' : ''} site operated by ${orgName}. FQHCs provide primary and preventive care on a sliding fee scale regardless of ability to pay. Source: HRSA Health Center Program.`,
      url: cleanUrl(row[iWeb]),
      category: 'healthcare',
    },
    location: { name: siteName || orgName, lat, lon },
    address: {
      address1: (row[iAddr] || '').trim() || undefined,
      city: (row[iCity] || '').trim() || undefined,
      state: (row[iState] || '').trim() || undefined,
      zip: (row[iZip] || '').trim().split('-')[0] || undefined,
      country: 'US',
    },
    phones: (row[iPhone] || '').trim() ? [{ number: (row[iPhone] || '').trim(), type: 'voice' }] : [],
    verification: 80,
  };
  out += JSON.stringify(rec) + '\n';
  emitted++;
  if (out.length > 1_000_000) { writeSync(1, out); out = ''; }
}
if (out) writeSync(1, out);
console.error(`HRSA: ${emitted} active sites emitted, ${skipped} skipped (of ${rows.length - 1} rows). cols: site=${iSite} addr=${iAddr} lat=${iLat} lon=${iLon} org=${iOrg} orgNum=${iOrgNum} status=${iStatus}`);
