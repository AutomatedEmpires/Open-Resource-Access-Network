/**
 * ORAN Service Taxonomy — Machine-Readable SSOT
 *
 * This file is the SINGLE SOURCE OF TRUTH for all valid tags used in:
 * - service_attributes (6 dimensions)
 * - service_adaptations (4 types)
 * - dietary_options
 * - transit_access
 * - capacity_status
 * - parking_available
 *
 * Used by:
 * 1. LLM ingestion agents to classify incoming resources
 * 2. Host Portal UI to show valid tagging options
 * 3. Search engine to validate query parameters
 * 4. Import validation scripts
 *
 * IMPORTANT: When adding new tags, add them here FIRST, then update the
 * relevant migration if needed for DB constraints.
 */

// ============================================================
// SERVICE ATTRIBUTES — 6 Taxonomy Dimensions
// ============================================================

export interface TaxonomyTag {
  tag: string;
  description: string;
  examples?: string[];
  /** If true, this tag is commonly used and should be suggested prominently */
  common?: boolean;
}

export interface TaxonomyDefinition {
  /** Human-readable name of the taxonomy */
  name: string;
  /** What question does this taxonomy answer? */
  question: string;
  /** Description for hosts/LLM agents */
  guidance: string;
  /** Valid tags in this taxonomy */
  tags: TaxonomyTag[];
}

export const SERVICE_ATTRIBUTES_TAXONOMY: Record<string, TaxonomyDefinition> = {
  // ============================================================
  // DELIVERY — How is the service delivered?
  // ============================================================
  delivery: {
    name: 'Delivery Method',
    question: 'HOW does your service reach clients?',
    guidance: 'Select all methods by which clients can receive this service. Most services have 1-3 delivery methods.',
    tags: [
      { tag: 'in_person', description: 'Client visits a physical location', common: true },
      { tag: 'virtual', description: 'Video/web-based delivery (telehealth, Zoom, online portal)', common: true },
      { tag: 'phone', description: 'Service delivered primarily by telephone', common: true },
      { tag: 'mobile_outreach', description: 'Provider travels to client (outreach van, street team)' },
      { tag: 'home_delivery', description: 'Goods/services delivered to client home (meals-on-wheels)', common: true },
      { tag: 'mail', description: 'Items mailed to client (documents, supplies, medication)' },
      { tag: 'drive_through', description: 'Drive-through pickup point' },
      { tag: 'curbside', description: 'Curbside pickup available' },
      { tag: 'hybrid', description: 'Flexible combination of in-person and virtual' },
      { tag: 'street_outreach', description: 'Street-based outreach team finds clients where they are' },
      { tag: 'encampment_services', description: 'Services delivered at homeless encampments' },
      { tag: 'shelter_based', description: 'Services delivered within shelters' },
      { tag: 'school_based', description: 'Services delivered at schools (counseling, health)' },
      { tag: 'workplace_based', description: 'Services delivered at workplaces' },
      { tag: 'church_based', description: 'Services delivered at houses of worship' },
      { tag: 'hospital_based', description: 'Services delivered at hospitals' },
      { tag: 'jail_based', description: 'Services delivered in jails/detention facilities' },
      { tag: 'prison_based', description: 'Services delivered in prisons' },
      { tag: 'court_based', description: 'Services delivered at courthouses' },
      { tag: 'library_based', description: 'Services delivered at libraries' },
      { tag: 'community_center_based', description: 'Services at community centers' },
      { tag: 'pop_up', description: 'Pop-up or mobile location (markets, clinics)' },
      { tag: 'pickup_available', description: 'Clients can pick up goods/supplies at location' },
      { tag: 'delivery_available', description: 'Staff will deliver goods to client home' },
    ],
  },

  // ============================================================
  // COST — What does the seeker pay?
  // ============================================================
  cost: {
    name: 'Cost & Payment',
    question: 'WHAT does your service cost and what payment is accepted?',
    guidance: 'Select all that apply. Be specific about what insurance/benefits you accept.',
    tags: [
      { tag: 'free', description: 'No cost to the client', common: true },
      { tag: 'sliding_scale', description: 'Fee adjusted based on income', common: true },
      { tag: 'fixed_fee', description: 'Set fee regardless of income' },
      { tag: 'donation_based', description: 'Suggested donation but not required' },
      { tag: 'insurance_required', description: 'Client must have insurance' },
      { tag: 'medicaid', description: 'Accepts Medicaid', common: true },
      { tag: 'medicare', description: 'Accepts Medicare', common: true },
      { tag: 'private_insurance', description: 'Accepts private insurance', common: true },
      { tag: 'no_insurance_required', description: 'No insurance needed to receive service', common: true },
      { tag: 'ebt_snap', description: 'Accepts EBT/SNAP benefits', common: true },
      { tag: 'wic_accepted', description: 'Accepts WIC vouchers' },
      { tag: 'chip', description: 'Accepts CHIP (Children\'s Health Insurance Program)' },
      { tag: 'tricare', description: 'Accepts TRICARE (military health)' },
      { tag: 'va_benefits', description: 'Accepts VA benefits' },
      { tag: 'workers_comp', description: 'Accepts workers\' compensation' },
      { tag: 'crime_victim_fund', description: 'Accepts crime victim compensation funds' },
      { tag: 'grant_funded', description: 'Grant-funded (may have specific eligibility limits)' },
      { tag: 'government_funded', description: 'Government/public funding' },
      { tag: 'privately_funded', description: 'Privately funded (foundation/donor supported)' },
      { tag: 'crowdfunded', description: 'Crowdfunded or mutual aid funded' },
      { tag: 'pay_what_you_can', description: 'Pay what you can model' },
      { tag: 'free_for_children', description: 'Free for children/minors' },
      { tag: 'free_for_seniors', description: 'Free for seniors (65+)' },
      { tag: 'free_for_veterans', description: 'Free for veterans' },
      { tag: 'income_verified', description: 'Requires income verification for sliding scale' },
    ],
  },

  // ============================================================
  // ACCESS — How to get in / requirements
  // ============================================================
  access: {
    name: 'Access & Intake',
    question: 'HOW can clients access your service? What are the entry requirements?',
    guidance: 'Be honest about barriers. If you require ID or referral, say so. Seekers appreciate transparency.',
    tags: [
      { tag: 'walk_in', description: 'No appointment needed, come any time during hours', common: true },
      { tag: 'appointment_required', description: 'Must schedule in advance', common: true },
      { tag: 'referral_required', description: 'Requires referral from another provider' },
      { tag: 'no_referral_needed', description: 'Self-referral accepted', common: true },
      { tag: 'no_id_required', description: 'No identification needed to receive service', common: true },
      { tag: 'no_documentation_required', description: 'No paperwork/proof of eligibility needed' },
      { tag: 'no_ssn_required', description: 'No Social Security Number required' },
      { tag: 'accepting_new_clients', description: 'Currently accepting new intake', common: true },
      { tag: 'waitlist_open', description: 'Waitlist is accepting names' },
      { tag: 'waitlist_closed', description: 'Not currently accepting waitlist additions' },
      { tag: 'first_come_first_served', description: 'Served in order of arrival' },
      { tag: 'by_lottery', description: 'Selection by lottery/random drawing' },
      { tag: 'by_application', description: 'Application and screening process required' },
      { tag: 'drop_in', description: 'Informal drop-in welcome, no intake process', common: true },
      { tag: '24_7', description: 'Available 24 hours, 7 days a week' },
      { tag: 'same_day', description: 'Same-day service/appointments available' },
      { tag: 'next_day', description: 'Next-day appointments typically available' },
      { tag: 'childcare_available', description: 'On-site childcare available during service' },
      { tag: 'form_assistance', description: 'Staff will help complete paperwork' },
      { tag: 'navigator_available', description: 'Benefits navigator/case manager on staff' },
      { tag: 'interpreter_on_site', description: 'Interpreter available on-site (not just by phone)' },
      { tag: 'notary_available', description: 'Notary services available' },
      { tag: 'document_assistance', description: 'Help obtaining vital documents (birth cert, ID)' },
      { tag: 'transportation_provided', description: 'Service provides transportation to/from' },
      { tag: 'home_visit_available', description: 'Staff will do home visits upon request' },
      { tag: 'crisis_response', description: 'Can respond to crisis situations immediately' },
      { tag: 'after_hours', description: 'Available after standard business hours' },
      { tag: 'weekend_hours', description: 'Open on weekends', common: true },
      { tag: 'evening_hours', description: 'Open evenings (after 5pm)', common: true },
      { tag: 'online_application', description: 'Can apply/intake fully online' },
      { tag: 'mobile_app', description: 'Has mobile application for access' },
      { tag: 'text_communication', description: 'Can communicate via text/SMS' },
    ],
  },

  // ============================================================
  // CULTURE — Cultural competency / affirmation
  // ============================================================
  culture: {
    name: 'Culture & Identity',
    question: 'WHO is your service designed for or affirming of?',
    guidance: 'Select tags that reflect genuine competency or focus. Don\'t claim affirmation you haven\'t earned.',
    tags: [
      { tag: 'lgbtq_affirming', description: 'Affirming of LGBTQ+ identities', common: true },
      { tag: 'faith_based', description: 'Faith-based organization' },
      { tag: 'secular', description: 'Explicitly non-religious' },
      { tag: 'tribal_native', description: 'Tribal or Indigenous-focused services' },
      { tag: 'gender_specific_women', description: 'Women-only or women-focused' },
      { tag: 'gender_specific_men', description: 'Men-only or men-focused' },
      { tag: 'gender_nonconforming', description: 'Explicitly welcoming of nonbinary/GNC individuals' },
      { tag: 'culturally_specific', description: 'Designed for a specific ethnic/cultural community' },
      { tag: 'trauma_informed', description: 'Uses trauma-informed care practices', common: true },
      { tag: 'harm_reduction', description: 'Harm reduction approach (no abstinence requirement)', common: true },
      { tag: 'recovery_oriented', description: 'Recovery-oriented care model' },
      { tag: 'peer_support', description: 'Peer support / lived experience staff', common: true },
      { tag: 'age_friendly', description: 'Age-friendly environment for older adults' },
      { tag: 'youth_focused', description: 'Programs designed specifically for youth' },
      { tag: 'family_centered', description: 'Whole-family approach to services' },
      { tag: 'spanish_speaking_staff', description: 'Staff members who speak Spanish fluently' },
      { tag: 'bilingual_services', description: 'Fully bilingual service delivery available' },
      { tag: 'immigrant_friendly', description: 'Welcoming and safe for immigrant communities' },
      { tag: 'muslim_friendly', description: 'Accommodates Muslim practices (prayer times, halal)' },
      { tag: 'jewish_friendly', description: 'Accommodates Jewish practices (Shabbat, kosher)' },
      { tag: 'recovery_friendly', description: 'Welcoming to those in recovery' },
      { tag: 'disability_led', description: 'Organization led by people with disabilities' },
      { tag: 'survivor_led', description: 'Led by survivors (DV, trafficking, etc.)' },
      { tag: 'youth_led', description: 'Youth-led programming' },
      { tag: 'elder_led', description: 'Senior/elder-led programming' },
      { tag: 'bipoc_led', description: 'BIPOC-led organization' },
      { tag: 'indigenous_led', description: 'Indigenous-led organization' },
      { tag: 'lgbtq_led', description: 'LGBTQ+-led organization' },
      { tag: 'veteran_led', description: 'Veteran-led organization' },
      { tag: 'formerly_incarcerated_led', description: 'Led by formerly incarcerated individuals' },
      { tag: 'peer_led', description: 'Peer-led services (lived experience guides delivery)' },
      { tag: 'female_provider', description: 'Female service providers available upon request' },
      { tag: 'male_provider', description: 'Male service providers available upon request' },
      { tag: 'nonbinary_provider', description: 'Nonbinary service providers available' },
      { tag: 'provider_choice', description: 'Client can choose provider gender/identity' },
    ],
  },

  // ============================================================
  // POPULATION — Specific populations served
  // ============================================================
  population: {
    name: 'Population Focus',
    question: 'WHAT specific populations does your service prioritize or exclusively serve?',
    guidance: 'Select populations you have specific programming for or prioritize. General "open to all" services may have no population tags.',
    tags: [
      { tag: 'veteran_family', description: 'Veterans\' family members / dependents' },
      { tag: 'reentry', description: 'Formerly incarcerated / reentry population', common: true },
      { tag: 'dv_survivor', description: 'Domestic violence survivors', common: true },
      { tag: 'foster_youth', description: 'Current foster youth' },
      { tag: 'aging_out_foster', description: 'Youth aging out of foster care (16-24)' },
      { tag: 'refugee', description: 'Refugees with legal status' },
      { tag: 'asylum_seeker', description: 'Asylum seekers (pending status)' },
      { tag: 'undocumented_friendly', description: 'Serves regardless of documentation status', common: true },
      { tag: 'kinship_care', description: 'Kinship caregivers (grandparents raising grandchildren)' },
      { tag: 'pregnant', description: 'Pregnant individuals', common: true },
      { tag: 'postpartum', description: 'Postpartum / new parents' },
      { tag: 'caregiver', description: 'Family caregivers of disabled/elderly' },
      { tag: 'unaccompanied_minor', description: 'Unaccompanied minors' },
      { tag: 'trafficking_survivor', description: 'Human trafficking survivors' },
      { tag: 'chronically_homeless', description: 'Chronically homeless (HUD definition)' },
      { tag: 'transition_age_youth', description: 'Transition-age youth (16-24)', common: true },
      { tag: 'single_parent', description: 'Single parents' },
      { tag: 'immigrant', description: 'Immigrants (any status)' },
      { tag: 'migrant_worker', description: 'Migrant/seasonal agricultural workers' },
      { tag: 'foster_parent', description: 'Foster parents (not youth)' },
      { tag: 'adoptive_parent', description: 'Adoptive parents' },
      { tag: 'daca', description: 'DACA recipients' },
      { tag: 'tps', description: 'Temporary Protected Status holders' },
      { tag: 'veteran_survivor', description: 'Veterans\' surviving spouses (Gold Star families)' },
      { tag: 'juvenile_reentry', description: 'Youth exiting juvenile detention' },
      { tag: 'sex_worker', description: 'Current/former sex workers' },
      { tag: 'homeless_youth', description: 'Unaccompanied homeless youth (RHY programs)' },
      { tag: 'emancipated_minor', description: 'Legally emancipated minors' },
      { tag: 'pregnant_teen', description: 'Pregnant teenagers' },
      { tag: 'parenting_teen', description: 'Teen parents' },
      { tag: 'incarcerated_parent', description: 'Parents of incarcerated individuals' },
      { tag: 'child_of_incarcerated', description: 'Children with incarcerated parent' },
      { tag: 'military_family', description: 'Active duty military family members' },
      { tag: 'national_guard', description: 'National Guard / Reserve members' },
      { tag: 'first_responder', description: 'First responders (firefighters, EMTs, police)' },
      { tag: 'essential_worker', description: 'Essential workers' },
      { tag: 'farmworker', description: 'Agricultural workers / farmworkers' },
      { tag: 'commercial_driver', description: 'Commercial drivers (CDL holders)' },
    ],
  },

  // ============================================================
  // SITUATION — Current crisis or circumstance
  // ============================================================
  situation: {
    name: 'Situational Context',
    question: 'WHAT crisis situations or circumstances does your service accommodate?',
    guidance: 'These describe barriers or crises your service is designed to handle. If you welcome people in these situations without judgment, tag it.',
    tags: [
      { tag: 'no_fixed_address', description: 'Serves people without stable housing address', common: true },
      { tag: 'fleeing_violence', description: 'Actively fleeing domestic/interpersonal violence', common: true },
      { tag: 'recently_incarcerated', description: 'Released from incarceration within 12 months' },
      { tag: 'substance_use_active', description: 'Currently using substances (no sobriety requirement)', common: true },
      { tag: 'legal_crisis', description: 'Facing active legal proceedings (eviction, custody, criminal)' },
      { tag: 'natural_disaster', description: 'Displaced by natural disaster' },
      { tag: 'no_bank_account', description: 'Unbanked / no bank account' },
      { tag: 'no_documents', description: 'No identification documents available' },
      { tag: 'digital_barrier', description: 'Limited/no internet or technology access' },
      { tag: 'language_barrier', description: 'Limited English proficiency' },
      { tag: 'transportation_barrier', description: 'No personal vehicle / limited transit access', common: true },
      { tag: 'medical_emergency', description: 'Acute medical situation' },
      { tag: 'mental_health_crisis', description: 'Acute mental health episode', common: true },
      { tag: 'job_loss', description: 'Recently lost employment' },
      { tag: 'benefit_gap', description: 'Between benefits (waiting for approval/renewal)' },
      { tag: 'custody_dispute', description: 'In active custody proceedings' },
      { tag: 'deportation_risk', description: 'Facing deportation/removal proceedings' },
      { tag: 'child_welfare_case', description: 'Active CPS/child welfare involvement' },
      { tag: 'domestic_court', description: 'In domestic relations court' },
      { tag: 'bankruptcy', description: 'Filing or in bankruptcy' },
      { tag: 'foreclosure', description: 'Facing home foreclosure' },
      { tag: 'wage_garnishment', description: 'Wages being garnished' },
      { tag: 'identity_theft', description: 'Victim of identity theft' },
      { tag: 'scam_victim', description: 'Victim of financial scam' },
      { tag: 'stalking', description: 'Being stalked' },
      { tag: 'elder_abuse', description: 'Victim of elder abuse' },
      { tag: 'exploitation', description: 'Financial or other exploitation' },
      { tag: 'coercive_control', description: 'Fleeing coercive control/cult' },
      { tag: 'human_trafficking_risk', description: 'At risk of trafficking (prevention)' },
      { tag: 'self_employment_loss', description: 'Lost self-employment/business' },
      { tag: 'medical_debt', description: 'Facing medical debt crisis' },
      { tag: 'student_debt', description: 'Student loan crisis' },
      { tag: 'eviction_history', description: 'Past eviction on record (barrier to housing)' },
      { tag: 'criminal_record', description: 'Criminal record (barrier to employment/housing)' },
      { tag: 'sex_offender_registry', description: 'On sex offender registry (housing barriers)' },
    ],
  },
};

// ============================================================
// SERVICE ADAPTATIONS — 4 Adaptation Types
// ============================================================

export const SERVICE_ADAPTATIONS_TAXONOMY: Record<string, TaxonomyDefinition> = {
  disability: {
    name: 'Disability Accommodations',
    question: 'What disability-related accommodations does your SERVICE provide?',
    guidance: 'This is about the SERVICE delivery being adapted (e.g., ASL interpreter for counseling), NOT physical building access (which goes in location accessibility).',
    tags: [
      { tag: 'deaf', description: 'Service adapted for Deaf/hard of hearing (ASL, captioning)', common: true },
      { tag: 'blind', description: 'Service adapted for blind/low vision (audio, braille, screen readers)', common: true },
      { tag: 'mobility_impaired', description: 'Service accommodates mobility impairments' },
      { tag: 'autism', description: 'Service adapted for autism spectrum (sensory accommodations, communication)' },
      { tag: 'cognitive', description: 'Service adapted for cognitive disabilities (simplified materials, extra time)' },
      { tag: 'mental_health', description: 'Service accommodates mental health conditions' },
      { tag: 'developmental', description: 'Service adapted for developmental disabilities' },
      { tag: 'speech', description: 'Service accommodates speech impairments (AAC devices, text communication)' },
      { tag: 'chronic_illness', description: 'Service accommodates chronic illness (flexible scheduling, breaks)' },
      { tag: 'multiple_disabilities', description: 'Service can accommodate multiple disabilities' },
    ],
  },

  health_condition: {
    name: 'Health Condition Specialization',
    question: 'What health conditions does your service specialize in or accommodate?',
    guidance: 'Select if your service has specific expertise, training, or programming for these conditions.',
    tags: [
      { tag: 'hiv_aids', description: 'HIV/AIDS-specialized services' },
      { tag: 'diabetes', description: 'Diabetes management support', common: true },
      { tag: 'cancer', description: 'Cancer patient services' },
      { tag: 'dialysis', description: 'Dialysis-related services' },
      { tag: 'heart_disease', description: 'Heart disease support' },
      { tag: 'respiratory', description: 'Respiratory conditions (COPD, asthma)' },
      { tag: 'alzheimers_dementia', description: 'Dementia/Alzheimer\'s specialized' },
      { tag: 'stroke_recovery', description: 'Stroke recovery services' },
      { tag: 'chronic_pain', description: 'Chronic pain management' },
      { tag: 'substance_use', description: 'Substance use disorder treatment', common: true },
      { tag: 'eating_disorder', description: 'Eating disorder treatment' },
      { tag: 'pregnancy_complications', description: 'High-risk pregnancy support' },
      { tag: 'maternal_health', description: 'Maternal/postpartum health focus' },
      { tag: 'terminal_illness', description: 'Palliative/hospice care' },
    ],
  },

  age_group: {
    name: 'Age Group Specialization',
    question: 'What age groups does your service specifically accommodate or specialize in?',
    guidance: 'Select if you have age-appropriate programming, not just eligibility. Infant food pantry has different meaning than general food pantry.',
    tags: [
      { tag: 'infant', description: 'Birth to 12 months', common: true },
      { tag: 'toddler', description: '1-3 years', common: true },
      { tag: 'preschool', description: '3-5 years' },
      { tag: 'school_age', description: '6-12 years', common: true },
      { tag: 'teen', description: '13-17 years', common: true },
      { tag: 'young_adult', description: '18-24 years', common: true },
      { tag: 'adult', description: '25-54 years' },
      { tag: 'older_adult', description: '55-64 years' },
      { tag: 'senior', description: '65+ years', common: true },
      { tag: 'elderly', description: '75+ years' },
    ],
  },

  learning: {
    name: 'Learning Accommodations',
    question: 'What learning accommodations does your service provide?',
    guidance: 'Select if your service delivery accommodates different learning needs.',
    tags: [
      { tag: 'esl', description: 'Adapted for English as Second Language learners', common: true },
      { tag: 'low_literacy', description: 'Adapted for low literacy levels' },
      { tag: 'non_reader', description: 'Adapted for non-readers (oral, visual instruction)' },
      { tag: 'visual_learner', description: 'Visual teaching methods available' },
      { tag: 'hands_on', description: 'Hands-on/kinesthetic learning available' },
    ],
  },
};

// ============================================================
// DIETARY OPTIONS
// ============================================================

export const DIETARY_OPTIONS_TAXONOMY: TaxonomyDefinition = {
  name: 'Dietary Options',
  question: 'What dietary restrictions can your food service accommodate?',
  guidance: 'Only for food-related services (food pantries, meal programs, etc.). Select what you can reliably provide.',
  tags: [
    { tag: 'halal', description: 'Halal-certified food available', common: true },
    { tag: 'kosher', description: 'Kosher-certified food available', common: true },
    { tag: 'vegan', description: 'Vegan options (no animal products)', common: true },
    { tag: 'vegetarian', description: 'Vegetarian options (no meat)', common: true },
    { tag: 'gluten_free', description: 'Gluten-free options', common: true },
    { tag: 'dairy_free', description: 'Dairy-free options' },
    { tag: 'nut_free', description: 'Nut-free (allergen safe)' },
    { tag: 'shellfish_free', description: 'Shellfish-free (allergen safe)' },
    { tag: 'soy_free', description: 'Soy-free options' },
    { tag: 'egg_free', description: 'Egg-free options' },
    { tag: 'diabetic_friendly', description: 'Low sugar / diabetic-appropriate', common: true },
    { tag: 'low_sodium', description: 'Low sodium options' },
    { tag: 'heart_healthy', description: 'Heart-healthy options' },
    { tag: 'renal_friendly', description: 'Kidney-friendly (low potassium/phosphorus)' },
    { tag: 'soft_foods', description: 'Soft/pureed foods (dental/swallowing issues)' },
    { tag: 'baby_food', description: 'Baby food / infant formula available', common: true },
    { tag: 'toddler_friendly', description: 'Toddler-appropriate foods' },
    { tag: 'culturally_appropriate', description: 'Ethnically/culturally appropriate foods' },
    { tag: 'organic', description: 'Organic options' },
    { tag: 'locally_sourced', description: 'Locally sourced produce' },
    { tag: 'fresh_produce', description: 'Fresh fruits and vegetables', common: true },
    { tag: 'shelf_stable', description: 'Shelf-stable / non-perishable only' },
    { tag: 'hot_meals', description: 'Hot prepared meals' },
    { tag: 'cold_meals', description: 'Cold/refrigerated meals (boxed lunches)' },
    { tag: 'groceries', description: 'Grocery items (not prepared meals)' },
    { tag: 'supplements', description: 'Nutritional supplements (Ensure, etc.)' },
    { tag: 'pet_food', description: 'Pet food available' },
  ],
};

// ============================================================
// TRANSIT ACCESS (for locations)
// ============================================================

export const TRANSIT_ACCESS_TAXONOMY: TaxonomyDefinition = {
  name: 'Transit Access',
  question: 'What transit options are near your location?',
  guidance: 'Select all transit types within reasonable walking distance of your location.',
  tags: [
    { tag: 'bus_stop_nearby', description: 'Bus stop within 1/4 mile', common: true },
    { tag: 'bus_route_direct', description: 'Direct bus route to location' },
    { tag: 'subway_nearby', description: 'Subway/metro station nearby' },
    { tag: 'light_rail_nearby', description: 'Light rail station nearby' },
    { tag: 'commuter_rail_nearby', description: 'Commuter rail station nearby' },
    { tag: 'ferry_nearby', description: 'Ferry terminal nearby' },
    { tag: 'bike_share_nearby', description: 'Bike share station nearby' },
    { tag: 'scooter_share_nearby', description: 'Scooter share available nearby' },
    { tag: 'ride_share_accessible', description: 'Easy ride share pickup (Uber/Lyft)' },
    { tag: 'paratransit_accessible', description: 'Paratransit can access location', common: true },
    { tag: 'walkable', description: 'Walkable from major transit stops' },
    { tag: 'bike_friendly', description: 'Bike racks / bike-friendly access' },
    { tag: 'ada_transit', description: 'ADA-accessible transit stop nearby' },
  ],
};

// ============================================================
// LOCATION ACCESSIBILITY (from 0010)
// ============================================================

export const LOCATION_ACCESSIBILITY_TAXONOMY: TaxonomyDefinition = {
  name: 'Physical Accessibility',
  question: 'What physical accessibility features does your LOCATION have?',
  guidance: 'This is about the BUILDING/FACILITY access, not service delivery accommodations.',
  tags: [
    { tag: 'wheelchair', description: 'Wheelchair accessible entrance and interior', common: true },
    { tag: 'elevator', description: 'Elevator available' },
    { tag: 'accessible_restroom', description: 'ADA-compliant accessible restroom', common: true },
    { tag: 'accessible_parking', description: 'Accessible parking spaces available', common: true },
    { tag: 'automatic_doors', description: 'Automatic or push-button doors' },
    { tag: 'ramp', description: 'Ramp access available' },
    { tag: 'ground_floor', description: 'Service on ground floor (no stairs required)' },
    { tag: 'service_animals_welcome', description: 'Service animals welcome', common: true },
    { tag: 'braille_signage', description: 'Braille signage available' },
    { tag: 'hearing_loop', description: 'Hearing loop/induction system installed' },
    { tag: 'wide_doorways', description: 'Wide doorways (32"+ clearance)' },
    { tag: 'adjustable_furniture', description: 'Height-adjustable tables/counters' },
    { tag: 'quiet_space', description: 'Quiet/low-stimulation space available' },
    { tag: 'sensory_friendly', description: 'Sensory-friendly environment (lighting, noise)' },
  ],
};

// ============================================================
// CAPACITY STATUS
// ============================================================

export const CAPACITY_STATUS_OPTIONS = [
  { value: 'available', description: 'Currently accepting new clients without significant wait' },
  { value: 'limited', description: 'Accepting clients but availability is limited' },
  { value: 'waitlist', description: 'Accepting waitlist additions, not immediate intake' },
  { value: 'closed', description: 'Not accepting new clients at this time' },
] as const;

// ============================================================
// PARKING OPTIONS
// ============================================================

export const PARKING_OPTIONS = [
  { value: 'yes', description: 'Free parking available on-site' },
  { value: 'no', description: 'No parking available' },
  { value: 'street_only', description: 'Street parking only (no dedicated lot)' },
  { value: 'paid', description: 'Paid parking available' },
  { value: 'unknown', description: 'Parking situation unknown' },
] as const;

// ============================================================
// DIETARY AVAILABILITY
// ============================================================

export const DIETARY_AVAILABILITY_OPTIONS = [
  { value: 'always', description: 'Always available, no advance notice needed' },
  { value: 'by_request', description: 'Available with advance request/notice' },
  { value: 'limited', description: 'Limited availability (when donated/in stock)' },
  { value: 'seasonal', description: 'Seasonal availability only' },
] as const;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get all valid tags for a service_attributes taxonomy
 */
export function getValidAttributeTags(taxonomy: keyof typeof SERVICE_ATTRIBUTES_TAXONOMY): string[] {
  return SERVICE_ATTRIBUTES_TAXONOMY[taxonomy]?.tags.map(t => t.tag) ?? [];
}

/**
 * Get all valid tags for a service_adaptations type
 */
export function getValidAdaptationTags(adaptationType: keyof typeof SERVICE_ADAPTATIONS_TAXONOMY): string[] {
  return SERVICE_ADAPTATIONS_TAXONOMY[adaptationType]?.tags.map(t => t.tag) ?? [];
}

/**
 * Get all valid dietary types
 */
export function getValidDietaryTypes(): string[] {
  return DIETARY_OPTIONS_TAXONOMY.tags.map(t => t.tag);
}

/**
 * Get all valid transit access tags
 */
export function getValidTransitTags(): string[] {
  return TRANSIT_ACCESS_TAXONOMY.tags.map(t => t.tag);
}

/**
 * Validate if a tag is valid for a given taxonomy
 */
export function isValidTag(taxonomy: string, tag: string): boolean {
  const def = SERVICE_ATTRIBUTES_TAXONOMY[taxonomy];
  if (!def) return false;
  return def.tags.some(t => t.tag === tag);
}

/**
 * Get tag description for display
 */
export function getTagDescription(taxonomy: string, tag: string): string | null {
  const def = SERVICE_ATTRIBUTES_TAXONOMY[taxonomy] ??
              SERVICE_ADAPTATIONS_TAXONOMY[taxonomy];
  if (!def) return null;
  const found = def.tags.find(t => t.tag === tag);
  return found?.description ?? null;
}

/**
 * Get commonly used tags for a taxonomy (for quick suggestions)
 */
export function getCommonTags(taxonomy: string): TaxonomyTag[] {
  const def = SERVICE_ATTRIBUTES_TAXONOMY[taxonomy] ??
              SERVICE_ADAPTATIONS_TAXONOMY[taxonomy];
  if (!def) return [];
  return def.tags.filter(t => t.common);
}

// ============================================================
// EXPORT ALL TAXONOMIES (for LLM prompt generation)
// ============================================================

export const ALL_TAXONOMIES = {
  serviceAttributes: SERVICE_ATTRIBUTES_TAXONOMY,
  serviceAdaptations: SERVICE_ADAPTATIONS_TAXONOMY,
  dietaryOptions: DIETARY_OPTIONS_TAXONOMY,
  transitAccess: TRANSIT_ACCESS_TAXONOMY,
  locationAccessibility: LOCATION_ACCESSIBILITY_TAXONOMY,
  capacityStatus: CAPACITY_STATUS_OPTIONS,
  parking: PARKING_OPTIONS,
  dietaryAvailability: DIETARY_AVAILABILITY_OPTIONS,
};
