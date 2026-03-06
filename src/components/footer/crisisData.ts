/**
 * Crisis Resources Data
 *
 * Curated list of verified national crisis hotlines and support resources.
 * Phone numbers are sourced from official provider websites.
 *
 * IMPORTANT: Verify all phone numbers against official provider websites
 * before any production update. These are safety-critical resources.
 */

// ============================================================
// TYPES
// ============================================================

export type CrisisCategory =
  | 'emergency'
  | 'mentalHealth'
  | 'domesticViolence'
  | 'substanceAbuse'
  | 'children'
  | 'lgbtq'
  | 'veterans'
  | 'aging'
  | 'eating'
  | 'runaway'
  | 'disaster'
  | 'poison'
  | 'gambling';

export interface CrisisResource {
  id: string;
  name: string;
  description: string;
  /**
   * Dial string for tel: links.
   * Use bare digits — e.g. "988", "18007997233".
   * For text-only lines set textOnly: true.
   */
  phone: string;
  /** Human-readable display format — e.g. "1-800-799-7233". */
  phoneDisplay: string;
  /** If true, this number is a text short code only (no voice call). */
  textOnly?: boolean;
  /** Text-in instructions — e.g. "Text START to 88788". */
  textOption?: string;
  /** Whether a chat/online option is offered. */
  chatAvailable?: boolean;
  available: string;
  category: CrisisCategory;
}

// ============================================================
// CATEGORY METADATA
// ============================================================

export const CRISIS_CATEGORY_LABELS: Record<CrisisCategory, string> = {
  emergency:        'Emergency',
  mentalHealth:     'Mental Health',
  domesticViolence: 'Safety & Abuse',
  substanceAbuse:   'Substance & Recovery',
  children:         'Children & Youth',
  lgbtq:            'LGBTQ+ Support',
  veterans:         'Veterans',
  aging:            'Aging & Memory',
  eating:           'Eating Disorders',
  runaway:          'Youth & Runaway',
  disaster:         'Disaster Relief',
  poison:           'Poison Control',
  gambling:         'Gambling',
};

export const CRISIS_CATEGORY_COLORS: Record<
  CrisisCategory,
  { bg: string; text: string; border: string }
> = {
  emergency:        { bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200' },
  mentalHealth:     { bg: 'bg-purple-50',   text: 'text-purple-700',  border: 'border-purple-200' },
  domesticViolence: { bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-200' },
  substanceAbuse:   { bg: 'bg-teal-50',     text: 'text-teal-700',    border: 'border-teal-200' },
  children:         { bg: 'bg-yellow-50',   text: 'text-yellow-700',  border: 'border-yellow-200' },
  lgbtq:            { bg: 'bg-pink-50',     text: 'text-pink-700',    border: 'border-pink-200' },
  veterans:         { bg: 'bg-green-50',    text: 'text-green-700',   border: 'border-green-200' },
  aging:            { bg: 'bg-orange-50',   text: 'text-orange-700',  border: 'border-orange-200' },
  eating:           { bg: 'bg-lime-50',     text: 'text-lime-700',    border: 'border-lime-200' },
  runaway:          { bg: 'bg-sky-50',      text: 'text-sky-700',     border: 'border-sky-200' },
  disaster:         { bg: 'bg-gray-100',    text: 'text-gray-600',    border: 'border-gray-200' },
  poison:           { bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200' },
  gambling:         { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
};

// ============================================================
// RESOURCES  (emergency first, then mental health, then by domain)
// ============================================================

export const CRISIS_RESOURCES: CrisisResource[] = [
  // ── Emergency ────────────────────────────────────────────
  {
    id: 'emergency-911',
    name: 'Emergency Services',
    description:
      'Police, fire, and emergency medical services. Call for any immediate life-threatening emergency.',
    phone: '911',
    phoneDisplay: '911',
    available: '24/7',
    category: 'emergency',
  },

  // ── Mental Health ─────────────────────────────────────────
  {
    id: 'suicide-988',
    name: '988 Suicide & Crisis Lifeline',
    description:
      'Free, confidential support for people in suicidal crisis or mental health distress — call or text 988.',
    phone: '988',
    phoneDisplay: '988',
    textOption: 'Text 988',
    chatAvailable: true,
    available: '24/7',
    category: 'mentalHealth',
  },
  {
    id: 'crisis-text-line',
    name: 'Crisis Text Line',
    description:
      'Free 24/7 crisis counseling via text message. Text HOME to 741741 to reach a trained counselor.',
    phone: '741741',
    phoneDisplay: '741741',
    textOnly: true,
    textOption: 'Text HOME to 741741',
    available: '24/7',
    category: 'mentalHealth',
  },
  {
    id: 'nami-helpline',
    name: 'NAMI Helpline',
    description:
      'The National Alliance on Mental Illness provides support, education, and referrals for any mental health concern.',
    phone: '18009506264',
    phoneDisplay: '1-800-950-6264',
    textOption: 'Text NAMI to 741741',
    available: 'Mon–Fri 10am–10pm ET',
    category: 'mentalHealth',
  },

  // ── Safety & Abuse ───────────────────────────────────────
  {
    id: 'ndvh',
    name: 'National Domestic Violence Hotline',
    description:
      'Confidential support, safety planning, and local resources for anyone affected by domestic violence.',
    phone: '18007997233',
    phoneDisplay: '1-800-799-7233',
    textOption: 'Text START to 88788',
    chatAvailable: true,
    available: '24/7',
    category: 'domesticViolence',
  },
  {
    id: 'rainn',
    name: 'RAINN Sexual Assault Hotline',
    description:
      'Confidential support from trained staff and local providers for survivors of sexual violence.',
    phone: '18006564673',
    phoneDisplay: '1-800-656-4673',
    chatAvailable: true,
    available: '24/7',
    category: 'domesticViolence',
  },

  // ── Substance & Recovery ──────────────────────────────────
  {
    id: 'samhsa',
    name: 'SAMHSA National Helpline',
    description:
      'Free, confidential treatment referrals and information for mental health and substance use disorders.',
    phone: '18006624357',
    phoneDisplay: '1-800-662-4357',
    available: '24/7',
    category: 'substanceAbuse',
  },
  {
    id: 'gambling',
    name: 'National Problem Gambling Helpline',
    description:
      'Crisis intervention, information, and referrals for problem gambling and related financial distress.',
    phone: '18005224700',
    phoneDisplay: '1-800-522-4700',
    chatAvailable: true,
    available: '24/7',
    category: 'gambling',
  },

  // ── Children & Youth ─────────────────────────────────────
  {
    id: 'childhelp',
    name: 'Childhelp National Child Abuse Hotline',
    description:
      'Crisis intervention and referrals to emergency, social service, and support resources for child abuse.',
    phone: '18004224453',
    phoneDisplay: '1-800-422-4453',
    available: '24/7',
    category: 'children',
  },
  {
    id: 'runaway-safeline',
    name: 'National Runaway Safeline',
    description:
      'Crisis support and resources for runaway and homeless youth, and families needing help.',
    phone: '18007862929',
    phoneDisplay: '1-800-786-2929',
    textOption: 'Text 66008',
    chatAvailable: true,
    available: '24/7',
    category: 'runaway',
  },

  // ── LGBTQ+ ────────────────────────────────────────────────
  {
    id: 'trevor-project',
    name: 'Trevor Project (LGBTQ+ Youth)',
    description:
      'Crisis intervention and suicide prevention for lesbian, gay, bisexual, transgender, queer, and questioning young people.',
    phone: '18664887386',
    phoneDisplay: '1-866-488-7386',
    textOption: 'Text START to 678-678',
    chatAvailable: true,
    available: '24/7',
    category: 'lgbtq',
  },
  {
    id: 'trans-lifeline',
    name: 'Trans Lifeline',
    description:
      'Peer support hotline staffed by and for transgender people facing crisis, in need of support, or with questions.',
    phone: '18775658860',
    phoneDisplay: '1-877-565-8860',
    available: 'Hours vary — see website',
    category: 'lgbtq',
  },
  {
    id: 'glbt-help-center',
    name: 'GLBT National Help Center',
    description:
      'Free, confidential peer counseling and local resources for the LGBTQ+ community of all ages.',
    phone: '18888434564',
    phoneDisplay: '1-888-843-4564',
    available: 'Mon–Fri 4pm–12am ET, Sat Noon–5pm ET',
    category: 'lgbtq',
  },

  // ── Veterans ─────────────────────────────────────────────
  {
    id: 'veterans-crisis',
    name: 'Veterans Crisis Line',
    description:
      'Free, confidential crisis support for veterans, service members, and their families. Dial 988 then press 1.',
    phone: '988',
    phoneDisplay: '988 → Press 1',
    textOption: 'Text 838255',
    chatAvailable: true,
    available: '24/7',
    category: 'veterans',
  },

  // ── Disaster Relief ───────────────────────────────────────
  {
    id: 'disaster-distress',
    name: 'Disaster Distress Helpline',
    description:
      'Immediate crisis counseling for people experiencing emotional distress related to any natural or human-caused disaster.',
    phone: '18009855990',
    phoneDisplay: '1-800-985-5990',
    textOption: 'Text TalkWithUs to 66746',
    available: '24/7',
    category: 'disaster',
  },

  // ── Poison Control ────────────────────────────────────────
  {
    id: 'poison-control',
    name: 'Poison Control Center',
    description:
      'Expert guidance for poisonings and toxic exposures — medicines, household products, plants, bites, and more.',
    phone: '18002221222',
    phoneDisplay: '1-800-222-1222',
    available: '24/7',
    category: 'poison',
  },

  // ── Eating Disorders ─────────────────────────────────────
  {
    id: 'neda',
    name: 'NEDA Eating Disorders Helpline',
    description:
      'Support, resources, and treatment options for those struggling with eating disorders and their loved ones.',
    phone: '18009312237',
    phoneDisplay: '1-800-931-2237',
    textOption: 'Text NEDA to 741741',
    available: 'Mon–Thu 11am–9pm ET, Fri 11am–5pm ET',
    category: 'eating',
  },

  // ── Aging & Memory ────────────────────────────────────────
  {
    id: 'alzheimers',
    name: "Alzheimer's Association Helpline",
    description:
      "Around-the-clock support, information, and referrals for people affected by Alzheimer's and other dementias.",
    phone: '18003444867',
    phoneDisplay: '1-800-344-4867',
    available: '24/7',
    category: 'aging',
  },
];
