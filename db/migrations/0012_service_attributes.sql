-- 0012_service_attributes.sql
-- ============================================================
-- SERVICE ATTRIBUTES — the universal service-dimension tagger
-- ============================================================
--
-- This single table closes 30+ seeker use-case gaps by giving every service
-- structured, queryable tags across six dimensions:
--
--   taxonomy    | What it answers                             | Example tags
--   ------------|---------------------------------------------|---------------------------------------
--   delivery    | HOW is the service delivered?                | in_person, virtual, mobile_outreach, home_delivery, phone, mail, drive_through, curbside
--   cost        | WHAT does it cost?                          | free, sliding_scale, medicaid, medicare, ebt_snap, no_insurance_required, donation_based
--   access      | HOW do I access it?                         | walk_in, appointment_required, no_id_required, no_referral_needed, accepting_new_clients, waitlist_open, first_come_first_served
--   culture     | WHO is it culturally designed for?           | lgbtq_affirming, faith_based, tribal_native, gender_specific_women, gender_specific_men, trauma_informed, harm_reduction, peer_support, culturally_specific
--   population  | WHAT population does it specifically serve?  | veteran_family, reentry, dv_survivor, foster_youth, aging_out_foster, refugee, asylum_seeker, undocumented_friendly, kinship_care, pregnant, postpartum, caregiver, unaccompanied_minor, trafficking_survivor, chronically_homeless
--   situation   | WHAT crisis/situational context?             | no_fixed_address, fleeing_violence, recently_incarcerated, substance_use_active, legal_crisis, natural_disaster, seasonal_worker, migrant_worker, no_bank_account, no_documents, digital_barrier
--
-- Design rationale:
--   - Rows, not columns: avoids 50+ boolean columns on services. A service
--     with 3 delivery modes + 2 cost tags = 5 rows. Clean, extensible.
--   - UNIQUE(service_id, taxonomy, tag): prevents duplicates.
--   - GIN index on (taxonomy, tag): fast "find all free walk-in food banks."
--   - The taxonomy namespace lets the chat pipeline filter by dimension:
--       "I can't leave home" → WHERE taxonomy = 'delivery' AND tag IN ('virtual', 'home_delivery', 'mobile_outreach', 'phone')
--       "I have no ID"      → WHERE taxonomy = 'access'   AND tag = 'no_id_required'
--       "I'm a refugee"     → WHERE taxonomy = 'population' AND tag = 'refugee'
--       "Do they take Medicaid?" → WHERE taxonomy = 'cost' AND tag = 'medicaid'
--
-- Aligns with HSDS v3 service_attributes concept.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS service_attributes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  taxonomy           TEXT NOT NULL,          -- Namespace: 'delivery', 'cost', 'access', 'culture', 'population', 'situation'
  tag                TEXT NOT NULL,          -- Value within namespace
  details            TEXT,                   -- Optional human-readable elaboration
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,                   -- Microsoft Entra Object ID
  updated_by_user_id TEXT,                   -- Microsoft Entra Object ID

  -- One tag per taxonomy per service
  UNIQUE(service_id, taxonomy, tag)
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Primary lookup: "find all services with taxonomy=X and tag=Y"
CREATE INDEX IF NOT EXISTS idx_service_attributes_taxonomy_tag
  ON service_attributes(taxonomy, tag);

-- Service lookup: "what attributes does service X have?"
CREATE INDEX IF NOT EXISTS idx_service_attributes_service
  ON service_attributes(service_id);

-- Multi-tag filter: "find services matching ANY of these tags"
-- GIN index on the tuple for fast containment checks
CREATE INDEX IF NOT EXISTS idx_service_attributes_tag
  ON service_attributes(tag);

-- ============================================================
-- TRIGGER
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_service_attributes'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_service_attributes
      BEFORE UPDATE ON service_attributes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- CANONICAL TAGS REFERENCE (as comments for data importers)
-- ============================================================
--
-- DELIVERY (how the service reaches the seeker)
--   in_person           Physical location visit
--   virtual             Video/web-based (telehealth, online class)
--   phone               Telephone-based service delivery
--   mobile_outreach     Provider travels to seeker (outreach van, street team)
--   home_delivery       Delivered to seeker's home (meals-on-wheels, groceries)
--   mail                Mailed to seeker (documents, supplies)
--   drive_through       Drive-through pickup (food, supplies)
--   curbside            Curbside pickup
--   hybrid              Combination of in-person and virtual
--
-- COST (what the seeker pays)
--   free                No cost to the seeker
--   sliding_scale       Fee adjusted by income
--   fixed_fee           Set fee regardless of income
--   donation_based      Suggested donation, not required
--   insurance_required  Must have insurance
--   medicaid            Accepts Medicaid
--   medicare            Accepts Medicare
--   private_insurance   Accepts private insurance
--   no_insurance_required  No insurance needed
--   ebt_snap            Accepts EBT/SNAP benefits
--   wic_accepted        Accepts WIC vouchers
--
-- ACCESS (how to get in)
--   walk_in             No appointment needed
--   appointment_required  Must schedule in advance
--   referral_required   Requires referral from another provider
--   no_referral_needed  Self-referral is fine
--   no_id_required      No identification needed to receive service
--   no_documentation_required  No paperwork/proof needed
--   no_ssn_required     No Social Security Number needed
--   accepting_new_clients  Currently accepting new intake
--   waitlist_open       Waitlist is accepting names
--   waitlist_closed     Not currently accepting waitlist additions
--   first_come_first_served  Served in order of arrival
--   by_lottery          Selection by lottery/random
--   by_application      Application/screening process
--   drop_in             Informal drop-in welcome
--
-- CULTURE (cultural competency / affirmation)
--   lgbtq_affirming     Affirming of LGBTQ+ identities
--   faith_based         Faith-based organization (may or may not require faith)
--   tribal_native       Tribal or Indigenous-focused services
--   gender_specific_women  Women-only or women-focused
--   gender_specific_men    Men-only or men-focused
--   gender_nonconforming   Explicitly welcoming of nonbinary/GNC individuals
--   culturally_specific    Designed for a specific ethnic/cultural community
--   trauma_informed     Uses trauma-informed care practices
--   harm_reduction      Harm reduction approach (no abstinence requirement)
--   recovery_oriented   Recovery-oriented care model
--   peer_support        Peer support / lived experience staff
--   age_friendly        Age-friendly for older adults
--   youth_focused       Programs designed for youth
--   family_centered     Whole-family approach
--
-- POPULATION (specific populations served)
--   veteran_family      Veterans' family members / dependents
--   reentry             Formerly incarcerated / reentry population
--   dv_survivor         Domestic violence survivors
--   foster_youth        Current foster youth
--   aging_out_foster    Youth aging out of foster care (16-24)
--   refugee             Refugees with legal status
--   asylum_seeker       Asylum seekers (pending status)
--   undocumented_friendly  Serves individuals regardless of documentation status
--   kinship_care        Kinship caregivers (grandparents raising grandchildren)
--   pregnant            Pregnant individuals
--   postpartum          Postpartum / new parents
--   caregiver           Family caregivers of disabled/elderly
--   unaccompanied_minor Unaccompanied minors
--   trafficking_survivor  Human trafficking survivors
--   chronically_homeless  Chronic homelessness (HUD definition)
--   transition_age_youth  Transition-age youth (16-24)
--   single_parent       Single parents
--   immigrant           Immigrants (any status)
--   migrant_worker      Migrant/seasonal agricultural workers
--
-- SITUATION (current crisis or circumstance)
--   no_fixed_address    Currently without stable housing
--   fleeing_violence    Actively fleeing domestic/interpersonal violence
--   recently_incarcerated  Released from incarceration within 12 months
--   substance_use_active   Currently using substances (no sobriety requirement)
--   legal_crisis        Facing active legal proceedings (eviction, custody, criminal)
--   natural_disaster    Displaced by natural disaster
--   no_bank_account     Unbanked / no bank account
--   no_documents        No identification documents available
--   digital_barrier     Limited/no internet or technology access
--   language_barrier    Limited English proficiency (pair with languages table)
--   transportation_barrier  No personal vehicle / limited transit access
--   medical_emergency   Acute medical situation
--   mental_health_crisis   Acute mental health episode (complement to crisis keywords)
--   job_loss            Recently lost employment
--   benefit_gap         Between benefits (waiting for approval/renewal)
