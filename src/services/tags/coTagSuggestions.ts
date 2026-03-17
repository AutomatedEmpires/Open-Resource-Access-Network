/**
 * Co-tag suggestions engine
 *
 * Rule-based map: service category → commonly relevant SERVICE_ATTRIBUTES_TAXONOMY tags.
 * No LLM required — pure deterministic lookup.
 *
 * When a host selects a category (e.g. "food"), the panel shows tags they commonly
 * need but might forget (e.g. "free", "walk_in", "no_id_required").
 * Clicking a suggestion adds it to the customTerms chip list.
 */

export interface CoTagSuggestion {
  tag: string;
  label: string;
  dimension: string;
  reason: string;
}

// ============================================================
// LABEL MAP
// Human-readable labels for SERVICE_ATTRIBUTES_TAXONOMY tag IDs.
// Only includes tags that appear in suggestions below.
// ============================================================

const TAG_LABELS: Record<string, { label: string; dimension: string }> = {
  // Delivery
  in_person:         { label: 'In-person',             dimension: 'Delivery' },
  virtual:           { label: 'Virtual / telehealth',  dimension: 'Delivery' },
  phone:             { label: 'Phone service',          dimension: 'Delivery' },
  home_delivery:     { label: 'Home delivery',          dimension: 'Delivery' },
  mobile_outreach:   { label: 'Mobile outreach',        dimension: 'Delivery' },
  drive_through:     { label: 'Drive-through',          dimension: 'Delivery' },
  curbside:          { label: 'Curbside pickup',        dimension: 'Delivery' },
  // Cost
  free:                      { label: 'Free',                     dimension: 'Cost' },
  sliding_scale:             { label: 'Sliding scale',            dimension: 'Cost' },
  medicaid:                  { label: 'Accepts Medicaid',         dimension: 'Cost' },
  medicare:                  { label: 'Accepts Medicare',         dimension: 'Cost' },
  private_insurance:         { label: 'Private insurance',        dimension: 'Cost' },
  no_insurance_required:     { label: 'No insurance required',    dimension: 'Cost' },
  ebt_snap:                  { label: 'Accepts EBT/SNAP',        dimension: 'Cost' },
  // Access
  walk_in:                   { label: 'Walk-in welcome',          dimension: 'Access' },
  appointment_required:      { label: 'Appointment required',     dimension: 'Access' },
  no_id_required:            { label: 'No ID required',           dimension: 'Access' },
  no_referral_needed:        { label: 'No referral needed',       dimension: 'Access' },
  referral_required:         { label: 'Referral required',        dimension: 'Access' },
  accepting_new_clients:     { label: 'Accepting new clients',    dimension: 'Access' },
  drop_in:                   { label: 'Drop-in',                  dimension: 'Access' },
  no_documentation_required: { label: 'No documentation needed',  dimension: 'Access' },
  form_assistance:           { label: 'Help with paperwork',      dimension: 'Access' },
  navigator_available:       { label: 'Benefits navigator',       dimension: 'Access' },
  same_day:                  { label: 'Same-day service',         dimension: 'Access' },
  weekend_hours:             { label: 'Weekend hours',            dimension: 'Access' },
  evening_hours:             { label: 'Evening hours',            dimension: 'Access' },
  online_application:        { label: 'Online application',       dimension: 'Access' },
  // Culture
  trauma_informed:       { label: 'Trauma-informed',        dimension: 'Culture' },
  harm_reduction:        { label: 'Harm reduction',          dimension: 'Culture' },
  peer_support:          { label: 'Peer support',            dimension: 'Culture' },
  lgbtq_affirming:       { label: 'LGBTQ+ affirming',        dimension: 'Culture' },
  bilingual_services:    { label: 'Bilingual services',      dimension: 'Culture' },
  spanish_speaking_staff:{ label: 'Spanish-speaking staff',  dimension: 'Culture' },
  immigrant_friendly:    { label: 'Immigrant-friendly',      dimension: 'Culture' },
  youth_focused:         { label: 'Youth-focused',           dimension: 'Culture' },
  age_friendly:          { label: 'Age-friendly',            dimension: 'Culture' },
  family_centered:       { label: 'Family-centered',         dimension: 'Culture' },
  recovery_oriented:     { label: 'Recovery-oriented',       dimension: 'Culture' },
  // Population
  reentry:          { label: 'Reentry population',      dimension: 'Population' },
  dv_survivor:      { label: 'DV survivors',            dimension: 'Population' },
  refugee:          { label: 'Refugees',                dimension: 'Population' },
  undocumented_friendly: { label: 'Serves undocumented', dimension: 'Population' },
  transition_age_youth: { label: 'Transition-age youth', dimension: 'Population' },
  pregnant:         { label: 'Pregnant individuals',    dimension: 'Population' },
  // Situation
  no_fixed_address:      { label: 'No fixed address OK',       dimension: 'Situation' },
  substance_use_active:  { label: 'Active substance use OK',   dimension: 'Situation' },
  fleeing_violence:      { label: 'Fleeing violence',          dimension: 'Situation' },
  digital_barrier:       { label: 'Digital barrier',           dimension: 'Situation' },
  transportation_barrier:{ label: 'Transportation barrier',    dimension: 'Situation' },
  language_barrier:      { label: 'Language barrier',          dimension: 'Situation' },
};

// ============================================================
// CATEGORY → SUGGESTED TAGS
// ============================================================

const CATEGORY_CO_TAGS: Record<string, Array<{ tag: string; reason: string }>> = {
  food: [
    { tag: 'free',                    reason: 'Most food programs are free' },
    { tag: 'walk_in',                 reason: 'Food pantries typically allow walk-in' },
    { tag: 'no_id_required',          reason: 'Many food programs serve without ID' },
    { tag: 'ebt_snap',               reason: 'Indicate if you accept SNAP benefits' },
    { tag: 'home_delivery',           reason: 'Meals-on-wheels and delivery programs' },
    { tag: 'no_documentation_required', reason: 'Important accessibility signal for food access' },
    { tag: 'drive_through',           reason: 'Drive-through distribution is common for food' },
  ],
  housing: [
    { tag: 'accepting_new_clients',   reason: 'Seekers need to know if intake is open' },
    { tag: 'appointment_required',    reason: 'Housing intake often requires scheduling' },
    { tag: 'no_id_required',          reason: 'Critical for people without documentation' },
    { tag: 'fleeing_violence',        reason: 'Tag if you serve people fleeing domestic violence' },
    { tag: 'no_fixed_address',        reason: 'Indicate if services require a mailing address' },
    { tag: 'walk_in',                 reason: 'Tag if crisis shelter has daily walk-in intake' },
    { tag: 'navigator_available',     reason: 'Housing navigators are a major trust signal' },
  ],
  mental_health: [
    { tag: 'trauma_informed',         reason: 'Trauma-informed care is a key differentiator' },
    { tag: 'peer_support',            reason: 'Peer support is highly valued in mental health' },
    { tag: 'harm_reduction',          reason: 'Tag if no abstinence requirement for services' },
    { tag: 'appointment_required',    reason: 'Most mental health services require scheduling' },
    { tag: 'sliding_scale',           reason: 'Sliding scale fees reduce access barriers' },
    { tag: 'virtual',                 reason: 'Telehealth is common for mental health services' },
    { tag: 'recovery_oriented',       reason: 'Tag if you use a recovery-oriented model' },
  ],
  substance_abuse: [
    { tag: 'harm_reduction',          reason: 'Signal if no sobriety requirement' },
    { tag: 'no_referral_needed',      reason: 'Self-referral is key for addiction services' },
    { tag: 'walk_in',                 reason: 'Walk-in capacity reduces treatment barriers' },
    { tag: 'peer_support',            reason: 'Peer support workers are common in this space' },
    { tag: 'substance_use_active',    reason: 'Serve people who are currently using — crucial tag' },
    { tag: 'accepting_new_clients',   reason: 'Real-time capacity signal for seekers' },
    { tag: 'medicaid',                reason: 'Many substance use programs accept Medicaid' },
  ],
  healthcare: [
    { tag: 'sliding_scale',           reason: 'FQHCs and free clinics commonly use sliding scale' },
    { tag: 'medicaid',                reason: 'Accept Medicaid is a top seeker filter' },
    { tag: 'medicare',                reason: 'Tag if you accept Medicare' },
    { tag: 'no_insurance_required',   reason: 'Critical signal for uninsured patients' },
    { tag: 'appointment_required',    reason: 'Most clinics require scheduling' },
    { tag: 'same_day',               reason: 'Same-day appointments are a strong trust signal' },
    { tag: 'walk_in',                reason: 'Urgent care and health fairs may have walk-in' },
  ],
  employment: [
    { tag: 'in_person',              reason: 'Career workshops typically in-person' },
    { tag: 'virtual',                reason: 'Online job training is increasingly common' },
    { tag: 'walk_in',                reason: 'Drop-in career centers welcome' },
    { tag: 'no_id_required',         reason: 'Important for people with documentation barriers' },
    { tag: 'reentry',                reason: 'Tag if you serve people with criminal records' },
    { tag: 'form_assistance',        reason: 'Application help is a major service add-on' },
    { tag: 'online_application',     reason: 'Online intake lowers barriers' },
  ],
  legal_aid: [
    { tag: 'appointment_required',   reason: 'Legal clinics typically require scheduling' },
    { tag: 'walk_in',                reason: 'Brief legal advice clinics may have walk-in' },
    { tag: 'no_id_required',         reason: 'Critical for undocumented clients' },
    { tag: 'sliding_scale',          reason: 'Income-based fees are common in legal aid' },
    { tag: 'free',                   reason: 'Many legal aid orgs are fully free' },
    { tag: 'immigrant_friendly',     reason: 'Tag if you serve immigrant communities' },
    { tag: 'undocumented_friendly',  reason: 'Critical for immigration legal services' },
  ],
  transportation: [
    { tag: 'phone',                  reason: 'Transportation dispatch is usually by phone' },
    { tag: 'accepting_new_clients',  reason: 'Riders need to know if intake is open' },
    { tag: 'no_id_required',         reason: 'Tag if no ID needed to use transport' },
    { tag: 'free',                   reason: 'Flag if rides are free of charge' },
    { tag: 'medical_emergency',      reason: 'NEMT for medical appointments is common' },
  ],
  childcare: [
    { tag: 'sliding_scale',          reason: 'Childcare subsidies and sliding fees are common' },
    { tag: 'appointment_required',   reason: 'Enrollment typically requires scheduling' },
    { tag: 'accepting_new_clients',  reason: 'Waitlists are common — signal clearly' },
    { tag: 'no_id_required',         reason: 'Tag if no ID required for initial intake' },
    { tag: 'family_centered',        reason: 'Family-centered care is a key differentiator' },
    { tag: 'trauma_informed',        reason: 'Trauma-informed childcare is increasingly standard' },
  ],
  education: [
    { tag: 'in_person',              reason: 'Tag primary delivery mode' },
    { tag: 'virtual',                reason: 'Online learning is now common' },
    { tag: 'walk_in',                reason: 'Tag if adult ed has open enrollment walk-in' },
    { tag: 'free',                   reason: 'GED and literacy programs often free' },
    { tag: 'bilingual_services',     reason: 'Bilingual instruction is a strong differentiator' },
    { tag: 'undocumented_friendly',  reason: 'Tag if open enrollment regardless of status' },
  ],
  veterans: [
    { tag: 'phone',                  reason: 'Many veteran services have phone intake' },
    { tag: 'in_person',              reason: 'Tag primary delivery mode' },
    { tag: 'virtual',                reason: 'Virtual services for rural veterans' },
    { tag: 'walk_in',                reason: 'Veteran centers often welcome drop-ins' },
    { tag: 'peer_support',           reason: 'Veteran peer support programs are common' },
    { tag: 'transportation_barrier', reason: 'Many veterans face transport challenges' },
  ],
  financial: [
    { tag: 'free',                   reason: 'VITA tax prep and many financial services are free' },
    { tag: 'walk_in',                reason: 'Financial fairs and drop-in clinics' },
    { tag: 'appointment_required',   reason: 'Asset building programs often require scheduling' },
    { tag: 'form_assistance',        reason: 'Application and paperwork help is key' },
    { tag: 'navigator_available',    reason: 'Benefits navigators for program enrollment' },
    { tag: 'no_id_required',         reason: 'Emergency financial assistance often no ID needed' },
  ],
  disability: [
    { tag: 'in_person',              reason: 'Many disability services are in-person' },
    { tag: 'home_delivery',          reason: 'At-home support is key for disability services' },
    { tag: 'phone',                  reason: 'Phone accessibility for low-mobility clients' },
    { tag: 'virtual',                reason: 'Telehealth and virtual support services' },
    { tag: 'walk_in',                reason: 'Tag if drop-in access is available' },
    { tag: 'navigator_available',    reason: 'Benefits coordinators for disability programs' },
  ],
  senior_services: [
    { tag: 'home_delivery',          reason: 'Home-delivered meals and in-home services' },
    { tag: 'in_person',              reason: 'Senior centers are primarily in-person' },
    { tag: 'phone',                  reason: 'Phone access for homebound seniors' },
    { tag: 'walk_in',                reason: 'Senior centers often have drop-in activities' },
    { tag: 'age_friendly',           reason: 'Explicitly signal age-friendly environment' },
    { tag: 'transportation_barrier', reason: 'Transportation is a key barrier for seniors' },
  ],
  utility_assistance: [
    { tag: 'free',                   reason: 'LIHEAP and emergency utility assistance is free' },
    { tag: 'appointment_required',   reason: 'Energy assistance applications usually scheduled' },
    { tag: 'walk_in',                reason: 'Emergency utility may have walk-in' },
    { tag: 'form_assistance',        reason: 'LIHEAP applications require documentation help' },
    { tag: 'accepting_new_clients',  reason: 'Utility programs have annual enrollment windows' },
    { tag: 'no_id_required',         reason: 'Emergency assistance sometimes ID-optional' },
  ],
  clothing: [
    { tag: 'free',                   reason: 'Most clothing programs distribute free' },
    { tag: 'walk_in',                reason: 'Clothing closets typically walk-in' },
    { tag: 'no_id_required',         reason: 'Tag if no ID needed to receive clothing' },
    { tag: 'drive_through',          reason: 'Drive-through clothing distribution is common' },
    { tag: 'curbside',               reason: 'Curbside pickup for clothing distributions' },
    { tag: 'drop_in',                reason: 'Drop-in closets are common model' },
  ],
};

// ============================================================
// PUBLIC API
// ============================================================

export interface ServiceAttributeTag {
  tag: string;
  label: string;
  dimension: string;
}

/**
 * Return the complete flat list of all known service attribute tags,
 * grouped by dimension. Used by AllTagsBrowser for full taxonomy browsing.
 */
export function getAllServiceAttributeTags(): ServiceAttributeTag[] {
  return Object.entries(TAG_LABELS).map(([tag, { label, dimension }]) => ({
    tag,
    label,
    dimension,
  }));
}

/**
 * Get co-tag suggestions for a set of selected category IDs.
 * Returns unique suggestions, excluding tags already present in customTerms.
 */
export function getCoTagSuggestions(
  selectedCategories: string[],
  existingCustomTerms: string[],
): CoTagSuggestion[] {
  const seen = new Set<string>(existingCustomTerms);
  const suggestions: CoTagSuggestion[] = [];

  for (const cat of selectedCategories) {
    const catSuggestions = CATEGORY_CO_TAGS[cat] ?? [];
    for (const { tag, reason } of catSuggestions) {
      if (!seen.has(tag)) {
        seen.add(tag);
        const meta = TAG_LABELS[tag];
        if (meta) {
          suggestions.push({ tag, label: meta.label, dimension: meta.dimension, reason });
        }
      }
    }
  }

  return suggestions;
}
