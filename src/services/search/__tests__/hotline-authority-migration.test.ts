import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0065_verified_hotline_authority.sql'),
  'utf8',
);

const sourceAssertionMigration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0032_source_assertion_layer.sql'),
  'utf8',
);

const validator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-hotline-authority.sql'),
  'utf8',
);

const serviceIds = [
  '1355b206-24da-5bbb-948a-16a939c3de5b',
  'bf5a6ba7-67ee-539b-a554-b1d7f7e8ef22',
  '8828ed73-6472-5bec-9d6d-ed74579cb35c',
  '76a1ccc2-9165-5e0f-940f-f2efa83bdfbf',
  'ab44a7da-b39b-5c07-9d9e-db70972e17ea',
  '9933c0c9-c012-5c1d-a4e7-16cf723463f9',
  'a222dd85-8307-5ef2-943f-4ff7a31c0ae6',
  '94eea25b-24ff-5175-9ecd-611e49ac4520',
  'db7d4ab7-5675-523c-8fa2-bec66cb690ea',
  'f79323a0-4e03-5157-abde-812dd695060f',
  '69e2a459-2ba2-5265-b5f9-31225afc371f',
  'dac3faaf-f024-5c58-ba7b-2d0840c845c7',
  'c11a0cf7-37e6-505f-9cc9-937605e58b0d',
] as const;

const organizationIds = [
  '109c02a7-98a7-5928-b42b-0b788884ea10',
  '81fd963c-757d-57f8-84a0-6484a202ec22',
  '528716ea-a619-512a-87fb-87ef78085a47',
  '7ae3c667-0f69-5f8b-82cf-cbfc8f6ded68',
  'a64811be-1963-53d6-b3dc-0aac151cb348',
  'be79808c-65bd-557d-a07d-683162115ef9',
  'e777ac21-7c0e-5c69-89a7-83c9f4c12dc9',
  'c378fc86-de1c-5396-ba8e-58d9189f9d22',
  '57d114e7-c271-5584-a064-0c057c9a51e4',
  'ec7e66e9-079f-57e2-969d-fda6b6d0650b',
  '60fd3d69-1a46-53c6-9ce4-72eb1693b8f1',
  '934be974-0ba6-552b-bcd3-8a87ebb7203a',
  'f609181b-9ebf-5f42-a38d-a204d472fd84',
] as const;

const originalPhoneIds = [
  'ab20e706-8b94-5db0-b833-abab6a8eed0f',
  'f02c6333-f378-5d2f-9186-4ed5dee633c5',
  'ddcc8ae0-ae6a-5874-b69a-5a8d8bdd5b1d',
  'ded61f32-3529-5e81-8de4-ec1a2b5a26e3',
  'd4ca2ec9-3e3c-5a6d-b7c1-011bf5a0ccfc',
  'e4854265-c37e-546f-b8f1-e1dd4bafe057',
  'ca598312-d21c-5e28-9ac2-778e4acfb89f',
  '400d07d5-d204-5595-a63d-30edda97b352',
  'c23c6c74-1256-589b-bef5-2eb64b55e5bc',
  'e0b31dc9-32e9-54a0-8745-3d15a22fe6f2',
  '621eb7eb-a9c2-52af-bb58-bda404f431e5',
  '6174e603-c889-5e38-a2f1-b66d6173b939',
  'd682a70c-40fe-5e0d-95d2-e44f3df8783f',
  '50a5dfe7-02b3-5dc6-a8db-3b6efad33e6a',
  '0b6d2691-3e7c-5c8d-84f7-8bec39d7f780',
  'e83a4ef4-9e6f-5d54-af96-4a9572019466',
  '70e45f9e-b301-5108-a130-0caba87bdf11',
  '226bda9a-012f-5d41-9d99-e688a703d694',
  'ccf8759f-03bd-506e-9a7d-d58b53c8a5a7',
  '4db661bf-8981-5530-b0b7-068bf87d23ea',
  '8e6fc496-2b10-5057-a884-0e18eeba22ec',
  '27d2e362-88dc-5c42-bc15-c0121eb3b478',
  'c641d307-4a8f-57c7-8fdc-01d40a90b900',
] as const;

describe('0065 verified hotline authority migration', () => {
  it('targets only the 13 audited live service and organization IDs', () => {
    expect(serviceIds).toHaveLength(13);
    expect(new Set(serviceIds).size).toBe(13);
    expect(organizationIds).toHaveLength(13);
    expect(new Set(organizationIds).size).toBe(13);

    for (const id of [...serviceIds, ...organizationIds]) {
      expect(migration).toContain(id);
    }

    expect(migration).toContain("s.created_by_user_id = 'import:hotline'");
    expect(migration).toContain('expected exactly 13 total import:hotline services');
    expect(migration).toContain('hotline service/organization fact drift');
    expect(migration).not.toContain('ON CONFLICT DO NOTHING');
  });

  it('uses literal UUIDs only for audited live rows, never generated authority rows', () => {
    const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
    const literalIds = [...new Set(migration.match(uuidPattern) ?? [])].sort();
    const auditedIds = [...serviceIds, ...organizationIds, ...originalPhoneIds].sort();

    expect(literalIds).toEqual(auditedIds);
    expect(migration).toContain('id uuid PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(migration).toContain('INSERT INTO public.source_systems (\n    name,');
    expect(migration).toContain('INSERT INTO public.source_records (\n    source_feed_id,');
    expect(migration).toContain('INSERT INTO public.canonical_organizations (\n    name,');
  });

  it('stages a complete inactive path before the atomic activation block', () => {
    const sourceInsert = migration.indexOf('INSERT INTO public.source_systems');
    const feedInsert = migration.indexOf('INSERT INTO public.source_feeds');
    const activation = migration.indexOf('-- Atomic authority activation.');
    const sourceActivation = migration.indexOf('UPDATE public.source_systems ss', activation);

    expect(sourceInsert).toBeGreaterThan(0);
    expect(feedInsert).toBeGreaterThan(sourceInsert);
    expect(activation).toBeGreaterThan(feedInsert);
    expect(sourceActivation).toBeGreaterThan(activation);
    expect(migration.slice(sourceInsert, activation)).toContain("'draft'");
    expect(migration.slice(sourceInsert, activation)).toContain("'unpublished'");
    expect(migration.slice(sourceInsert, activation)).toContain('false');
    expect(migration).toContain("sr.processing_status = 'normalized'");
    expect(migration).toContain("cp.decision_status = 'candidate'");
    expect(migration).toContain('hotline staging safety drift');
    expect(sourceAssertionMigration).toContain("'arcgis', 'scrape_seed', 'manual_entry'");
    expect(migration).toContain("'scrape_seed'");
    expect(migration).toContain("'none'");
    expect(migration).toContain('SET is_active = true');
  });

  it('records primary-source corrections and quarantines the unverified NDVH TTY', () => {
    expect(migration).toContain('substance use distress');
    expect(migration).toContain('Spanish-language and Deaf/Hard-of-Hearing support');
    expect(migration).toContain('Operated by Compass Connections.');
    expect(migration).toContain('help@humantraffickinghotline.org');
    expect(migration).toContain("('nhth-tty-711', 'nhth', 'tty', '711'");
    expect(migration).toContain("('rainn-sms', 'rainn', 'sms', '64673'");
    expect(migration).toContain("('samhsa-sms', 'samhsa', 'sms', '435748'");
    expect(migration).toContain('oran_internal.hotline_quarantined_contacts');
    expect(migration).toContain('400d07d5-d204-5595-a63d-30edda97b352');
    expect(migration).toContain('DELETE FROM public.phones p');
    expect(migration).not.toContain('855-812-1001');
  });

  it('makes assertions immutable and validates the positive authority path', () => {
    const triggerFunction = migration.slice(
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION oran_internal.protect_verified_hotline_source_records()',
      ),
      migration.indexOf(
        'REVOKE ALL ON FUNCTION oran_internal.hotline_service_snapshot(uuid)',
      ),
    );

    expect(migration).toContain('pg_catalog.sha256');
    expect(migration).toContain('payload_sha256 IS DISTINCT FROM');
    expect(migration).toContain('trg_protect_verified_hotline_source_records');
    expect(migration).toContain('append a superseding assertion instead');
    expect(triggerFunction).toContain('oran_internal.hotline_authority_members');
    expect(triggerFunction).toContain('m.source_record_id = OLD.id');
    expect(triggerFunction).not.toContain('OLD.correlation_id');
    expect(migration).toContain(
      'DROP TRIGGER IF EXISTS trg_protect_verified_hotline_source_records',
    );
    expect(migration).toContain('t.tgtype = 27');
    expect(migration).toContain('t.tgenabled = \'O\'');
    expect(migration).toContain('t.tgnargs = 0');
    expect(migration).toContain('t.tgqual IS NULL');
    expect(migration).toContain('t.tgparentid = 0');
    expect(validator).toContain('t.tgfoid =');
    expect(validator).toContain('t.tgtype = 27');
    expect(migration).toContain("cp.decision_status = 'accepted'");
    expect(migration).toContain('accepted-provenance drift: expected 92');
    expect(migration).toContain('authority count drift: expected 13');
    expect(migration).toContain('RETURN oran_internal.assert_verified_hotline_authority');
  });

  it('ships drift-tolerant idempotent containment and a read-only validator', () => {
    const deactivation = migration.slice(
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION oran_internal.deactivate_verified_hotline_authority()',
      ),
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION oran_internal.protect_verified_hotline_source_records()',
      ),
    );

    expect(migration).toContain('deactivate_verified_hotline_authority');
    expect(deactivation).not.toContain('assert_verified_hotline_authority');
    expect(deactivation).not.toMatch(/IF v_updates <> \d+/);
    expect(deactivation).toContain("SET publication_status = 'retracted'");
    expect(deactivation).toContain('sf.is_active IS DISTINCT FROM false');
    expect(deactivation).toContain('ss.is_active IS DISTINCT FROM false');
    expect(deactivation).toContain('hotline containment failed');
    expect(deactivation).toContain("'previousStatus', v_status");
    expect(deactivation).toContain('deactivated_at = COALESCE(b.deactivated_at, v_now)');
    expect(migration).toContain("deactivated hotline authority still publishes");
    expect(migration).toContain("'authorizedServices', v_authorized");
    expect(migration).toContain("RETURN oran_internal.assert_verified_hotline_authority('applied')");

    expect(validator).toContain('BEGIN TRANSACTION READ ONLY;');
    expect(validator).toContain("assert_verified_hotline_authority('applied')");
    expect(validator).toContain('ROLLBACK;');
    expect(validator).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  });
});
