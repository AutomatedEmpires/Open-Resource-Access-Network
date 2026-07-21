#!/usr/bin/env node
/**
 * ORAN legacy resource-file validator (writes disabled).
 *
 * This script previously wrote normalized records directly into ORAN's live
 * HSDS tables. That bypasses the canonical source registration, rights,
 * provenance, staging, review, and publication controls, so direct persistence
 * is deliberately quarantined. Keep this script only for local NDJSON and SQL
 * generation validation while legacy source adapters are migrated.
 *
 * Input: NDJSON (one normalized resource per line). Each record:
 *   {
 *     source, sourceId, authorityClass,
 *     org: { name, description?, url?, email? },
 *     service: { name, description?, url?, category },   // category = ORAN taxonomy slug
 *     location: { name?, lat, lon },
 *     address: { address1, city, state, zip?, country? },
 *     phones: [ { number, type? } ],
 *     verification: number   // 0-100, per source authority (imported, not human-verified)
 *   }
 *
 * Dry-run validation makes no credential, network, or database access.
 *
 * Usage (validation only):
 *   node seed-resources.mjs --dry-run --file resources.ndjson [--batch 500]
 *
 * For governed ingestion, use `npm run ingest:campaign` and the normal
 * import -> stage -> review -> publish workflow.
 */

import { createReadStream, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import crypto from 'node:crypto';

// ── args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const FILE = getArg('file');
const BATCH = parseInt(getArg('batch', '500'), 10);
const CONC = Math.max(1, parseInt(getArg('concurrency', '1'), 10));
const CONTINUE = args.includes('--continue-on-error');
const DEADLETTER = getArg('deadletter', FILE ? `${FILE}.deadletter` : '/tmp/loader.deadletter');
const DRY = args.includes('--dry-run');
const WRITE_DISABLED_MESSAGE = [
  'Write mode is disabled: this legacy loader bypasses ORAN provenance, rights, review, and publication controls.',
  'Use --dry-run only for local NDJSON validation.',
  'For governed ingestion, use `npm run ingest:campaign` and the canonical import -> stage -> review -> publish workflow.',
].join('\n');

// Fail before checking the input path, reading credentials, or reaching any
// database code. This is the primary quarantine for every legacy write mode.
if (!DRY) {
  console.error(WRITE_DISABLED_MESSAGE);
  process.exit(3);
}
if (!FILE) { console.error('Missing --file <ndjson>'); process.exit(2); }

// ── deterministic UUIDv5 ─────────────────────────────────────
const NS = 'a3f1c2e4-5b6d-4e7f-8a9b-0c1d2e3f4a5b'; // ORAN import namespace
function uuidv5(name) {
  const nsBytes = Buffer.from(NS.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')])).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── SQL value escaping ───────────────────────────────────────
function q(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

// ── taxonomy: ORAN service categories (deterministic terms) ──
const CATEGORY_LABELS = {
  food: 'Food Assistance', housing: 'Housing & Shelter', shelter: 'Emergency Shelter',
  healthcare: 'Healthcare', mental_health: 'Mental Health', substance_use: 'Substance Use Treatment',
  dental: 'Dental Care', utilities: 'Utility Assistance', financial: 'Financial Assistance',
  legal: 'Legal Assistance', employment: 'Employment & Training', education: 'Education',
  childcare: 'Childcare & Family', transportation: 'Transportation', veterans: 'Veterans Services',
  seniors: 'Older Adults', disability: 'Disability Services', immigration: 'Immigration',
  crisis: 'Crisis & Safety', domestic_violence: 'Domestic Violence', clothing: 'Clothing & Goods',
  benefits: 'Benefits Navigation', hotline: 'Hotlines', snap_retailer: 'SNAP/EBT Retailer',
  pharmacy: 'Pharmacy', human_services: 'Human Services',
};
function catId(slug) { return uuidv5(`tax:${slug}`); }

// ── build batched SQL ────────────────────────────────────────
function buildBatchSql(records) {
  const orgs = [], locs = [], svcs = [], sals = [], addrs = [], phones = [], links = [], confs = [];
  const seenOrg = new Set(), seenLoc = new Set(), seenSvc = new Set(), seenKey = new Set();

  for (const r of records) {
    const key = `${r.source}:${r.sourceId}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    const orgKey = `${r.source}:${r.org.key ?? r.sourceId}`;
    const orgId = uuidv5(`org:${orgKey}`);
    const locId = uuidv5(`loc:${key}`);
    const svcId = uuidv5(`svc:${key}`);
    const importer = `import:${r.source}`;

    if (!seenOrg.has(orgId)) {
      seenOrg.add(orgId);
      orgs.push(`(${q(orgId)}, ${q(r.org.name)}, ${q(r.org.description)}, ${q(r.org.url)}, ${q(r.org.email)}, 'active', ${q(orgKey)}, ${q(importer)})`);
    }
    if (Number.isFinite(Number(r.location?.lat)) && Number.isFinite(Number(r.location?.lon)) && !seenLoc.has(locId)) {
      seenLoc.add(locId);
      locs.push(`(${q(locId)}, ${q(orgId)}, ${q(r.location.name || r.org.name)}, ${num(r.location.lat)}, ${num(r.location.lon)}, 'active', ${q(importer)})`);
      if (r.address?.address1) {
        addrs.push(`(${q(uuidv5(`addr:${key}`))}, ${q(locId)}, ${q(r.address.address1)}, ${q(r.address.city)}, ${q(r.address.state)}, ${q(r.address.zip)}, ${q(r.address.country || 'US')})`);
      }
    }
    if (!seenSvc.has(svcId)) {
      seenSvc.add(svcId);
      svcs.push(`(${q(svcId)}, ${q(orgId)}, ${q(r.service.name)}, ${q(r.service.description)}, ${q(r.service.url)}, 'active', ${q(importer)})`);
      const ver = Math.max(0, Math.min(100, Number(r.verification ?? 60)));
      const elig = 50, constr = 50;
      const score = Math.round((0.45 * ver + 0.40 * elig + 0.15 * constr) * 100) / 100;
      confs.push(`(${q(uuidv5(`cs:${key}`))}, ${q(svcId)}, ${score}, ${ver}, ${elig}, ${constr})`);
      if (r.service.category && CATEGORY_LABELS[r.service.category]) {
        links.push(`(${q(uuidv5(`stx:${key}:${r.service.category}`))}, ${q(svcId)}, ${q(catId(r.service.category))})`);
      }
    }
    if (Number.isFinite(Number(r.location?.lat))) {
      sals.push(`(${q(uuidv5(`sal:${key}`))}, ${q(svcId)}, ${q(locId)})`);
    }
    for (let i = 0; i < (r.phones || []).length; i++) {
      const p = r.phones[i];
      if (!p?.number) continue;
      phones.push(`(${q(uuidv5(`ph:${key}:${i}`))}, ${q(svcId)}, ${q(orgId)}, ${q(String(p.number))}, ${q(['voice','fax','tty','hotline','sms'].includes(p.type) ? p.type : 'voice')})`);
    }
  }

  const stmts = [];
  if (orgs.length) stmts.push(`INSERT INTO organizations (id,name,description,url,email,status,uri,created_by_user_id) VALUES ${orgs.join(',')} ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=COALESCE(EXCLUDED.description,organizations.description), url=COALESCE(EXCLUDED.url,organizations.url), status='active', updated_at=now();`);
  if (locs.length) stmts.push(`INSERT INTO locations (id,organization_id,name,latitude,longitude,status,created_by_user_id) VALUES ${locs.join(',')} ON CONFLICT (id) DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, status='active', updated_at=now();`);
  if (addrs.length) stmts.push(`INSERT INTO addresses (id,location_id,address_1,city,state_province,postal_code,country) VALUES ${addrs.join(',')} ON CONFLICT (id) DO UPDATE SET address_1=EXCLUDED.address_1, city=EXCLUDED.city, state_province=EXCLUDED.state_province, postal_code=EXCLUDED.postal_code;`);
  if (svcs.length) stmts.push(`INSERT INTO services (id,organization_id,name,description,url,status,created_by_user_id) VALUES ${svcs.join(',')} ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=COALESCE(EXCLUDED.description,services.description), status='active', updated_at=now();`);
  if (sals.length) stmts.push(`INSERT INTO service_at_location (id,service_id,location_id) VALUES ${sals.join(',')} ON CONFLICT (service_id,location_id) DO NOTHING;`);
  if (phones.length) stmts.push(`INSERT INTO phones (id,service_id,organization_id,number,type) VALUES ${phones.join(',')} ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number;`);
  if (links.length) stmts.push(`INSERT INTO service_taxonomy (id,service_id,taxonomy_term_id) VALUES ${links.join(',')} ON CONFLICT (service_id,taxonomy_term_id) DO NOTHING;`);
  if (confs.length) stmts.push(`INSERT INTO confidence_scores (id,service_id,score,verification_confidence,eligibility_match,constraint_fit) VALUES ${confs.join(',')} ON CONFLICT (service_id) DO UPDATE SET score=EXCLUDED.score, verification_confidence=EXCLUDED.verification_confidence;`);
  return stmts.join('\n');
}

function taxonomySeedSql() {
  const rows = Object.entries(CATEGORY_LABELS).map(([slug, label]) =>
    `(${q(catId(slug))}, ${q(label)}, ${q('oran-core')})`);
  return `INSERT INTO taxonomy_terms (id,term,taxonomy) VALUES ${rows.join(',')} ON CONFLICT (id) DO NOTHING;`;
}

// Validation-only SQL sink; no credentials, network, or database access.
async function applySql(_sql) {
  // Defense in depth: even if the CLI guard is moved during later refactoring,
  // this legacy script contains no credential, network, or database write path.
  if (!DRY) throw new Error(WRITE_DISABLED_MESSAGE);
  return { ok: true, dry: true };
}

// Retained for compatibility with the existing batching flow. The validation
// sink above cannot perform or retry network/database operations.
async function applyWithRetry(sql) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await applySql(sql); }
    catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const transient = /HTTP (429|5\d\d)/.test(msg) || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|aborted|AbortError|timeout/i.test(msg);
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt)));
    }
  }
  throw lastErr;
}

// ── main (streaming; bounded concurrency; scales to millions) ─
console.log(`Validating ${FILE} locally (batch ${BATCH}, concurrency ${CONC}${CONTINUE ? ', continue-on-error' : ''}, DRY-RUN)`);
await applyWithRetry(taxonomySeedSql());
console.log('Validated taxonomy SQL generation.');

let done = 0, failed = 0, batchNo = 0;
const inflight = new Set();
const t0 = Date.now();

async function flush(batch) {
  const sql = buildBatchSql(batch);
  if (!sql.trim()) { done += batch.length; return; }
  try {
    await applyWithRetry(sql);
    done += batch.length;
  } catch (e) {
    if (!CONTINUE) throw e;
    failed += batch.length;
    appendFileSync(DEADLETTER, batch.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.error(`  BATCH FAILED (dead-lettered ${batch.length}): ${String(e?.message).slice(0, 200)}`);
  }
  if (++batchNo % 10 === 0) {
    const rate = Math.round((done + failed) / ((Date.now() - t0) / 1000));
    console.log(`  ${done} done${failed ? `, ${failed} failed` : ''} (~${rate}/s)`);
  }
}

function schedule(batch) {
  const p = flush(batch).finally(() => inflight.delete(p));
  inflight.add(p);
  return inflight.size >= CONC ? Promise.race(inflight) : Promise.resolve();
}

const rl = createInterface({ input: createReadStream(FILE, { encoding: 'utf8' }), crlfDelay: Infinity });
let batch = [];
for await (const line of rl) {
  const t = line.trim();
  if (!t) continue;
  let rec; try { rec = JSON.parse(t); } catch { continue; }
  batch.push(rec);
  if (batch.length >= BATCH) { const b = batch; batch = []; await schedule(b); }
}
if (batch.length) await schedule(batch);
await Promise.all(inflight);
console.log(`Done. Validated ${done} resources${failed ? `, ${failed} failed (see ${DEADLETTER})` : ''}. No data was written.`);
