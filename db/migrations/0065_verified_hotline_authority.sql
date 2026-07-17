-- 0065_verified_hotline_authority.sql
--
-- Converts the 13 pre-audited nationwide hotline imports into positive,
-- primary-source publication authority. Activation is deliberately fail-loud:
-- it will not infer targets, overwrite newer edits, or accept ID, contact,
-- count, ownership, or canonical-link drift. Emergency deactivation is instead
-- drift-tolerant and repeatedly asserts independent publication blockers.
--
-- Generated entities use database UUID defaults. The UUID literals below are
-- only the exact live service, organization, and phone IDs captured by the
-- 2026-07-13 audit. Source/canonical/provenance/contact IDs are never invented.
--
-- Emergency authority rollback (facts and the archived stale TTY are retained):
--   SELECT oran_internal.deactivate_verified_hotline_authority();
-- Read-only post-deploy validation:
--   SELECT oran_internal.assert_verified_hotline_authority('applied');

BEGIN;

CREATE SCHEMA IF NOT EXISTS oran_internal;
REVOKE ALL ON SCHEMA oran_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS oran_internal.hotline_authority_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  facts_version text NOT NULL,
  expected_service_count integer NOT NULL CHECK (expected_service_count = 13),
  status text NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'applied', 'deactivated')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  deactivated_at timestamptz,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS oran_internal.hotline_authority_members (
  batch_id uuid NOT NULL
    REFERENCES oran_internal.hotline_authority_batches(id) ON DELETE RESTRICT,
  hotline_slug text NOT NULL,
  service_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_system_id uuid NOT NULL,
  source_feed_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  canonical_organization_id uuid NOT NULL,
  canonical_service_id uuid NOT NULL,
  original_service jsonb NOT NULL,
  applied_service jsonb NOT NULL,
  original_organization jsonb NOT NULL,
  applied_organization jsonb NOT NULL,
  original_phones jsonb NOT NULL,
  applied_phones jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, service_id),
  UNIQUE (batch_id, hotline_slug),
  UNIQUE (batch_id, organization_id),
  UNIQUE (batch_id, source_system_id),
  UNIQUE (batch_id, source_feed_id),
  UNIQUE (batch_id, source_record_id),
  UNIQUE (batch_id, canonical_organization_id),
  UNIQUE (batch_id, canonical_service_id)
);

CREATE TABLE IF NOT EXISTS oran_internal.hotline_quarantined_contacts (
  batch_id uuid NOT NULL
    REFERENCES oran_internal.hotline_authority_batches(id) ON DELETE RESTRICT,
  phone_id uuid NOT NULL,
  service_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  reason text NOT NULL,
  phone_snapshot jsonb NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, phone_id)
);

CREATE TABLE IF NOT EXISTS oran_internal.hotline_authority_added_contacts (
  batch_id uuid NOT NULL
    REFERENCES oran_internal.hotline_authority_batches(id) ON DELETE RESTRICT,
  contact_key text NOT NULL,
  phone_id uuid NOT NULL,
  service_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  phone_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, contact_key),
  UNIQUE (batch_id, phone_id)
);

CREATE INDEX IF NOT EXISTS idx_hotline_authority_members_service
  ON oran_internal.hotline_authority_members (service_id);
CREATE INDEX IF NOT EXISTS idx_hotline_authority_members_organization
  ON oran_internal.hotline_authority_members (organization_id);

REVOKE ALL ON ALL TABLES IN SCHEMA oran_internal FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA oran_internal FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA oran_internal
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA oran_internal
  REVOKE ALL ON SEQUENCES FROM PUBLIC;

CREATE OR REPLACE FUNCTION oran_internal.hotline_service_snapshot(p_service_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'id', s.id,
    'organization_id', s.organization_id,
    'name', s.name,
    'description', s.description,
    'url', s.url,
    'email', s.email,
    'status', s.status,
    'created_by_user_id', s.created_by_user_id,
    'integrity_hold_at', s.integrity_hold_at,
    'integrity_hold_reason', s.integrity_hold_reason,
    'integrity_held_by_user_id', s.integrity_held_by_user_id
  )
  FROM public.services s
  WHERE s.id = p_service_id;
$function$;

CREATE OR REPLACE FUNCTION oran_internal.apply_verified_hotline_authority()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_slug constant text := 'verified-national-hotlines-2026-07-13';
  v_actor constant text := 'system:verified-hotline-authority';
  v_created_at constant timestamptz := timestamptz '2026-07-09 05:18:24.868216+00';
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_batch_id uuid;
  v_status text;
  v_count bigint;
  v_invalid bigint;
  v_updates integer;
  v_summary jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:authority:verified-national-hotlines-2026-07-13', 0)
  );

  SELECT b.id, b.status
  INTO v_batch_id, v_status
  FROM oran_internal.hotline_authority_batches b
  WHERE b.slug = v_slug;

  IF FOUND THEN
    IF v_status = 'applied' THEN
      RETURN oran_internal.assert_verified_hotline_authority('applied');
    END IF;

    RAISE EXCEPTION
      'hotline authority batch % already exists with non-applicable status %',
      v_slug,
      v_status;
  END IF;

  -- Greenfield guard. The 13 target services are loaded by the bulk open-data
  -- import (scripts/import/sources/hotlines.mjs), not by any migration, so a
  -- database that has never run that import has nothing to grant authority to.
  -- Aborting there would make the migration chain unable to rebuild an empty
  -- database at all. Zero rows is "nothing to do"; a PARTIAL set is still drift
  -- and still aborts on the exact-count guard further below.
  SELECT count(*) INTO v_count
  FROM public.services s
  WHERE s.created_by_user_id = 'import:hotline';

  IF v_count = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'slug', v_slug,
      'status', 'skipped_no_hotline_import',
      'detail', 'no import:hotline services present; nothing to grant authority to',
      'checked_at', v_now
    );
  END IF;

  CREATE TEMP TABLE hotline_expected (
    hotline_slug text PRIMARY KEY,
    service_id uuid NOT NULL UNIQUE,
    organization_id uuid NOT NULL UNIQUE,
    organization_uri text NOT NULL UNIQUE,
    service_name text NOT NULL,
    organization_name_original text NOT NULL,
    organization_name_final text NOT NULL,
    service_description_original text NOT NULL,
    service_description_final text NOT NULL,
    organization_description_original text,
    organization_description_final text,
    service_url_original text NOT NULL,
    service_url_final text NOT NULL,
    organization_url_original text NOT NULL,
    organization_url_final text NOT NULL,
    service_email_original text,
    service_email_final text,
    resource_purpose text NOT NULL,
    source_system_name text NOT NULL UNIQUE,
    primary_source_url text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.hotline_expected (
    hotline_slug,
    service_id,
    organization_id,
    organization_uri,
    service_name,
    organization_name_original,
    organization_name_final,
    service_description_original,
    service_description_final,
    organization_description_original,
    organization_description_final,
    service_url_original,
    service_url_final,
    organization_url_original,
    organization_url_final,
    service_email_original,
    service_email_final,
    resource_purpose,
    source_system_name,
    primary_source_url
  )
  VALUES
    (
      '988',
      '1355b206-24da-5bbb-948a-16a939c3de5b',
      '109c02a7-98a7-5928-b42b-0b788884ea10',
      'hotline:988',
      '988 Suicide & Crisis Lifeline',
      '988 Suicide & Crisis Lifeline',
      '988 Suicide & Crisis Lifeline',
      'Free, confidential 24/7 support for people in suicidal crisis or emotional distress. Call or text 988. Press 1 for the Veterans Crisis Line; Spanish and LGBTQ+ youth options available.',
      'Free, confidential support available 24/7 for suicidal crisis, mental health distress, or substance use distress. Call or text 988, or chat online. Veterans can call 988 and press 1. Spanish-language and Deaf/Hard-of-Hearing support are available.',
      NULL,
      NULL,
      'https://988lifeline.org',
      'https://988lifeline.org',
      'https://988lifeline.org',
      'https://988lifeline.org',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: 988 Suicide & Crisis Lifeline',
      'https://988lifeline.org'
    ),
    (
      'childhelp',
      'bf5a6ba7-67ee-539b-a554-b1d7f7e8ef22',
      '81fd963c-757d-57f8-84a0-6484a202ec22',
      'hotline:childhelp',
      'Childhelp National Child Abuse Hotline',
      'Childhelp',
      'Childhelp',
      'Free, confidential 24/7 support for child abuse concerns, for children and adults. Call or text 1-800-422-4453.',
      'Free, confidential 24/7 support for children, teens, adults, and concerned people affected by child abuse. Call or text 1-800-422-4453, or use live chat. Counselors provide support and help with next steps; call 911 for immediate danger.',
      NULL,
      NULL,
      'https://www.childhelphotline.org',
      'https://www.childhelphotline.org',
      'https://www.childhelphotline.org',
      'https://www.childhelphotline.org',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: Childhelp',
      'https://www.childhelphotline.org'
    ),
    (
      'ctl',
      '8828ed73-6472-5bec-9d6d-ed74579cb35c',
      '528716ea-a619-512a-87fb-87ef78085a47',
      'hotline:ctl',
      'Crisis Text Line',
      'Crisis Text Line',
      'Crisis Text Line',
      'Free, confidential 24/7 crisis support by text. Text HOME to 741741.',
      'Free, confidential 24/7 crisis support by text. Text HOME to 741741.',
      NULL,
      NULL,
      'https://www.crisistextline.org',
      'https://www.crisistextline.org',
      'https://www.crisistextline.org',
      'https://www.crisistextline.org',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: Crisis Text Line',
      'https://www.crisistextline.org'
    ),
    (
      'ddh',
      '76a1ccc2-9165-5e0f-940f-f2efa83bdfbf',
      '7ae3c667-0f69-5f8b-82cf-cbfc8f6ded68',
      'hotline:ddh',
      'Disaster Distress Helpline',
      'SAMHSA Disaster Distress Helpline',
      'SAMHSA Disaster Distress Helpline',
      'Free, confidential 24/7 crisis counseling for people experiencing emotional distress related to natural or human-caused disasters. Call or text 1-800-985-5990.',
      'Free, confidential 24/7 crisis counseling for people experiencing emotional distress related to natural or human-caused disasters. Call or text 1-800-985-5990.',
      NULL,
      NULL,
      'https://www.samhsa.gov/find-help/disaster-distress-helpline',
      'https://www.samhsa.gov/find-help/helplines/disaster-distress-helpline',
      'https://www.samhsa.gov/find-help/disaster-distress-helpline',
      'https://www.samhsa.gov/find-help/helplines/disaster-distress-helpline',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: Disaster Distress Helpline',
      'https://www.samhsa.gov/find-help/helplines/disaster-distress-helpline'
    ),
    (
      'ndvh',
      'ab44a7da-b39b-5c07-9d9e-db70972e17ea',
      'a64811be-1963-53d6-b3dc-0aac151cb348',
      'hotline:ndvh',
      'National Domestic Violence Hotline',
      'National Domestic Violence Hotline',
      'National Domestic Violence Hotline',
      'Free, confidential 24/7 support for anyone affected by domestic violence. Call 1-800-799-7233, text START to 88788, or chat online. TTY 1-800-787-3224.',
      'Free, confidential 24/7 support for anyone affected by domestic violence. Call 1-800-799-7233, text START to 88788, or chat online.',
      NULL,
      NULL,
      'https://www.thehotline.org',
      'https://www.thehotline.org/get-help/',
      'https://www.thehotline.org',
      'https://www.thehotline.org/get-help/',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: National Domestic Violence Hotline',
      'https://www.thehotline.org/get-help/'
    ),
    (
      'nhth',
      '9933c0c9-c012-5c1d-a4e7-16cf723463f9',
      'be79808c-65bd-557d-a07d-683162115ef9',
      'hotline:nhth',
      'National Human Trafficking Hotline',
      'Polaris Project',
      'National Human Trafficking Hotline',
      'Free, confidential 24/7 help and referrals for victims and survivors of human trafficking. Call 1-888-373-7888 or text 233733.',
      'Free, confidential 24/7 support, safety planning, and referrals for people affected by human trafficking. Call 1-888-373-7888, text 233733, email help@humantraffickinghotline.org, or dial 711 for TTY relay.',
      NULL,
      'Operated by Compass Connections.',
      'https://humantraffickinghotline.org',
      'https://humantraffickinghotline.org/en/get-help',
      'https://humantraffickinghotline.org',
      'https://humantraffickinghotline.org/en/get-help',
      NULL,
      'help@humantraffickinghotline.org',
      'service_catalog',
      'ORAN verified hotline: National Human Trafficking Hotline',
      'https://humantraffickinghotline.org/en/get-help'
    ),
    (
      'nmmh',
      'a222dd85-8307-5ef2-943f-4ff7a31c0ae6',
      'e777ac21-7c0e-5c69-89a7-83c9f4c12dc9',
      'hotline:nmmh',
      'National Maternal Mental Health Hotline',
      'HRSA National Maternal Mental Health Hotline',
      'HRSA National Maternal Mental Health Hotline',
      'Free, confidential 24/7 support before, during, and after pregnancy. Call or text 1-833-852-6262 (TLC-MAMA).',
      'Free, confidential 24/7 support before, during, and after pregnancy. Call or text 1-833-852-6262 (TLC-MAMA).',
      NULL,
      NULL,
      'https://mchb.hrsa.gov/national-maternal-mental-health-hotline',
      'https://mchb.hrsa.gov/programs-impact/national-maternal-mental-health-hotline',
      'https://mchb.hrsa.gov/national-maternal-mental-health-hotline',
      'https://mchb.hrsa.gov/programs-impact/national-maternal-mental-health-hotline',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: National Maternal Mental Health Hotline',
      'https://mchb.hrsa.gov/programs-impact/national-maternal-mental-health-hotline'
    ),
    (
      'nrs',
      '94eea25b-24ff-5175-9ecd-611e49ac4520',
      'c378fc86-de1c-5396-ba8e-58d9189f9d22',
      'hotline:nrs',
      'National Runaway Safeline',
      'National Runaway Safeline',
      'National Runaway Safeline',
      'Free, confidential 24/7 crisis support for runaway and homeless youth and their families. Call 1-800-786-2929.',
      'Free, confidential 24/7 support for youth in crisis and their families. Call or text 1-800-786-2929, or use live chat.',
      NULL,
      NULL,
      'https://www.1800runaway.org',
      'https://www.1800runaway.org/get-help',
      'https://www.1800runaway.org',
      'https://www.1800runaway.org/get-help',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: National Runaway Safeline',
      'https://www.1800runaway.org/get-help'
    ),
    (
      'rainn',
      'db7d4ab7-5675-523c-8fa2-bec66cb690ea',
      '57d114e7-c271-5584-a064-0c057c9a51e4',
      'hotline:rainn',
      'National Sexual Assault Hotline',
      'RAINN (Rape, Abuse & Incest National Network)',
      'RAINN (Rape, Abuse & Incest National Network)',
      'Free, confidential 24/7 support for survivors of sexual assault. Call 1-800-656-4673 or chat at rainn.org.',
      'Free, confidential 24/7 support for survivors of sexual assault. Call 1-800-656-4673, text HOPE to 64673, or chat online.',
      NULL,
      NULL,
      'https://www.rainn.org',
      'https://rainn.org/help-and-healing/hotline/',
      'https://www.rainn.org',
      'https://rainn.org/help-and-healing/hotline/',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: RAINN',
      'https://rainn.org/help-and-healing/hotline/'
    ),
    (
      'samhsa',
      'f79323a0-4e03-5157-abde-812dd695060f',
      'ec7e66e9-079f-57e2-969d-fda6b6d0650b',
      'hotline:samhsa',
      'SAMHSA National Helpline',
      'SAMHSA (Substance Abuse and Mental Health Services Administration)',
      'SAMHSA (Substance Abuse and Mental Health Services Administration)',
      'Free, confidential 24/7 treatment referral and information for mental health and substance use disorders. 1-800-662-4357 (TTY 1-800-487-4889).',
      'Free, confidential 24/7 treatment referral and information for mental health and substance use disorders. Call 1-800-662-4357 (TTY 1-800-487-4889) or text a 5-digit ZIP code to 435748 (HELP4U).',
      NULL,
      NULL,
      'https://www.samhsa.gov/find-help/national-helpline',
      'https://www.samhsa.gov/find-help/helplines/national-helpline',
      'https://www.samhsa.gov/find-help/national-helpline',
      'https://www.samhsa.gov/find-help/helplines/national-helpline',
      NULL,
      NULL,
      'program_navigation',
      'ORAN verified hotline: SAMHSA National Helpline',
      'https://www.samhsa.gov/find-help/helplines/national-helpline'
    ),
    (
      'translifeline',
      '69e2a459-2ba2-5265-b5f9-31225afc371f',
      '60fd3d69-1a46-53c6-9ce4-72eb1693b8f1',
      'hotline:translifeline',
      'Trans Lifeline',
      'Trans Lifeline',
      'Trans Lifeline',
      'Peer support hotline run by and for trans people. Call 1-877-565-8860.',
      'Peer support hotline run by and for trans people. Call 1-877-565-8860 Monday through Friday, 10 a.m.-6 p.m. Pacific / 1-9 p.m. Eastern.',
      NULL,
      NULL,
      'https://translifeline.org',
      'https://translifeline.org/hotline/',
      'https://translifeline.org',
      'https://translifeline.org/hotline/',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: Trans Lifeline',
      'https://translifeline.org/hotline/'
    ),
    (
      'trevor',
      'dac3faaf-f024-5c58-ba7b-2d0840c845c7',
      '934be974-0ba6-552b-bcd3-8a87ebb7203a',
      'hotline:trevor',
      'Trevor Lifeline (LGBTQ+ youth)',
      'The Trevor Project',
      'The Trevor Project',
      'Free, confidential 24/7 crisis support for LGBTQ+ young people. Call 1-866-488-7386 or text START to 678678.',
      'Free, confidential 24/7 crisis support for LGBTQ+ young people. Call 1-866-488-7386 or text START to 678678.',
      NULL,
      NULL,
      'https://www.thetrevorproject.org/get-help',
      'https://www.thetrevorproject.org/get-help/',
      'https://www.thetrevorproject.org/get-help',
      'https://www.thetrevorproject.org/get-help/',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: The Trevor Project',
      'https://www.thetrevorproject.org/get-help/'
    ),
    (
      'vcl',
      'c11a0cf7-37e6-505f-9cc9-937605e58b0d',
      'f609181b-9ebf-5f42-a38d-a204d472fd84',
      'hotline:vcl',
      'Veterans Crisis Line',
      'U.S. Department of Veterans Affairs',
      'U.S. Department of Veterans Affairs',
      'Free, confidential 24/7 crisis support for Veterans and their families. Dial 988 then press 1, or text 838255.',
      'Free, confidential 24/7 crisis support for Veterans and their families. Dial 988 then press 1, or text 838255.',
      NULL,
      NULL,
      'https://www.veteranscrisisline.net',
      'https://www.veteranscrisisline.net/',
      'https://www.veteranscrisisline.net',
      'https://www.veteranscrisisline.net/',
      NULL,
      NULL,
      'service_catalog',
      'ORAN verified hotline: Veterans Crisis Line',
      'https://www.veteranscrisisline.net/'
    );

  SELECT count(*) INTO v_count FROM pg_temp.hotline_expected;
  IF v_count <> 13 THEN
    RAISE EXCEPTION 'internal hotline manifest drift: expected 13, found %', v_count;
  END IF;

  CREATE TEMP TABLE hotline_original_phones (
    phone_id uuid PRIMARY KEY,
    hotline_slug text NOT NULL,
    phone_type text NOT NULL,
    phone_number text NOT NULL,
    quarantine boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.hotline_original_phones (
    phone_id,
    hotline_slug,
    phone_type,
    phone_number,
    quarantine
  )
  VALUES
    ('ab20e706-8b94-5db0-b833-abab6a8eed0f', '988', 'voice', '988', false),
    ('f02c6333-f378-5d2f-9186-4ed5dee633c5', '988', 'sms', '988', false),
    ('ddcc8ae0-ae6a-5874-b69a-5a8d8bdd5b1d', 'childhelp', 'voice', '1-800-422-4453', false),
    ('ded61f32-3529-5e81-8de4-ec1a2b5a26e3', 'childhelp', 'sms', '1-800-422-4453', false),
    ('d4ca2ec9-3e3c-5a6d-b7c1-011bf5a0ccfc', 'ctl', 'sms', '741741', false),
    ('e4854265-c37e-546f-b8f1-e1dd4bafe057', 'ddh', 'voice', '1-800-985-5990', false),
    ('ca598312-d21c-5e28-9ac2-778e4acfb89f', 'ddh', 'sms', '1-800-985-5990', false),
    ('400d07d5-d204-5595-a63d-30edda97b352', 'ndvh', 'tty', '1-800-787-3224', true),
    ('c23c6c74-1256-589b-bef5-2eb64b55e5bc', 'ndvh', 'voice', '1-800-799-7233', false),
    ('e0b31dc9-32e9-54a0-8745-3d15a22fe6f2', 'ndvh', 'sms', '88788', false),
    ('621eb7eb-a9c2-52af-bb58-bda404f431e5', 'nhth', 'voice', '1-888-373-7888', false),
    ('6174e603-c889-5e38-a2f1-b66d6173b939', 'nhth', 'sms', '233733', false),
    ('d682a70c-40fe-5e0d-95d2-e44f3df8783f', 'nmmh', 'voice', '1-833-852-6262', false),
    ('50a5dfe7-02b3-5dc6-a8db-3b6efad33e6a', 'nmmh', 'sms', '1-833-852-6262', false),
    ('0b6d2691-3e7c-5c8d-84f7-8bec39d7f780', 'nrs', 'voice', '1-800-786-2929', false),
    ('e83a4ef4-9e6f-5d54-af96-4a9572019466', 'rainn', 'voice', '1-800-656-4673', false),
    ('70e45f9e-b301-5108-a130-0caba87bdf11', 'samhsa', 'tty', '1-800-487-4889', false),
    ('226bda9a-012f-5d41-9d99-e688a703d694', 'samhsa', 'voice', '1-800-662-4357', false),
    ('ccf8759f-03bd-506e-9a7d-d58b53c8a5a7', 'translifeline', 'voice', '1-877-565-8860', false),
    ('4db661bf-8981-5530-b0b7-068bf87d23ea', 'trevor', 'voice', '1-866-488-7386', false),
    ('8e6fc496-2b10-5057-a884-0e18eeba22ec', 'trevor', 'sms', '678678', false),
    ('27d2e362-88dc-5c42-bc15-c0121eb3b478', 'vcl', 'voice', '988', false),
    ('c641d307-4a8f-57c7-8fdc-01d40a90b900', 'vcl', 'sms', '838255', false);

  SELECT count(*) INTO v_count FROM pg_temp.hotline_original_phones;
  IF v_count <> 23 THEN
    RAISE EXCEPTION 'internal hotline contact manifest drift: expected 23, found %', v_count;
  END IF;

  CREATE TEMP TABLE hotline_existing_phone_updates (
    phone_id uuid PRIMARY KEY,
    description text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.hotline_existing_phone_updates (phone_id, description)
  VALUES
    ('ab20e706-8b94-5db0-b833-abab6a8eed0f', 'Call 988. Veterans can press 1.'),
    ('f02c6333-f378-5d2f-9186-4ed5dee633c5', 'Text 988.'),
    ('ddcc8ae0-ae6a-5874-b69a-5a8d8bdd5b1d', 'Call the Childhelp hotline.'),
    ('ded61f32-3529-5e81-8de4-ec1a2b5a26e3', 'Text the Childhelp hotline.'),
    ('d4ca2ec9-3e3c-5a6d-b7c1-011bf5a0ccfc', 'Text HOME to 741741.'),
    ('e4854265-c37e-546f-b8f1-e1dd4bafe057', 'Call the Disaster Distress Helpline.'),
    ('ca598312-d21c-5e28-9ac2-778e4acfb89f', 'Text the Disaster Distress Helpline.'),
    ('c23c6c74-1256-589b-bef5-2eb64b55e5bc', 'Call the National Domestic Violence Hotline.'),
    ('e0b31dc9-32e9-54a0-8745-3d15a22fe6f2', 'Text START to 88788.'),
    ('621eb7eb-a9c2-52af-bb58-bda404f431e5', 'Call the National Human Trafficking Hotline.'),
    ('6174e603-c889-5e38-a2f1-b66d6173b939', 'Text the National Human Trafficking Hotline.'),
    ('d682a70c-40fe-5e0d-95d2-e44f3df8783f', 'Call the National Maternal Mental Health Hotline.'),
    ('50a5dfe7-02b3-5dc6-a8db-3b6efad33e6a', 'Text the National Maternal Mental Health Hotline.'),
    ('0b6d2691-3e7c-5c8d-84f7-8bec39d7f780', 'Call the National Runaway Safeline.'),
    ('e83a4ef4-9e6f-5d54-af96-4a9572019466', 'Call the National Sexual Assault Hotline.'),
    ('70e45f9e-b301-5108-a130-0caba87bdf11', 'TTY for the SAMHSA National Helpline.'),
    ('226bda9a-012f-5d41-9d99-e688a703d694', 'Call the SAMHSA National Helpline.'),
    ('ccf8759f-03bd-506e-9a7d-d58b53c8a5a7', 'Call Monday-Friday, 10 a.m.-6 p.m. Pacific / 1-9 p.m. Eastern.'),
    ('4db661bf-8981-5530-b0b7-068bf87d23ea', 'Call the Trevor Lifeline.'),
    ('8e6fc496-2b10-5057-a884-0e18eeba22ec', 'Text START to 678678.'),
    ('27d2e362-88dc-5c42-bc15-c0121eb3b478', 'Dial 988, then press 1.'),
    ('c641d307-4a8f-57c7-8fdc-01d40a90b900', 'Text 838255.');

  SELECT count(*) INTO v_count FROM pg_temp.hotline_existing_phone_updates;
  IF v_count <> 22 THEN
    RAISE EXCEPTION 'internal existing-contact update drift: expected 22, found %', v_count;
  END IF;

  CREATE TEMP TABLE hotline_added_contacts (
    contact_key text PRIMARY KEY,
    hotline_slug text NOT NULL,
    phone_type text NOT NULL,
    phone_number text NOT NULL,
    description text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.hotline_added_contacts (
    contact_key,
    hotline_slug,
    phone_type,
    phone_number,
    description
  )
  VALUES
    ('nhth-tty-711', 'nhth', 'tty', '711', 'Dial 711 for TTY relay.'),
    ('nrs-sms', 'nrs', 'sms', '1-800-786-2929', 'Text the National Runaway Safeline.'),
    ('rainn-sms', 'rainn', 'sms', '64673', 'Text HOPE to 64673.'),
    ('samhsa-sms', 'samhsa', 'sms', '435748', 'Text a 5-digit ZIP code to 435748 (HELP4U).');

  SELECT count(*) INTO v_count FROM pg_temp.hotline_added_contacts;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'internal added-contact manifest drift: expected 4, found %', v_count;
  END IF;

  -- Exact target-set guard. No inferred hotline row can enter this batch.
  SELECT count(*) INTO v_count
  FROM public.services s
  WHERE s.created_by_user_id = 'import:hotline';

  IF v_count <> 13 THEN
    RAISE EXCEPTION
      'hotline import count drift: expected exactly 13 total import:hotline services, found %',
      v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM pg_temp.hotline_expected e
  LEFT JOIN public.services s ON s.id = e.service_id
  LEFT JOIN public.organizations o ON o.id = e.organization_id
  WHERE s.id IS NULL
     OR o.id IS NULL
     OR s.organization_id IS DISTINCT FROM e.organization_id
     OR s.name IS DISTINCT FROM e.service_name
     OR s.description IS DISTINCT FROM e.service_description_original
     OR s.url IS DISTINCT FROM e.service_url_original
     OR s.email IS DISTINCT FROM e.service_email_original
     OR s.status IS DISTINCT FROM 'active'
     OR s.created_by_user_id IS DISTINCT FROM 'import:hotline'
     OR s.created_at IS DISTINCT FROM v_created_at
     OR s.integrity_hold_at IS NOT NULL
     OR s.integrity_hold_reason IS NOT NULL
     OR s.integrity_held_by_user_id IS NOT NULL
     OR o.name IS DISTINCT FROM e.organization_name_original
     OR o.description IS DISTINCT FROM e.organization_description_original
     OR o.url IS DISTINCT FROM e.organization_url_original
     OR o.email IS NOT NULL
     OR o.uri IS DISTINCT FROM e.organization_uri
     OR o.status IS DISTINCT FROM 'active'
     OR o.created_by_user_id IS DISTINCT FROM 'import:hotline'
     OR o.created_at IS DISTINCT FROM v_created_at;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline service/organization fact drift: % targets differ', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.services s
  JOIN pg_temp.hotline_expected e ON e.organization_id = s.organization_id
  WHERE s.id <> e.service_id;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline target organizations have % non-target services', v_invalid;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.phones p
  JOIN pg_temp.hotline_expected e
    ON e.service_id = p.service_id
   AND e.organization_id = p.organization_id;

  IF v_count <> 23 THEN
    RAISE EXCEPTION 'hotline public contact count drift: expected 23, found %', v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM pg_temp.hotline_original_phones x
  JOIN pg_temp.hotline_expected e ON e.hotline_slug = x.hotline_slug
  LEFT JOIN public.phones p ON p.id = x.phone_id
  WHERE p.id IS NULL
     OR p.service_id IS DISTINCT FROM e.service_id
     OR p.organization_id IS DISTINCT FROM e.organization_id
     OR p.location_id IS NOT NULL
     OR p.number IS DISTINCT FROM x.phone_number
     OR p.extension IS NOT NULL
     OR p.type IS DISTINCT FROM x.phone_type
     OR p.language IS NOT NULL
     OR p.description IS NOT NULL;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline contact fact drift: % contacts differ', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.phones p
  JOIN pg_temp.hotline_expected e
    ON p.service_id = e.service_id OR p.organization_id = e.organization_id
  LEFT JOIN pg_temp.hotline_original_phones x ON x.phone_id = p.id
  WHERE x.phone_id IS NULL;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline unexpected-contact drift: % extra contacts', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.canonical_services cs
  JOIN pg_temp.hotline_expected e ON e.service_id = cs.published_service_id;

  SELECT v_invalid + count(*) INTO v_invalid
  FROM public.canonical_organizations co
  JOIN pg_temp.hotline_expected e ON e.organization_id = co.published_organization_id;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline canonical-link drift: % pre-existing live links', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.source_systems ss
  JOIN pg_temp.hotline_expected e ON e.source_system_name = ss.name;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline source-system name collision: % rows', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM public.canonical_services cs
  WHERE cs.source_confidence_summary ->> 'authorityBatch' = v_slug;

  SELECT v_invalid + count(*) INTO v_invalid
  FROM public.canonical_organizations co
  WHERE co.source_confidence_summary ->> 'authorityBatch' = v_slug;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline canonical batch collision: % rows', v_invalid;
  END IF;

  INSERT INTO oran_internal.hotline_authority_batches (
    slug,
    facts_version,
    expected_service_count,
    status,
    created_by,
    created_at
  )
  VALUES (
    v_slug,
    'primary-sources-reviewed-2026-07-13',
    13,
    'staging',
    v_actor,
    v_now
  )
  RETURNING id INTO v_batch_id;

  -- Authority is staged inactive. No partial source path can publish before the
  -- final guarded activation block succeeds inside this transaction.
  INSERT INTO public.source_systems (
    name,
    family,
    homepage_url,
    trust_tier,
    domain_rules,
    crawl_policy,
    jurisdiction_scope,
    contact_info,
    is_active,
    notes,
    resource_purpose
  )
  SELECT e.source_system_name,
         'allowlisted_scrape',
         e.primary_source_url,
         'verified_publisher',
         '[]'::jsonb,
         pg_catalog.jsonb_build_object(
           'verification', 'primary-source-manual-review',
           'reviewedAt', '2026-07-13',
           'automaticPublication', false
         ),
         pg_catalog.jsonb_build_object('country', 'US', 'coverage', 'nationwide'),
         '{}'::jsonb,
         false,
         'Staged by 0065 from the named operator or government primary-source contact page.',
         e.resource_purpose
  FROM pg_temp.hotline_expected e;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline source-system insert drift: expected 13, inserted %', v_updates;
  END IF;

  INSERT INTO public.source_feeds (
    source_system_id,
    feed_name,
    feed_type,
    base_url,
    healthcheck_url,
    auth_type,
    jurisdiction_scope,
    refresh_interval_hours,
    is_active,
    feed_handler
  )
  SELECT ss.id,
         'Official contact page',
         'scrape_seed',
         e.primary_source_url,
         e.primary_source_url,
         'none',
         pg_catalog.jsonb_build_object('country', 'US', 'coverage', 'nationwide'),
         24,
         false,
         'none'
  FROM pg_temp.hotline_expected e
  JOIN public.source_systems ss ON ss.name = e.source_system_name;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline source-feed insert drift: expected 13, inserted %', v_updates;
  END IF;

  WITH existing_contacts AS (
    SELECT x.hotline_slug,
           x.phone_type,
           x.phone_number,
           u.description
    FROM pg_temp.hotline_original_phones x
    JOIN pg_temp.hotline_existing_phone_updates u ON u.phone_id = x.phone_id
    WHERE x.quarantine IS FALSE
  ),
  all_contacts AS (
    SELECT c.hotline_slug,
           c.phone_type,
           c.phone_number,
           c.description
    FROM existing_contacts c
    UNION ALL
    SELECT a.hotline_slug,
           a.phone_type,
           a.phone_number,
           a.description
    FROM pg_temp.hotline_added_contacts a
  ),
  contact_payloads AS (
    SELECT c.hotline_slug,
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'type', c.phone_type,
               'number', c.phone_number,
               'description', c.description
             ) ORDER BY c.phone_type, c.phone_number
           ) AS contacts
    FROM all_contacts c
    GROUP BY c.hotline_slug
  ),
  payloads AS (
    SELECT e.hotline_slug,
           sf.id AS source_feed_id,
           e.primary_source_url,
           pg_catalog.jsonb_build_object(
             'factVersion', 'primary-sources-reviewed-2026-07-13',
             'primarySourceUrl', e.primary_source_url,
             'organization', pg_catalog.jsonb_build_object(
               'liveId', e.organization_id,
               'uri', e.organization_uri,
               'name', e.organization_name_final,
               'description', e.organization_description_final,
               'url', e.organization_url_final
             ),
             'service', pg_catalog.jsonb_build_object(
               'liveId', e.service_id,
               'name', e.service_name,
               'description', e.service_description_final,
               'url', e.service_url_final,
               'email', e.service_email_final,
               'resourcePurpose', e.resource_purpose
             ),
             'contacts', cp.contacts
           ) AS raw_payload
    FROM pg_temp.hotline_expected e
    JOIN public.source_systems ss ON ss.name = e.source_system_name
    JOIN public.source_feeds sf
      ON sf.source_system_id = ss.id
     AND sf.feed_name = 'Official contact page'
    JOIN contact_payloads cp ON cp.hotline_slug = e.hotline_slug
  )
  INSERT INTO public.source_records (
    source_feed_id,
    source_record_type,
    source_record_id,
    source_version,
    fetched_at,
    canonical_source_url,
    payload_sha256,
    raw_payload,
    parsed_payload,
    correlation_id,
    source_confidence_signals,
    processing_status
  )
  SELECT p.source_feed_id,
         'mixed_bundle',
         'hotline:' || p.hotline_slug || ':verified-2026-07-13',
         '2026-07-13',
         v_now,
         p.primary_source_url,
         pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(p.raw_payload::text, 'UTF8')),
           'hex'
         ),
         p.raw_payload,
         p.raw_payload,
         v_slug,
         pg_catalog.jsonb_build_object(
           'verification', 'primary_source',
           'confidence', 100,
           'reviewedAt', '2026-07-13'
         ),
         'normalized'
  FROM payloads p;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline source-record insert drift: expected 13, inserted %', v_updates;
  END IF;

  INSERT INTO public.canonical_organizations (
    name,
    description,
    url,
    lifecycle_status,
    publication_status,
    winning_source_system_id,
    source_count,
    source_confidence_summary,
    published_organization_id,
    first_seen_at,
    last_refreshed_at
  )
  SELECT e.organization_name_final,
         e.organization_description_final,
         e.organization_url_final,
         'draft',
         'unpublished',
         ss.id,
         1,
         pg_catalog.jsonb_build_object(
           'authorityBatch', v_slug,
           'hotlineSlug', e.hotline_slug,
           'confidence', 100
         ),
         NULL,
         v_now,
         v_now
  FROM pg_temp.hotline_expected e
  JOIN public.source_systems ss ON ss.name = e.source_system_name;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline canonical-organization insert drift: expected 13, inserted %', v_updates;
  END IF;

  INSERT INTO public.canonical_services (
    canonical_organization_id,
    name,
    description,
    url,
    email,
    status,
    lifecycle_status,
    publication_status,
    winning_source_system_id,
    source_count,
    source_confidence_summary,
    published_service_id,
    first_seen_at,
    last_refreshed_at
  )
  SELECT co.id,
         e.service_name,
         e.service_description_final,
         e.service_url_final,
         e.service_email_final,
         'active',
         'draft',
         'unpublished',
         ss.id,
         1,
         pg_catalog.jsonb_build_object(
           'authorityBatch', v_slug,
           'hotlineSlug', e.hotline_slug,
           'confidence', 100
         ),
         NULL,
         v_now,
         v_now
  FROM pg_temp.hotline_expected e
  JOIN public.source_systems ss ON ss.name = e.source_system_name
  JOIN public.canonical_organizations co
    ON co.winning_source_system_id = ss.id
   AND co.source_confidence_summary ->> 'authorityBatch' = v_slug
   AND co.source_confidence_summary ->> 'hotlineSlug' = e.hotline_slug;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline canonical-service insert drift: expected 13, inserted %', v_updates;
  END IF;

  INSERT INTO oran_internal.hotline_authority_members (
    batch_id,
    hotline_slug,
    service_id,
    organization_id,
    source_system_id,
    source_feed_id,
    source_record_id,
    canonical_organization_id,
    canonical_service_id,
    original_service,
    applied_service,
    original_organization,
    applied_organization,
    original_phones,
    applied_phones,
    created_at
  )
  SELECT v_batch_id,
         e.hotline_slug,
         e.service_id,
         e.organization_id,
         ss.id,
         sf.id,
         sr.id,
         co.id,
         cs.id,
         oran_internal.hotline_service_snapshot(e.service_id),
         '{}'::jsonb,
         oran_internal.hotline_organization_snapshot(e.organization_id),
         '{}'::jsonb,
         oran_internal.hotline_phone_snapshot(e.service_id),
         '[]'::jsonb,
         v_now
  FROM pg_temp.hotline_expected e
  JOIN public.source_systems ss ON ss.name = e.source_system_name
  JOIN public.source_feeds sf
    ON sf.source_system_id = ss.id
   AND sf.feed_name = 'Official contact page'
  JOIN public.source_records sr
    ON sr.source_feed_id = sf.id
   AND sr.source_record_id = 'hotline:' || e.hotline_slug || ':verified-2026-07-13'
  JOIN public.canonical_organizations co
    ON co.winning_source_system_id = ss.id
   AND co.source_confidence_summary ->> 'authorityBatch' = v_slug
   AND co.source_confidence_summary ->> 'hotlineSlug' = e.hotline_slug
  JOIN public.canonical_services cs
    ON cs.canonical_organization_id = co.id
   AND cs.winning_source_system_id = ss.id
   AND cs.source_confidence_summary ->> 'authorityBatch' = v_slug
   AND cs.source_confidence_summary ->> 'hotlineSlug' = e.hotline_slug;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline authority-member insert drift: expected 13, inserted %', v_updates;
  END IF;

  INSERT INTO public.canonical_provenance (
    canonical_entity_type,
    canonical_entity_id,
    field_name,
    asserted_value,
    source_record_id,
    selector_or_hint,
    confidence_hint,
    decision_status
  )
  SELECT 'service',
         m.canonical_service_id,
         fields.field_name,
         fields.asserted_value,
         m.source_record_id,
         '$.service.' || fields.field_name,
         100,
         'candidate'
  FROM pg_temp.hotline_expected e
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = v_batch_id
   AND m.hotline_slug = e.hotline_slug
  CROSS JOIN LATERAL (
    VALUES
      ('name', pg_catalog.to_jsonb(e.service_name)),
      ('description', pg_catalog.to_jsonb(e.service_description_final)),
      ('url', pg_catalog.to_jsonb(e.service_url_final)),
      ('email', pg_catalog.to_jsonb(e.service_email_final)),
      ('status', '"active"'::jsonb)
  ) AS fields(field_name, asserted_value);
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 65 THEN
    RAISE EXCEPTION 'hotline service-provenance insert drift: expected 65, inserted %', v_updates;
  END IF;

  INSERT INTO public.canonical_provenance (
    canonical_entity_type,
    canonical_entity_id,
    field_name,
    asserted_value,
    source_record_id,
    selector_or_hint,
    confidence_hint,
    decision_status
  )
  SELECT 'organization',
         m.canonical_organization_id,
         fields.field_name,
         fields.asserted_value,
         m.source_record_id,
         '$.organization.' || fields.field_name,
         100,
         'candidate'
  FROM pg_temp.hotline_expected e
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = v_batch_id
   AND m.hotline_slug = e.hotline_slug
  CROSS JOIN LATERAL (
    VALUES
      ('name', pg_catalog.to_jsonb(e.organization_name_final)),
      ('url', pg_catalog.to_jsonb(e.organization_url_final))
  ) AS fields(field_name, asserted_value);
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 26 THEN
    RAISE EXCEPTION 'hotline organization-provenance insert drift: expected 26, inserted %', v_updates;
  END IF;

  INSERT INTO public.canonical_provenance (
    canonical_entity_type,
    canonical_entity_id,
    field_name,
    asserted_value,
    source_record_id,
    selector_or_hint,
    confidence_hint,
    decision_status
  )
  SELECT 'organization',
         m.canonical_organization_id,
         'description',
         pg_catalog.to_jsonb(e.organization_description_final),
         m.source_record_id,
         '$.organization.description',
         100,
         'candidate'
  FROM pg_temp.hotline_expected e
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = v_batch_id
   AND m.hotline_slug = e.hotline_slug
  WHERE e.hotline_slug = 'nhth';
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 1 THEN
    RAISE EXCEPTION 'hotline operator-provenance insert drift: expected 1, inserted %', v_updates;
  END IF;




  -- Correct the audited live facts while authority is still inactive.
  UPDATE public.services s
  SET description = e.service_description_final,
      url = e.service_url_final,
      email = e.service_email_final,
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM pg_temp.hotline_expected e
  WHERE s.id = e.service_id
    AND s.description IS NOT DISTINCT FROM e.service_description_original
    AND s.url IS NOT DISTINCT FROM e.service_url_original
    AND s.email IS NOT DISTINCT FROM e.service_email_original;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline service correction drift: expected 13, updated %', v_updates;
  END IF;

  UPDATE public.organizations o
  SET name = e.organization_name_final,
      description = e.organization_description_final,
      url = e.organization_url_final,
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM pg_temp.hotline_expected e
  WHERE o.id = e.organization_id
    AND o.name IS NOT DISTINCT FROM e.organization_name_original
    AND o.description IS NOT DISTINCT FROM e.organization_description_original
    AND o.url IS NOT DISTINCT FROM e.organization_url_original;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline organization correction drift: expected 13, updated %', v_updates;
  END IF;

  UPDATE public.phones p
  SET description = u.description,
      updated_at = v_now,
      updated_by_user_id = v_actor
  FROM pg_temp.hotline_existing_phone_updates u
  WHERE p.id = u.phone_id
    AND p.description IS NULL;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 22 THEN
    RAISE EXCEPTION 'hotline existing-contact correction drift: expected 22, updated %', v_updates;
  END IF;

  INSERT INTO oran_internal.hotline_quarantined_contacts (
    batch_id,
    phone_id,
    service_id,
    organization_id,
    reason,
    phone_snapshot,
    quarantined_at
  )
  SELECT v_batch_id,
         p.id,
         p.service_id,
         p.organization_id,
         'Current National Domestic Violence Hotline primary contact page does not publish this legacy TTY number; retained for audit, not seeker publication.',
         pg_catalog.jsonb_build_object(
           'id', p.id,
           'service_id', p.service_id,
           'organization_id', p.organization_id,
           'location_id', p.location_id,
           'number', p.number,
           'extension', p.extension,
           'type', p.type,
           'language', p.language,
           'description', p.description,
           'created_by_user_id', p.created_by_user_id
         ),
         v_now
  FROM public.phones p
  JOIN pg_temp.hotline_original_phones x
    ON x.phone_id = p.id
   AND x.quarantine IS TRUE
  JOIN pg_temp.hotline_expected e
    ON e.hotline_slug = x.hotline_slug
   AND e.service_id = p.service_id
   AND e.organization_id = p.organization_id;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 1 THEN
    RAISE EXCEPTION 'hotline stale-contact archive drift: expected 1, archived %', v_updates;
  END IF;

  DELETE FROM public.phones p
  USING pg_temp.hotline_original_phones x,
        pg_temp.hotline_expected e
  WHERE x.quarantine IS TRUE
    AND e.hotline_slug = x.hotline_slug
    AND p.id = x.phone_id
    AND p.service_id = e.service_id
    AND p.organization_id = e.organization_id
    AND p.location_id IS NULL
    AND p.number = x.phone_number
    AND p.type = x.phone_type
    AND p.extension IS NULL
    AND p.language IS NULL
    AND p.description IS NULL;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 1 THEN
    RAISE EXCEPTION 'hotline stale-contact removal drift: expected 1, removed %', v_updates;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM pg_temp.hotline_added_contacts a
  JOIN pg_temp.hotline_expected e ON e.hotline_slug = a.hotline_slug
  JOIN public.phones p
    ON p.service_id = e.service_id
   AND p.organization_id = e.organization_id
   AND p.type = a.phone_type
   AND p.number = a.phone_number;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline generated-contact collision: % contacts already exist', v_invalid;
  END IF;

  INSERT INTO public.phones (
    service_id,
    organization_id,
    number,
    type,
    description,
    created_at,
    updated_at,
    created_by_user_id,
    updated_by_user_id
  )
  SELECT e.service_id,
         e.organization_id,
         a.phone_number,
         a.phone_type,
         a.description,
         v_now,
         v_now,
         v_actor,
         v_actor
  FROM pg_temp.hotline_added_contacts a
  JOIN pg_temp.hotline_expected e ON e.hotline_slug = a.hotline_slug;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 4 THEN
    RAISE EXCEPTION 'hotline generated-contact insert drift: expected 4, inserted %', v_updates;
  END IF;

  INSERT INTO oran_internal.hotline_authority_added_contacts (
    batch_id,
    contact_key,
    phone_id,
    service_id,
    organization_id,
    phone_snapshot,
    created_at
  )
  SELECT v_batch_id,
         a.contact_key,
         p.id,
         p.service_id,
         p.organization_id,
         pg_catalog.jsonb_build_object(
           'id', p.id,
           'service_id', p.service_id,
           'organization_id', p.organization_id,
           'location_id', p.location_id,
           'number', p.number,
           'extension', p.extension,
           'type', p.type,
           'language', p.language,
           'description', p.description,
           'created_by_user_id', p.created_by_user_id
         ),
         v_now
  FROM pg_temp.hotline_added_contacts a
  JOIN pg_temp.hotline_expected e ON e.hotline_slug = a.hotline_slug
  JOIN public.phones p
    ON p.service_id = e.service_id
   AND p.organization_id = e.organization_id
   AND p.number = a.phone_number
   AND p.type = a.phone_type
   AND p.description = a.description
   AND p.created_by_user_id = v_actor;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 4 THEN
    RAISE EXCEPTION 'hotline generated-contact audit drift: expected 4, captured %', v_updates;
  END IF;

  UPDATE oran_internal.hotline_authority_members m
  SET applied_service = oran_internal.hotline_service_snapshot(m.service_id),
      applied_organization = oran_internal.hotline_organization_snapshot(m.organization_id),
      applied_phones = oran_internal.hotline_phone_snapshot(m.service_id)
  WHERE m.batch_id = v_batch_id;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline applied-snapshot drift: expected 13, captured %', v_updates;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.phones p
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = v_batch_id
   AND m.service_id = p.service_id
   AND m.organization_id = p.organization_id;

  IF v_count <> 26 THEN
    RAISE EXCEPTION 'hotline staged contact drift: expected 26, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.canonical_provenance cp
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = v_batch_id
   AND (
     (cp.canonical_entity_type = 'service'
       AND cp.canonical_entity_id = m.canonical_service_id)
     OR
     (cp.canonical_entity_type = 'organization'
       AND cp.canonical_entity_id = m.canonical_organization_id)
   )
  WHERE cp.source_record_id = m.source_record_id
    AND cp.decision_status = 'candidate';

  IF v_count <> 92 THEN
    RAISE EXCEPTION 'hotline staged provenance drift: expected 92, found %', v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_members m
  JOIN public.source_systems ss ON ss.id = m.source_system_id
  JOIN public.source_feeds sf ON sf.id = m.source_feed_id
  JOIN public.source_records sr ON sr.id = m.source_record_id
  JOIN public.canonical_organizations co ON co.id = m.canonical_organization_id
  JOIN public.canonical_services cs ON cs.id = m.canonical_service_id
  WHERE m.batch_id = v_batch_id
    AND (
      ss.is_active IS NOT FALSE
      OR sf.is_active IS NOT FALSE
      OR sr.processing_status <> 'normalized'
      OR co.lifecycle_status <> 'draft'
      OR co.publication_status <> 'unpublished'
      OR co.published_organization_id IS NOT NULL
      OR cs.lifecycle_status <> 'draft'
      OR cs.publication_status <> 'unpublished'
      OR cs.published_service_id IS NOT NULL
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline staging safety drift: % authority paths changed early', v_invalid;
  END IF;

  -- Atomic authority activation. Every row remains invisible until COMMIT.
  UPDATE public.source_records sr
  SET processing_status = 'published',
      processed_at = v_now,
      processing_error = NULL
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND sr.id = m.source_record_id
    AND sr.processing_status = 'normalized';
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline source-record activation drift: expected 13, updated %', v_updates;
  END IF;

  UPDATE public.canonical_provenance cp
  SET decision_status = 'accepted',
      decided_at = v_now,
      decided_by = v_actor,
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND cp.source_record_id = m.source_record_id
    AND (
      (cp.canonical_entity_type = 'service'
        AND cp.canonical_entity_id = m.canonical_service_id)
      OR
      (cp.canonical_entity_type = 'organization'
        AND cp.canonical_entity_id = m.canonical_organization_id)
    )
    AND cp.decision_status = 'candidate';
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 92 THEN
    RAISE EXCEPTION 'hotline provenance activation drift: expected 92, updated %', v_updates;
  END IF;

  UPDATE public.canonical_organizations co
  SET lifecycle_status = 'active',
      publication_status = 'published',
      published_organization_id = m.organization_id,
      last_refreshed_at = v_now,
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND co.id = m.canonical_organization_id
    AND co.lifecycle_status = 'draft'
    AND co.publication_status = 'unpublished'
    AND co.published_organization_id IS NULL;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline canonical-organization activation drift: expected 13, updated %', v_updates;
  END IF;

  UPDATE public.canonical_services cs
  SET lifecycle_status = 'active',
      publication_status = 'published',
      published_service_id = m.service_id,
      last_refreshed_at = v_now,
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND cs.id = m.canonical_service_id
    AND cs.lifecycle_status = 'draft'
    AND cs.publication_status = 'unpublished'
    AND cs.published_service_id IS NULL;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline canonical-service activation drift: expected 13, updated %', v_updates;
  END IF;

  UPDATE public.source_feeds sf
  SET is_active = true,
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND sf.id = m.source_feed_id
    AND sf.is_active IS FALSE;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline source-feed activation drift: expected 13, updated %', v_updates;
  END IF;

  UPDATE public.source_systems ss
  SET is_active = true,
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND ss.id = m.source_system_id
    AND ss.is_active IS FALSE;
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 13 THEN
    RAISE EXCEPTION 'hotline source-system activation drift: expected 13, updated %', v_updates;
  END IF;

  UPDATE oran_internal.hotline_authority_batches b
  SET status = 'applied',
      applied_at = v_now
  WHERE b.id = v_batch_id
    AND b.status = 'staging';
  GET DIAGNOSTICS v_updates = ROW_COUNT;

  IF v_updates <> 1 THEN
    RAISE EXCEPTION 'hotline authority batch activation drift: expected 1, updated %', v_updates;
  END IF;

  v_summary := oran_internal.assert_verified_hotline_authority('applied');

  UPDATE oran_internal.hotline_authority_batches b
  SET validation_summary = v_summary
  WHERE b.id = v_batch_id;

  RETURN v_summary;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.hotline_organization_snapshot(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'description', o.description,
    'url', o.url,
    'email', o.email,
    'uri', o.uri,
    'status', o.status,
    'created_by_user_id', o.created_by_user_id
  )
  FROM public.organizations o
  WHERE o.id = p_organization_id;
$function$;

CREATE OR REPLACE FUNCTION oran_internal.hotline_phone_snapshot(p_service_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', p.id,
        'service_id', p.service_id,
        'organization_id', p.organization_id,
        'location_id', p.location_id,
        'number', p.number,
        'extension', p.extension,
        'type', p.type,
        'language', p.language,
        'description', p.description,
        'created_by_user_id', p.created_by_user_id
      ) ORDER BY p.id
    ),
    '[]'::jsonb
  )
  FROM public.phones p
  WHERE p.service_id = p_service_id;
$function$;

CREATE OR REPLACE FUNCTION oran_internal.assert_verified_hotline_authority(
  p_expected_status text DEFAULT 'applied'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_slug constant text := 'verified-national-hotlines-2026-07-13';
  v_batch_id uuid;
  v_batch_status text;
  v_count bigint;
  v_invalid bigint;
  v_authorized bigint;
  v_result jsonb;
BEGIN
  IF p_expected_status NOT IN ('applied', 'deactivated') THEN
    RAISE EXCEPTION 'unsupported hotline authority validation status: %', p_expected_status;
  END IF;

  SELECT b.id, b.status
  INTO v_batch_id, v_batch_status
  FROM oran_internal.hotline_authority_batches b
  WHERE b.slug = v_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hotline authority batch % was not found', v_slug;
  END IF;

  IF v_batch_status <> p_expected_status THEN
    RAISE EXCEPTION
      'hotline authority status drift: expected %, found %',
      p_expected_status,
      v_batch_status;
  END IF;

  SELECT count(*) INTO v_count
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id;

  IF v_count <> 13 THEN
    RAISE EXCEPTION 'hotline authority member drift: expected 13, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM oran_internal.hotline_authority_members m
  JOIN public.source_systems ss ON ss.id = m.source_system_id
  JOIN public.source_feeds sf
    ON sf.id = m.source_feed_id
   AND sf.source_system_id = ss.id
  JOIN public.source_records sr
    ON sr.id = m.source_record_id
   AND sr.source_feed_id = sf.id
  JOIN public.canonical_organizations co
    ON co.id = m.canonical_organization_id
   AND co.winning_source_system_id = ss.id
  JOIN public.canonical_services cs
    ON cs.id = m.canonical_service_id
   AND cs.canonical_organization_id = co.id
   AND cs.winning_source_system_id = ss.id
  WHERE m.batch_id = v_batch_id;

  IF v_count <> 13 THEN
    RAISE EXCEPTION 'hotline authority relationship drift: expected 13 complete paths, found %', v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_members m
  JOIN public.source_systems ss ON ss.id = m.source_system_id
  JOIN public.source_feeds sf ON sf.id = m.source_feed_id
  JOIN public.source_records sr ON sr.id = m.source_record_id
  JOIN public.canonical_organizations co ON co.id = m.canonical_organization_id
  JOIN public.canonical_services cs ON cs.id = m.canonical_service_id
  WHERE m.batch_id = v_batch_id
    AND (
      ss.family <> 'allowlisted_scrape'
      OR ss.trust_tier <> 'verified_publisher'
      OR ss.resource_purpose NOT IN ('service_catalog', 'program_navigation')
      OR sf.source_system_id IS DISTINCT FROM ss.id
      OR sf.feed_type <> 'scrape_seed'
      OR sf.feed_handler <> 'none'
      OR sf.base_url IS DISTINCT FROM sr.canonical_source_url
      OR sr.source_feed_id IS DISTINCT FROM sf.id
      OR sr.source_record_type <> 'mixed_bundle'
      OR sr.source_version <> '2026-07-13'
      OR sr.correlation_id <> v_slug
      OR sr.parsed_payload IS DISTINCT FROM sr.raw_payload
      OR sr.raw_payload #>> '{service,liveId}' IS DISTINCT FROM m.service_id::text
      OR sr.raw_payload #>> '{organization,liveId}' IS DISTINCT FROM m.organization_id::text
      OR sr.raw_payload #>> '{service,name}' IS DISTINCT FROM m.applied_service ->> 'name'
      OR sr.raw_payload #>> '{service,description}' IS DISTINCT FROM m.applied_service ->> 'description'
      OR sr.raw_payload #>> '{service,url}' IS DISTINCT FROM m.applied_service ->> 'url'
      OR sr.raw_payload #>> '{organization,name}' IS DISTINCT FROM m.applied_organization ->> 'name'
      OR sr.raw_payload #>> '{organization,url}' IS DISTINCT FROM m.applied_organization ->> 'url'
      OR co.published_organization_id IS DISTINCT FROM m.organization_id
      OR co.lifecycle_status <> 'active'
      OR co.name IS DISTINCT FROM m.applied_organization ->> 'name'
      OR co.description IS DISTINCT FROM m.applied_organization ->> 'description'
      OR co.url IS DISTINCT FROM m.applied_organization ->> 'url'
      OR cs.published_service_id IS DISTINCT FROM m.service_id
      OR cs.lifecycle_status <> 'active'
      OR cs.status <> 'active'
      OR cs.name IS DISTINCT FROM m.applied_service ->> 'name'
      OR cs.description IS DISTINCT FROM m.applied_service ->> 'description'
      OR cs.url IS DISTINCT FROM m.applied_service ->> 'url'
      OR cs.email IS DISTINCT FROM m.applied_service ->> 'email'
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline authority fact-path drift: % members', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND (
      oran_internal.hotline_service_snapshot(m.service_id)
        IS DISTINCT FROM m.applied_service
      OR oran_internal.hotline_organization_snapshot(m.organization_id)
        IS DISTINCT FROM m.applied_organization
      OR oran_internal.hotline_phone_snapshot(m.service_id)
        IS DISTINCT FROM m.applied_phones
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline live-fact drift: % member snapshots differ', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_members m
  JOIN public.source_records sr ON sr.id = m.source_record_id
  WHERE m.batch_id = v_batch_id
    AND sr.payload_sha256 IS DISTINCT FROM pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(sr.raw_payload::text, 'UTF8')),
      'hex'
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline immutable source-record hash drift: % records', v_invalid;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.phones p
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = v_batch_id
   AND m.service_id = p.service_id
   AND m.organization_id = p.organization_id;

  IF v_count <> 26 THEN
    RAISE EXCEPTION 'hotline final contact drift: expected 26, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM oran_internal.hotline_quarantined_contacts q
  WHERE q.batch_id = v_batch_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'hotline quarantined-contact drift: expected 1, found %', v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_quarantined_contacts q
  WHERE q.batch_id = v_batch_id
    AND (
      q.phone_id IS DISTINCT FROM '400d07d5-d204-5595-a63d-30edda97b352'::uuid
      OR q.service_id IS DISTINCT FROM 'ab44a7da-b39b-5c07-9d9e-db70972e17ea'::uuid
      OR q.organization_id IS DISTINCT FROM 'a64811be-1963-53d6-b3dc-0aac151cb348'::uuid
      OR q.phone_snapshot ->> 'number' IS DISTINCT FROM '1-800-787-3224'
      OR q.phone_snapshot ->> 'type' IS DISTINCT FROM 'tty'
      OR q.phone_snapshot ->> 'description' IS NOT NULL
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline quarantined-contact audit fact drift';
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_quarantined_contacts q
  WHERE q.batch_id = v_batch_id
    AND EXISTS (SELECT 1 FROM public.phones p WHERE p.id = q.phone_id);

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'quarantined hotline contact is still publicly linked';
  END IF;

  SELECT count(*) INTO v_count
  FROM oran_internal.hotline_authority_added_contacts a
  WHERE a.batch_id = v_batch_id;

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'hotline added-contact drift: expected 4, found %', v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_added_contacts a
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = a.batch_id
   AND m.service_id = a.service_id
   AND m.organization_id = a.organization_id
  LEFT JOIN (
    VALUES
      ('nhth-tty-711', 'nhth', 'tty', '711'),
      ('nrs-sms', 'nrs', 'sms', '1-800-786-2929'),
      ('rainn-sms', 'rainn', 'sms', '64673'),
      ('samhsa-sms', 'samhsa', 'sms', '435748')
  ) AS expected_contact(contact_key, hotline_slug, phone_type, phone_number)
    ON expected_contact.contact_key = a.contact_key
   AND expected_contact.hotline_slug = m.hotline_slug
   AND expected_contact.phone_type = a.phone_snapshot ->> 'type'
   AND expected_contact.phone_number = a.phone_snapshot ->> 'number'
  WHERE a.batch_id = v_batch_id
    AND expected_contact.contact_key IS NULL;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline added-contact audit fact drift: % contacts', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_added_contacts a
  WHERE a.batch_id = v_batch_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.phones p
      WHERE p.id = a.phone_id
        AND p.service_id = a.service_id
        AND p.organization_id = a.organization_id
        AND pg_catalog.jsonb_build_object(
          'id', p.id,
          'service_id', p.service_id,
          'organization_id', p.organization_id,
          'location_id', p.location_id,
          'number', p.number,
          'extension', p.extension,
          'type', p.type,
          'language', p.language,
          'description', p.description,
          'created_by_user_id', p.created_by_user_id
        ) = a.phone_snapshot
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline generated-contact snapshot drift: % contacts', v_invalid;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.canonical_provenance cp
  JOIN oran_internal.hotline_authority_members m
    ON m.batch_id = v_batch_id
   AND (
     (cp.canonical_entity_type = 'service'
       AND cp.canonical_entity_id = m.canonical_service_id)
     OR
     (cp.canonical_entity_type = 'organization'
       AND cp.canonical_entity_id = m.canonical_organization_id)
   )
  WHERE cp.source_record_id = m.source_record_id
    AND cp.decision_status = 'accepted';

  IF v_count <> 92 THEN
    RAISE EXCEPTION 'hotline accepted-provenance drift: expected 92, found %', v_count;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_members m
  JOIN public.canonical_services cs ON cs.id = m.canonical_service_id
  WHERE m.batch_id = v_batch_id
    AND EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('name', pg_catalog.to_jsonb(cs.name)),
          ('description', pg_catalog.to_jsonb(cs.description)),
          ('url', pg_catalog.to_jsonb(cs.url)),
          ('email', pg_catalog.to_jsonb(cs.email)),
          ('status', pg_catalog.to_jsonb(cs.status))
      ) AS expected_field(field_name, asserted_value)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.canonical_provenance cp
        WHERE cp.canonical_entity_type = 'service'
          AND cp.canonical_entity_id = m.canonical_service_id
          AND cp.source_record_id = m.source_record_id
          AND cp.field_name = expected_field.field_name
          AND cp.asserted_value IS NOT DISTINCT FROM expected_field.asserted_value
          AND cp.decision_status = 'accepted'
      )
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline service provenance-value drift: % members', v_invalid;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM oran_internal.hotline_authority_members m
  JOIN public.canonical_organizations co ON co.id = m.canonical_organization_id
  WHERE m.batch_id = v_batch_id
    AND (
      EXISTS (
        SELECT 1
        FROM (
          VALUES
            ('name', pg_catalog.to_jsonb(co.name)),
            ('url', pg_catalog.to_jsonb(co.url))
        ) AS expected_field(field_name, asserted_value)
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.canonical_provenance cp
          WHERE cp.canonical_entity_type = 'organization'
            AND cp.canonical_entity_id = m.canonical_organization_id
            AND cp.source_record_id = m.source_record_id
            AND cp.field_name = expected_field.field_name
            AND cp.asserted_value IS NOT DISTINCT FROM expected_field.asserted_value
            AND cp.decision_status = 'accepted'
        )
      )
      OR (
        m.hotline_slug = 'nhth'
        AND NOT EXISTS (
          SELECT 1
          FROM public.canonical_provenance cp
          WHERE cp.canonical_entity_type = 'organization'
            AND cp.canonical_entity_id = m.canonical_organization_id
            AND cp.source_record_id = m.source_record_id
            AND cp.field_name = 'description'
            AND cp.asserted_value IS NOT DISTINCT FROM pg_catalog.to_jsonb(co.description)
            AND cp.decision_status = 'accepted'
        )
      )
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'hotline organization provenance-value drift: % members', v_invalid;
  END IF;

  SELECT count(DISTINCT cs.published_service_id) INTO v_authorized
  FROM oran_internal.hotline_authority_members m
  JOIN public.canonical_services cs
    ON cs.id = m.canonical_service_id
  JOIN public.canonical_provenance cp
    ON cp.canonical_entity_type = 'service'
   AND cp.canonical_entity_id = cs.id
   AND cp.decision_status = 'accepted'
  JOIN public.source_records sr
    ON sr.id = cp.source_record_id
   AND sr.id = m.source_record_id
   AND sr.processing_status = 'published'
  JOIN public.source_feeds sf
    ON sf.id = sr.source_feed_id
   AND sf.id = m.source_feed_id
   AND sf.is_active IS TRUE
  JOIN public.source_systems ss
    ON ss.id = sf.source_system_id
   AND ss.id = m.source_system_id
   AND ss.id = cs.winning_source_system_id
   AND ss.is_active IS TRUE
   AND ss.trust_tier = 'verified_publisher'
   AND ss.resource_purpose IN ('service_catalog', 'program_navigation')
  WHERE m.batch_id = v_batch_id
    AND cs.published_service_id = m.service_id
    AND cs.status = 'active'
    AND cs.lifecycle_status = 'active'
    AND cs.publication_status = 'published'
    AND cs.last_refreshed_at IS NOT NULL;

  IF p_expected_status = 'applied' THEN
    SELECT count(*) INTO v_invalid
    FROM oran_internal.hotline_authority_members m
    JOIN public.source_systems ss ON ss.id = m.source_system_id
    JOIN public.source_feeds sf ON sf.id = m.source_feed_id
    JOIN public.source_records sr ON sr.id = m.source_record_id
    JOIN public.canonical_organizations co ON co.id = m.canonical_organization_id
    JOIN public.canonical_services cs ON cs.id = m.canonical_service_id
    WHERE m.batch_id = v_batch_id
      AND (
        ss.is_active IS NOT TRUE
        OR sf.is_active IS NOT TRUE
        OR sr.processing_status <> 'published'
        OR co.lifecycle_status <> 'active'
        OR co.publication_status <> 'published'
        OR co.published_organization_id IS DISTINCT FROM m.organization_id
        OR co.winning_source_system_id IS DISTINCT FROM m.source_system_id
        OR cs.lifecycle_status <> 'active'
        OR cs.publication_status <> 'published'
        OR cs.published_service_id IS DISTINCT FROM m.service_id
        OR cs.winning_source_system_id IS DISTINCT FROM m.source_system_id
      );

    IF v_invalid <> 0 THEN
      RAISE EXCEPTION 'hotline applied authority-path drift: % members', v_invalid;
    END IF;

    IF v_authorized <> 13 THEN
      RAISE EXCEPTION 'hotline authority count drift: expected 13, found %', v_authorized;
    END IF;
  ELSE
    SELECT count(*) INTO v_invalid
    FROM oran_internal.hotline_authority_members m
    JOIN public.source_systems ss ON ss.id = m.source_system_id
    JOIN public.source_feeds sf ON sf.id = m.source_feed_id
    JOIN public.canonical_organizations co ON co.id = m.canonical_organization_id
    JOIN public.canonical_services cs ON cs.id = m.canonical_service_id
    WHERE m.batch_id = v_batch_id
      AND (
        ss.is_active IS NOT FALSE
        OR sf.is_active IS NOT FALSE
        OR co.publication_status <> 'retracted'
        OR cs.publication_status <> 'retracted'
      );

    IF v_invalid <> 0 THEN
      RAISE EXCEPTION 'hotline deactivated authority-path drift: % members', v_invalid;
    END IF;

    IF v_authorized <> 0 THEN
      RAISE EXCEPTION 'deactivated hotline authority still publishes % services', v_authorized;
    END IF;
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'batch', v_slug,
    'status', v_batch_status,
    'services', 13,
    'phones', 26,
    'quarantinedContacts', 1,
    'addedContacts', 4,
    'acceptedProvenance', 92,
    'authorizedServices', v_authorized
  );

  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.deactivate_verified_hotline_authority()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_slug constant text := 'verified-national-hotlines-2026-07-13';
  v_batch_id uuid;
  v_status text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_member_count bigint;
  v_remaining_paths bigint;
  v_authorized bigint;
  v_services_retracted integer := 0;
  v_organizations_retracted integer := 0;
  v_feeds_disabled integer := 0;
  v_systems_disabled integer := 0;
  v_summary jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oran:authority:verified-national-hotlines-2026-07-13', 0)
  );

  SELECT b.id, b.status
  INTO v_batch_id, v_status
  FROM oran_internal.hotline_authority_batches b
  WHERE b.slug = v_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hotline authority batch % was not found', v_slug;
  END IF;

  -- Containment intentionally does not run the full fact/provenance assertion.
  -- A changed description, contact, hash, or even a missing related row must
  -- never prevent the emergency brake from disabling every extant authority
  -- component identified by the immutable batch membership IDs.
  UPDATE public.canonical_services cs
  SET publication_status = 'retracted',
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND cs.id = m.canonical_service_id
    AND cs.publication_status IS DISTINCT FROM 'retracted';
  GET DIAGNOSTICS v_services_retracted = ROW_COUNT;

  UPDATE public.canonical_organizations co
  SET publication_status = 'retracted',
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND co.id = m.canonical_organization_id
    AND co.publication_status IS DISTINCT FROM 'retracted';
  GET DIAGNOSTICS v_organizations_retracted = ROW_COUNT;

  UPDATE public.source_feeds sf
  SET is_active = false,
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND sf.id = m.source_feed_id
    AND sf.is_active IS DISTINCT FROM false;
  GET DIAGNOSTICS v_feeds_disabled = ROW_COUNT;

  UPDATE public.source_systems ss
  SET is_active = false,
      updated_at = v_now
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id
    AND ss.id = m.source_system_id
    AND ss.is_active IS DISTINCT FROM false;
  GET DIAGNOSTICS v_systems_disabled = ROW_COUNT;

  -- Missing related rows are already fail-closed. Any extant component must be
  -- independently contained so later changes cannot revive this authority path
  -- by toggling only one table.
  SELECT count(*) INTO v_remaining_paths
  FROM oran_internal.hotline_authority_members m
  LEFT JOIN public.source_systems ss ON ss.id = m.source_system_id
  LEFT JOIN public.source_feeds sf ON sf.id = m.source_feed_id
  LEFT JOIN public.canonical_organizations co ON co.id = m.canonical_organization_id
  LEFT JOIN public.canonical_services cs ON cs.id = m.canonical_service_id
  WHERE m.batch_id = v_batch_id
    AND (
      (ss.id IS NOT NULL AND ss.is_active IS TRUE)
      OR (sf.id IS NOT NULL AND sf.is_active IS TRUE)
      OR (
        co.id IS NOT NULL
        AND co.publication_status IS DISTINCT FROM 'retracted'
      )
      OR (
        cs.id IS NOT NULL
        AND cs.publication_status IS DISTINCT FROM 'retracted'
      )
    );

  IF v_remaining_paths <> 0 THEN
    RAISE EXCEPTION
      'hotline containment failed: % member paths retain an active component',
      v_remaining_paths;
  END IF;

  SELECT count(DISTINCT cs.published_service_id) INTO v_authorized
  FROM oran_internal.hotline_authority_members m
  JOIN public.canonical_services cs
    ON cs.id = m.canonical_service_id
  JOIN public.canonical_provenance cp
    ON cp.canonical_entity_type = 'service'
   AND cp.canonical_entity_id = cs.id
   AND cp.decision_status = 'accepted'
  JOIN public.source_records sr
    ON sr.id = cp.source_record_id
   AND sr.id = m.source_record_id
   AND sr.processing_status = 'published'
  JOIN public.source_feeds sf
    ON sf.id = sr.source_feed_id
   AND sf.id = m.source_feed_id
   AND sf.is_active IS TRUE
  JOIN public.source_systems ss
    ON ss.id = sf.source_system_id
   AND ss.id = m.source_system_id
   AND ss.id = cs.winning_source_system_id
   AND ss.is_active IS TRUE
   AND ss.trust_tier = 'verified_publisher'
   AND ss.resource_purpose IN ('service_catalog', 'program_navigation')
  WHERE m.batch_id = v_batch_id
    AND cs.published_service_id = m.service_id
    AND cs.status = 'active'
    AND cs.lifecycle_status = 'active'
    AND cs.publication_status = 'published'
    AND cs.last_refreshed_at IS NOT NULL;

  IF v_authorized <> 0 THEN
    RAISE EXCEPTION 'hotline containment failed: % services remain authorized', v_authorized;
  END IF;

  SELECT count(*) INTO v_member_count
  FROM oran_internal.hotline_authority_members m
  WHERE m.batch_id = v_batch_id;

  v_summary := pg_catalog.jsonb_build_object(
    'batch', v_slug,
    'status', 'deactivated',
    'previousStatus', v_status,
    'membersContained', v_member_count,
    'authorizedServices', v_authorized,
    'containmentChanges', pg_catalog.jsonb_build_object(
      'servicesRetracted', v_services_retracted,
      'organizationsRetracted', v_organizations_retracted,
      'feedsDisabled', v_feeds_disabled,
      'systemsDisabled', v_systems_disabled
    ),
    'containedAt', v_now
  );

  UPDATE oran_internal.hotline_authority_batches b
  SET status = 'deactivated',
      deactivated_at = COALESCE(b.deactivated_at, v_now),
      validation_summary = v_summary
  WHERE b.id = v_batch_id;

  RETURN v_summary;
END
$function$;

CREATE OR REPLACE FUNCTION oran_internal.protect_verified_hotline_source_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM oran_internal.hotline_authority_members m
    WHERE m.source_record_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'verified hotline source record % is immutable; append a superseding assertion instead',
      OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION oran_internal.hotline_service_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.hotline_organization_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.hotline_phone_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.assert_verified_hotline_authority(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.apply_verified_hotline_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.deactivate_verified_hotline_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION oran_internal.protect_verified_hotline_source_records() FROM PUBLIC;

COMMENT ON TABLE oran_internal.hotline_authority_batches IS
  'Audited activation/deactivation batches for verified nationwide hotline authority.';
COMMENT ON TABLE oran_internal.hotline_authority_members IS
  'Exact live IDs, generated authority IDs, and before/after snapshots for each hotline.';
COMMENT ON TABLE oran_internal.hotline_quarantined_contacts IS
  'Verbatim contacts removed from seeker publication because current primary authority did not verify them.';
COMMENT ON FUNCTION oran_internal.assert_verified_hotline_authority(text) IS
  'Read-only, fail-loud verification of hotline facts, hashes, provenance, contacts, and publication authority.';
COMMENT ON FUNCTION oran_internal.deactivate_verified_hotline_authority() IS
  'Emergency rollback of hotline publication authority; retains corrected facts and all audit evidence.';
COMMENT ON FUNCTION oran_internal.protect_verified_hotline_source_records() IS
  'Prevents mutation or deletion of the verified hotline assertions; corrections must be append-only.';

SELECT oran_internal.apply_verified_hotline_authority();

DROP TRIGGER IF EXISTS trg_protect_verified_hotline_source_records
  ON public.source_records;

CREATE TRIGGER trg_protect_verified_hotline_source_records
  BEFORE UPDATE OR DELETE ON public.source_records
  FOR EACH ROW
  EXECUTE FUNCTION oran_internal.protect_verified_hotline_source_records();

DO $do$
DECLARE
  v_exact_trigger_count bigint;
BEGIN
  SELECT count(*) INTO v_exact_trigger_count
  FROM pg_catalog.pg_trigger t
  WHERE t.tgname = 'trg_protect_verified_hotline_source_records'
    AND t.tgrelid = 'public.source_records'::pg_catalog.regclass
    AND t.tgfoid =
      'oran_internal.protect_verified_hotline_source_records()'::pg_catalog.regprocedure
    AND t.tgtype = 27
    AND t.tgenabled = 'O'
    AND t.tgisinternal IS FALSE
    AND t.tgnargs = 0
    AND t.tgqual IS NULL
    AND t.tgparentid = 0;

  IF v_exact_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'verified hotline immutability trigger definition drift: expected 1 exact trigger, found %',
      v_exact_trigger_count;
  END IF;
END
$do$;

-- Assert the applied state only where the batch actually ran. On a greenfield
-- database the apply above is a no-op (no hotline import), so there is no batch
-- to assert and demanding one would abort the migration. Where a batch exists
-- the original full assertion runs unchanged.
DO $do$
DECLARE
  v_slug constant text := 'verified-national-hotlines-2026-07-13';
  v_batch_exists boolean;
  v_hotline_services bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM oran_internal.hotline_authority_batches b WHERE b.slug = v_slug
  ) INTO v_batch_exists;

  IF v_batch_exists THEN
    PERFORM oran_internal.assert_verified_hotline_authority('applied');
    RETURN;
  END IF;

  -- No batch. That is only legitimate when the hotline import has never run;
  -- any other cause is real drift and must not pass silently.
  SELECT count(*) INTO v_hotline_services
  FROM public.services s
  WHERE s.created_by_user_id = 'import:hotline';

  IF v_hotline_services <> 0 THEN
    RAISE EXCEPTION
      'hotline authority batch % is absent while % import:hotline services exist',
      v_slug,
      v_hotline_services;
  END IF;

  RAISE NOTICE
    'verified hotline authority skipped: no import:hotline services present. Run the hotline import, then re-run oran_internal.apply_verified_hotline_authority().';
END
$do$;

COMMIT;
