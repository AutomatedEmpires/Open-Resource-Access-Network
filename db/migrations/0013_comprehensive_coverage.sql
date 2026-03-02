-- 0013_comprehensive_coverage.sql
-- ============================================================
-- COMPREHENSIVE SCHEMA COVERAGE
-- ============================================================
-- This migration closes ALL remaining use-case gaps identified from
-- 105 seeker scenarios stress-testing the schema.
--
-- Changes in this migration:
-- 1. eligibility: household_size_min/max columns
-- 2. services: estimated_wait_days, capacity_status columns
-- 3. locations: transit_access, parking_available columns
-- 4. service_attributes: expanded canonical tags (see comments at end)
-- 5. service_adaptations: NEW table for service-level disability/health adaptations
-- 6. dietary_options: NEW table for food-related services
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- 1. ELIGIBILITY: Household size constraints
-- ============================================================
-- Allows matching "family of 6" to services that can handle large households.
-- NULL = no limit.

ALTER TABLE eligibility
  ADD COLUMN IF NOT EXISTS household_size_min INT,
  ADD COLUMN IF NOT EXISTS household_size_max INT;

-- ============================================================
-- 2. SERVICES: Wait time and capacity indicators
-- ============================================================
-- Answers "How long is the wait?" and "Are they full?"

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS estimated_wait_days INT,
  ADD COLUMN IF NOT EXISTS capacity_status TEXT DEFAULT 'available';

-- Add CHECK constraint for capacity_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'services_capacity_status_check'
      AND conrelid = 'services'::regclass
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_capacity_status_check
      CHECK (capacity_status IN ('available', 'limited', 'waitlist', 'closed'));
  END IF;
END $$;

-- Index for filtering by capacity
CREATE INDEX IF NOT EXISTS idx_services_capacity_status
  ON services(capacity_status);

-- ============================================================
-- 3. LOCATIONS: Transit and parking
-- ============================================================
-- Answers "Is it on a bus line?" and "Do they have parking?"

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS transit_access TEXT[],
  ADD COLUMN IF NOT EXISTS parking_available TEXT DEFAULT 'unknown';

-- Add CHECK constraint for parking_available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_parking_check'
      AND conrelid = 'locations'::regclass
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_parking_check
      CHECK (parking_available IN ('yes', 'no', 'street_only', 'paid', 'unknown'));
  END IF;
END $$;

-- GIN index on transit_access array for tag-based filtering
CREATE INDEX IF NOT EXISTS idx_locations_transit_access
  ON locations USING gin(transit_access);

-- ============================================================
-- 4. SERVICE ADAPTATIONS (NEW TABLE)
-- ============================================================
-- Service-level disability/health adaptations — distinct from LOCATION
-- accessibility which is about physical access to the building.
--
-- Examples:
--   - "This counseling service specializes in autism"
--   - "This job training program accommodates deaf participants"
--   - "This after-school program has staff trained for blind children"
--   - "This clinic has experience with HIV case management"
--
-- This answers: "My child has autism and needs ABA therapy",
--               "I'm HIV positive and need case management"

CREATE TABLE IF NOT EXISTS service_adaptations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  adaptation_type    TEXT NOT NULL,          -- Namespace: 'disability', 'health_condition', 'age_group', 'learning'
  adaptation_tag     TEXT NOT NULL,          -- Tag within namespace
  details            TEXT,                   -- Human-readable description of the adaptation
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,

  UNIQUE(service_id, adaptation_type, adaptation_tag)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_service_adaptations_service
  ON service_adaptations(service_id);

CREATE INDEX IF NOT EXISTS idx_service_adaptations_type_tag
  ON service_adaptations(adaptation_type, adaptation_tag);

CREATE INDEX IF NOT EXISTS idx_service_adaptations_tag
  ON service_adaptations(adaptation_tag);

-- Trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_service_adaptations'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_service_adaptations
      BEFORE UPDATE ON service_adaptations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 5. DIETARY OPTIONS (NEW TABLE)
-- ============================================================
-- For food assistance services: what dietary restrictions can they accommodate?
-- Answers: "I need halal food", "I'm vegan", "I need kosher meals"
--
-- Separate table (not service_attributes) because:
-- 1. Only applies to food services
-- 2. May need quantity/availability detail
-- 3. Cleaner querying for food-specific searches

CREATE TABLE IF NOT EXISTS dietary_options (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  dietary_type       TEXT NOT NULL,          -- 'halal', 'kosher', 'vegan', 'vegetarian', 'gluten_free',
                                             -- 'dairy_free', 'nut_free', 'diabetic_friendly', 'low_sodium', 'other'
  availability       TEXT DEFAULT 'always',  -- 'always', 'by_request', 'limited', 'seasonal'
  details            TEXT,                   -- e.g., "Halal meat donated weekly by local mosque"
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,

  UNIQUE(service_id, dietary_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dietary_options_service
  ON dietary_options(service_id);

CREATE INDEX IF NOT EXISTS idx_dietary_options_type
  ON dietary_options(dietary_type);

-- Trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_dietary_options'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_dietary_options
      BEFORE UPDATE ON dietary_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- CANONICAL TAGS REFERENCE (for data importers & chat pipeline)
-- ============================================================
-- These extend the service_attributes taxonomy from 0012.

-- ============================================================
-- SERVICE_ADAPTATIONS canonical tags:
-- ============================================================
--
-- ADAPTATION_TYPE: 'disability'
--   blind                 Services adapted for blind/low vision
--   deaf                  Services adapted for deaf/hard of hearing (ASL, CART)
--   mobility_impaired     Services adapted for mobility impairments
--   cognitive             Services adapted for cognitive disabilities
--   autism                Services specializing in autism spectrum
--   developmental         Services for developmental disabilities
--   learning              Services adapted for learning disabilities
--   speech                Services adapted for speech/language impairments
--   mental_health         Services specialized for serious mental illness
--   traumatic_brain_injury Services adapted for TBI
--   spinal_cord_injury    Services adapted for SCI
--   multiple_disabilities Services for individuals with multiple disabilities
--
-- ADAPTATION_TYPE: 'health_condition'
--   hiv_aids              HIV/AIDS-specialized services
--   diabetes              Diabetes management support
--   cancer                Cancer patient services
--   dialysis              Dialysis-related services
--   heart_disease         Heart disease support
--   respiratory           Respiratory condition support (COPD, asthma)
--   alzheimers_dementia   Dementia/Alzheimer's specialized
--   stroke_recovery       Stroke recovery services
--   chronic_pain          Chronic pain management
--   substance_use         Substance use disorder treatment
--   eating_disorder       Eating disorder treatment
--   pregnancy_complications High-risk pregnancy support
--   maternal_health       Maternal/postpartum health focus
--   terminal_illness      Palliative/hospice care
--
-- ADAPTATION_TYPE: 'age_group'
--   infant                Birth to 12 months
--   toddler               1-3 years
--   preschool             3-5 years
--   school_age            6-12 years
--   teen                  13-17 years
--   young_adult           18-24 years
--   adult                 25-54 years
--   older_adult           55-64 years
--   senior                65+ years
--   elderly               75+ years
--
-- ADAPTATION_TYPE: 'learning'
--   esl                   English as Second Language instruction adapted
--   low_literacy          Adapted for low literacy levels
--   non_reader            Adapted for non-readers (oral, visual)
--   visual_learner        Visual teaching methods
--   hands_on              Hands-on/kinesthetic learning

-- ============================================================
-- ADDITIONAL SERVICE_ATTRIBUTES tags (extend 0012):
-- ============================================================
--
-- POPULATION (additions to 0012 list)
--   foster_parent         Foster parents (not foster youth)
--   adoptive_parent       Adoptive parents
--   daca                  DACA recipients
--   tps                   Temporary Protected Status holders
--   veteran_survivor      Veterans' surviving spouses/family (Gold Star)
--   juvenile_reentry      Youth exiting juvenile detention
--   sex_worker            Current/former sex workers
--   homeless_youth        Unaccompanied homeless youth (specific to RHY programs)
--   emancipated_minor     Legally emancipated minors
--   pregnant_teen         Pregnant teenagers (specific programs)
--   parenting_teen        Teen parents
--   incarcerated_parent   Parents of incarcerated individuals
--   child_of_incarcerated Children with incarcerated parent
--   military_family       Active duty military family
--   national_guard        National Guard / Reserve members
--   first_responder       First responders (firefighters, EMTs, police)
--   essential_worker      Essential workers (pandemic-era programs)
--   farmworker            Agricultural workers
--   commercial_driver     Commercial drivers (CDL holders)
--
-- SITUATION (additions to 0012 list)
--   custody_dispute       In active custody proceedings
--   deportation_risk      Facing deportation/removal proceedings
--   child_welfare_case    Active CPS/child welfare involvement
--   domestic_court        In domestic relations court
--   bankruptcy            Filing or in bankruptcy
--   foreclosure           Facing home foreclosure
--   wage_garnishment      Wages being garnished
--   identity_theft        Victim of identity theft
--   scam_victim           Victim of financial scam
--   stalking              Being stalked
--   elder_abuse           Victim of elder abuse
--   exploitation          Financial or other exploitation
--   coercive_control      Fleeing coercive control/cult
--   human_trafficking_risk At risk of trafficking (prevention)
--   self_employment_loss  Lost self-employment/business
--   medical_debt          Facing medical debt crisis
--   student_debt          Student loan crisis
--   eviction_history      Past eviction on record (barrier to housing)
--   criminal_record       Criminal record (barrier to employment/housing)
--   sex_offender_registry On sex offender registry (housing barriers)
--
-- ACCESS (additions to 0012 list)
--   24_7                  Available 24 hours, 7 days
--   same_day              Same-day service available
--   next_day              Next-day appointments available
--   childcare_available   On-site childcare during service
--   form_assistance       Staff will help complete paperwork
--   navigator_available   Benefits navigator/case manager on staff
--   interpreter_on_site   Interpreter available on-site (not just phone)
--   notary_available      Notary services available
--   document_assistance   Help obtaining vital documents
--   transportation_provided Service provides transportation
--   home_visit_available  Will do home visits upon request
--   crisis_response       Can respond to crisis situations
--   after_hours           Available after standard business hours
--   weekend_hours         Open on weekends
--   evening_hours         Open evenings (after 5pm)
--   online_application    Can apply/intake fully online
--   mobile_app            Has mobile application
--   text_communication    Can communicate via text/SMS
--
-- CULTURE (additions to 0012 list)
--   spanish_speaking_staff Staff who speak Spanish (not just interpreter)
--   bilingual_services    Fully bilingual service delivery
--   immigrant_friendly    Welcoming to immigrant communities
--   muslim_friendly       Accommodates Muslim practices (prayer times, etc.)
--   jewish_friendly       Accommodates Jewish practices
--   secular               Explicitly non-religious
--   recovery_friendly     Welcoming to those in recovery
--   disability_led        Led by people with disabilities
--   survivor_led          Led by survivors (DV, trafficking, etc.)
--   youth_led             Youth-led programming
--   elder_led             Senior/elder-led programming
--   bipoc_led             BIPOC-led organization
--   indigenous_led        Indigenous-led organization
--   lgbtq_led             LGBTQ+-led organization
--   veteran_led           Veteran-led organization
--   formerly_incarcerated_led Led by formerly incarcerated individuals
--   peer_led              Peer-led services (lived experience)
--   female_provider       Female service providers available
--   male_provider         Male service providers available
--   nonbinary_provider    Nonbinary service providers available
--   provider_choice       Client can choose provider gender
--
-- DELIVERY (additions to 0012 list)
--   street_outreach       Street-based outreach team
--   encampment_services   Services at homeless encampments
--   shelter_based         Services delivered at shelters
--   school_based          Services delivered at schools
--   workplace_based       Services delivered at workplaces
--   church_based          Services delivered at houses of worship
--   hospital_based        Services delivered at hospitals
--   jail_based            Services delivered in jails
--   prison_based          Services delivered in prisons
--   court_based           Services delivered at courthouses
--   library_based         Services delivered at libraries
--   community_center_based Services at community centers
--   pop_up                Pop-up / mobile location services
--   by_mail               Services/goods delivered by mail
--   pickup_available      Can pick up goods/supplies
--   delivery_available    Will deliver to home
--
-- COST (additions to 0012 list)
--   chip                  Accepts CHIP (Children's Health Insurance)
--   tricare               Accepts TRICARE (military)
--   va_benefits           Accepts VA benefits
--   workers_comp          Accepts workers' compensation
--   crime_victim_fund     Accepts crime victim compensation funds
--   grant_funded          Grant-funded (may have eligibility limits)
--   government_funded     Government/public funding
--   privately_funded      Privately funded (foundation/donor)
--   crowdfunded           Crowdfunded or mutual aid
--   pay_what_you_can      Pay what you can model
--   free_for_children     Free for children/minors
--   free_for_seniors      Free for seniors
--   free_for_veterans     Free for veterans
--   income_verified       Requires income verification for sliding scale

-- ============================================================
-- DIETARY_OPTIONS canonical dietary_type values:
-- ============================================================
--   halal                 Halal-certified
--   kosher                Kosher-certified
--   vegan                 Vegan (no animal products)
--   vegetarian            Vegetarian (no meat)
--   gluten_free           Gluten-free options
--   dairy_free            Dairy-free options
--   nut_free              Nut-free (allergen safe)
--   shellfish_free        Shellfish-free (allergen safe)
--   soy_free              Soy-free options
--   egg_free              Egg-free options
--   diabetic_friendly     Low sugar / diabetic-appropriate
--   low_sodium            Low sodium options
--   heart_healthy         Heart-healthy options
--   renal_friendly        Kidney-friendly (low potassium/phosphorus)
--   soft_foods            Soft/pureed foods (dental/swallowing issues)
--   baby_food             Baby food / infant formula
--   toddler_friendly      Toddler-appropriate foods
--   culturally_appropriate Ethnically/culturally appropriate foods
--   organic               Organic options
--   locally_sourced       Locally sourced produce
--   fresh_produce         Fresh fruits and vegetables
--   shelf_stable          Shelf-stable / non-perishable only
--   hot_meals             Hot prepared meals
--   cold_meals            Cold/refrigerated meals (boxed lunches)
--   groceries             Grocery items (not prepared meals)
--   supplements           Nutritional supplements (Ensure, etc.)
--   pet_food              Pet food available

-- ============================================================
-- TRANSIT_ACCESS canonical values (array on locations):
-- ============================================================
--   bus_stop_nearby       Bus stop within 1/4 mile
--   bus_route_direct      Direct bus route to location
--   subway_nearby         Subway/metro station nearby
--   light_rail_nearby     Light rail station nearby
--   commuter_rail_nearby  Commuter rail station nearby
--   ferry_nearby          Ferry terminal nearby
--   bike_share_nearby     Bike share station nearby
--   scooter_share_nearby  Scooter share available
--   ride_share_accessible Easy ride share pickup (Uber/Lyft)
--   paratransit_accessible Paratransit can access location
--   walkable              Walkable from transit
--   bike_friendly         Bike racks / bike-friendly access
--   ada_transit           ADA-accessible transit stop nearby
