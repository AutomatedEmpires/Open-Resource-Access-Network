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
  | 'gambling'
  | 'trafficking'
  | 'housing'
  | 'disability'
  | 'financial';

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
  /** Marks top-priority resources (911, 988, 211) for visual prominence. */
  featured?: boolean;
  /** Official website URL for more information. */
  website?: string;
  /** Languages or accessibility options (e.g., "Español", "TTY available"). */
  languages?: string[];
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
  trafficking:      'Human Trafficking',
  housing:          'Housing & Homelessness',
  disability:       'Disability Services',
  financial:        'Financial Crisis',
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
  trafficking:      { bg: 'bg-rose-50',     text: 'text-rose-700',    border: 'border-rose-200' },
  housing:          { bg: 'bg-cyan-50',     text: 'text-cyan-700',    border: 'border-cyan-200' },
  disability:       { bg: 'bg-violet-50',   text: 'text-violet-700',  border: 'border-violet-200' },
  financial:        { bg: 'bg-indigo-50',   text: 'text-indigo-700',  border: 'border-indigo-200' },
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
    featured: true,
  },
  {
    id: 'community-211',
    name: '211 Community Helpline',
    description:
      'Free, confidential community resource referrals for food, shelter, utilities, healthcare, childcare, and more. The social services equivalent of 911.',
    phone: '211',
    phoneDisplay: '211',
    chatAvailable: true,
    available: '24/7 in most areas',
    category: 'emergency',
    featured: true,
    website: 'https://www.211.org',
    languages: ['200+ languages via interpreter'],
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
    featured: true,
    website: 'https://988lifeline.org',
    languages: ['Español: (888) 628-9454', 'TTY: dial 711 first'],
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
    website: 'https://www.crisistextline.org',
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
    website: 'https://www.nami.org/help',
    languages: ['Español: text AYUDA to 741741'],
  },
  {
    id: '988-espanol',
    name: '988 Línea de Crisis en Español',
    description:
      'Apoyo confidencial en español para personas en crisis suicida o de salud mental. Marca 988 y elige la opción en español.',
    phone: '18886289454',
    phoneDisplay: '1-888-628-9454',
    chatAvailable: true,
    available: '24/7',
    category: 'mentalHealth',
    website: 'https://988lifeline.org',
    languages: ['Español'],
  },
  {
    id: 'postpartum-psi',
    name: 'Postpartum Support International Helpline',
    description:
      'Support and referrals for postpartum depression, anxiety, and perinatal mental health for new parents and families.',
    phone: '18009444773',
    phoneDisplay: '1-800-944-4773',
    textOption: 'Text 503-894-9453',
    available: '24/7',
    category: 'mentalHealth',
    website: 'https://www.postpartum.net',
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
    website: 'https://www.thehotline.org',
    languages: ['Español disponible', 'TTY: 1-800-787-3224'],
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
    website: 'https://www.rainn.org',
  },
  {
    id: 'loveisrespect',
    name: 'loveisrespect — Teen Dating Violence',
    description:
      'Specialized support for young people aged 13–26 experiencing dating abuse, unhealthy relationships, or sexual violence.',
    phone: '18663319474',
    phoneDisplay: '1-866-331-9474',
    textOption: 'Text LOVEIS to 22522',
    chatAvailable: true,
    available: '24/7',
    category: 'domesticViolence',
    website: 'https://www.loveisrespect.org',
  },
  {
    id: 'stronghearts',
    name: 'StrongHearts Native Helpline',
    description:
      'Culturally appropriate support for Native Americans and Alaska Natives experiencing domestic violence, dating violence, or sexual assault.',
    phone: '18447628483',
    phoneDisplay: '1-844-762-8483',
    chatAvailable: true,
    available: '24/7',
    category: 'domesticViolence',
    website: 'https://strongheartshelpline.org',
  },
  {
    id: 'victimconnect',
    name: 'VictimConnect Resource Center',
    description:
      'Confidential referrals, information, and support for all crime victims — including violent crime, financial fraud, stalking, and identity theft.',
    phone: '18554842846',
    phoneDisplay: '1-855-484-2846',
    textOption: 'Text 1-855-484-2846',
    chatAvailable: true,
    available: '24/7',
    category: 'domesticViolence',
    website: 'https://victimconnect.org',
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
    website: 'https://www.samhsa.gov/find-help/national-helpline',
    languages: ['Español disponible'],
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
    website: 'https://www.childhelphotline.org',
  },
  {
    id: 'boys-town',
    name: 'Boys Town National Hotline',
    description:
      'Free, confidential crisis and counseling support for children, teens, parents, and families facing any problem — from bullying and abuse to family conflict.',
    phone: '18004483000',
    phoneDisplay: '1-800-448-3000',
    textOption: 'Text VOICE to 20121',
    chatAvailable: true,
    available: '24/7',
    category: 'children',
    website: 'https://www.boystown.org/hotline',
  },
  {
    id: 'national-parent-helpline',
    name: 'National Parent Helpline',
    description:
      'Emotional support and resources for parents and caregivers under stress, struggling with parenting challenges, or at risk of harming their child.',
    phone: '18554272736',
    phoneDisplay: '1-855-427-2736',
    available: 'Mon–Fri 10am–7pm PT',
    category: 'children',
    website: 'https://www.nationalparenthelpline.org',
  },

  // ── Youth & Runaway ──────────────────────────────────────
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
    website: 'https://www.1800runaway.org',
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
    website: 'https://www.thetrevorproject.org',
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
    website: 'https://translifeline.org',
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
    website: 'https://www.glbthotline.org',
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
    website: 'https://www.veteranscrisisline.net',
    languages: ['Español disponible'],
  },
  {
    id: 'homeless-veterans',
    name: 'National Call Center for Homeless Veterans',
    description:
      'VA-operated free crisis line connecting veterans at risk of homelessness to local VA resources, housing, and benefits.',
    phone: '18774243838',
    phoneDisplay: '1-877-424-3838',
    available: '24/7',
    category: 'veterans',
    website: 'https://www.va.gov/homeless/for_veterans.asp',
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
    website: 'https://www.samhsa.gov/find-help/disaster-distress-helpline',
    languages: ['Español disponible', 'ASL via videophone'],
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
    website: 'https://www.poison.org',
    languages: ['Español disponible'],
  },

  // ── Gambling ─────────────────────────────────────────────
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
    website: 'https://www.ncpgambling.org/help-treatment/national-helpline',
  },

  // ── Human Trafficking ────────────────────────────────────
  {
    id: 'human-trafficking',
    name: 'National Human Trafficking Hotline',
    description:
      'Confidential support, crisis intervention, and referrals for survivors of human trafficking and those who suspect trafficking activity.',
    phone: '18883737888',
    phoneDisplay: '1-888-373-7888',
    textOption: 'Text BeFree to 233733',
    chatAvailable: true,
    available: '24/7',
    category: 'trafficking',
    website: 'https://humantraffickinghotline.org',
    languages: ['200+ languages via interpreter', 'TTY available'],
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
    website: 'https://www.nationaleatingdisorders.org/help-support/contact-helpline',
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
    website: 'https://www.alz.org/help-support/resources/helpline',
  },
  {
    id: 'eldercare-locator',
    name: 'Eldercare Locator',
    description:
      'Free resource connecting older adults and caregivers to local services including in-home care, transportation, meals, and elder abuse reporting.',
    phone: '18006771116',
    phoneDisplay: '1-800-677-1116',
    available: 'Mon–Fri 8am–9pm ET',
    category: 'aging',
    website: 'https://eldercare.acl.gov',
    languages: ['Español disponible', 'Translation services available'],
  },

  // ── Housing & Homelessness ────────────────────────────────
  {
    id: 'hud-housing',
    name: 'HUD Housing Counseling Hotline',
    description:
      'Free or low-cost official housing counseling — foreclosure prevention, rental assistance, reverse mortgage guidance, and homelessness services.',
    phone: '18005694287',
    phoneDisplay: '1-800-569-4287',
    available: '24/7',
    category: 'housing',
    website: 'https://www.hud.gov/i_want_to/talk_to_a_housing_counselor',
    languages: ['Español disponible'],
  },

  // ── Disability Services ───────────────────────────────────
  {
    id: 'ada-national',
    name: 'ADA National Network',
    description:
      'Free information, guidance, and technical assistance on the Americans with Disabilities Act including employment, housing, and public access rights.',
    phone: '18009494232',
    phoneDisplay: '1-800-949-4232',
    available: 'Mon–Fri 9am–5pm (local time zone)',
    category: 'disability',
    website: 'https://adata.org',
    languages: ['TTY: 1-800-949-4232', 'Español disponible'],
  },

  // ── Financial Crisis ──────────────────────────────────────
  {
    id: 'nfcc',
    name: 'NFCC Financial Counseling',
    description:
      'Free and low-cost credit counseling, debt management, housing counseling, and bankruptcy education from a nonprofit financial counselor.',
    phone: '18003882227',
    phoneDisplay: '1-800-388-2227',
    available: 'Mon–Fri 8am–8pm ET',
    category: 'financial',
    website: 'https://www.nfcc.org',
    languages: ['Español disponible'],
  },
  {
    id: 'cfpb',
    name: 'Consumer Financial Protection Bureau',
    description:
      'Federal agency helping consumers with mortgage issues, debt collection, credit reporting errors, financial scams, and predatory lending complaints.',
    phone: '18554112372',
    phoneDisplay: '1-855-411-2372',
    available: 'Mon–Fri 8am–8pm ET',
    category: 'financial',
    website: 'https://www.consumerfinance.gov',
    languages: ['Español: (855) 411-2372', 'TTY: (855) 729-2372'],
  },
];
