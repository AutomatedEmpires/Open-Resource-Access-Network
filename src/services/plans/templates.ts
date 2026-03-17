import type { SeekerPlanItemUrgency, SeekerPlanMilestone } from '@/domain/execution';

export interface SeekerPlanTemplateItemInput {
  title: string;
  note?: string;
  urgency?: SeekerPlanItemUrgency;
  milestone?: SeekerPlanMilestone;
  whyItMatters?: string;
  whatToAsk?: string;
  whatToBring?: string;
  fallback?: string;
}

export interface SeekerPlanTemplate {
  id: string;
  title: string;
  objective: string;
  description: string;
  emergencyKit: string[];
  items: SeekerPlanTemplateItemInput[];
}

export const SEEKER_PLAN_TEMPLATES: readonly SeekerPlanTemplate[] = [
  {
    id: 'stabilize-tonight',
    title: 'Stabilize tonight',
    objective: 'Keep the next few hours concrete: confirm what is open, decide your first stop, and keep fallback steps visible.',
    description: 'Use this when tonight or the next 24 hours need a short, grounded sequence instead of a long backlog.',
    emergencyKit: [
      'Photo ID or any identification you already have',
      'Phone, charger, and a written backup contact list',
      'Medication list or urgent health notes if relevant',
      'A place to write hours, addresses, or case numbers',
    ],
    items: [
      {
        title: 'Review tonight\'s immediate needs',
        note: 'Write the one or two needs that cannot wait until tomorrow.',
        urgency: 'today',
        milestone: 'immediate_survival',
        whyItMatters: 'A short list reduces confusion and keeps the first move realistic.',
      },
      {
        title: 'Confirm the first stop before leaving',
        note: 'Call or re-open the live record for the strongest saved option before you travel.',
        urgency: 'today',
        milestone: 'immediate_survival',
        whatToAsk: 'Ask whether the service is still open, who they can help right now, and what check-in process they use.',
        fallback: 'If the first option is unavailable, move to the next saved record rather than starting a new search from scratch.',
      },
      {
        title: 'Pack only the essentials for the next step',
        note: 'Keep documents, medications, and charging options together before you head out.',
        urgency: 'today',
        milestone: 'immediate_survival',
        whatToBring: 'Identification, phone, charger, medications, and any required paperwork already on hand.',
      },
    ],
  },
  {
    id: 'documentation-reset',
    title: 'Documentation reset',
    objective: 'Rebuild the document trail needed for applications, intake, and follow-up without losing what you already know.',
    description: 'Use this when missing paperwork or scattered details are blocking benefits, housing, or provider intake.',
    emergencyKit: [
      'Any ID, mail, or agency letters you still have',
      'Case numbers, usernames, or portal screenshots',
      'Names of agencies or providers already contacted',
      'A folder or envelope to keep replacement paperwork together',
    ],
    items: [
      {
        title: 'List the documents you still have',
        note: 'Start with what is available now before chasing replacements.',
        urgency: 'this_week',
        milestone: 'documentation',
        whyItMatters: 'A clear inventory prevents duplicate requests and missed evidence.',
      },
      {
        title: 'Write down every missing document blocking progress',
        note: 'Include IDs, letters, proof of address, benefit notices, or appointment records.',
        urgency: 'this_week',
        milestone: 'documentation',
        whatToAsk: 'Ask each provider or agency exactly which documents are required versus optional.',
      },
      {
        title: 'Choose the first replacement or verification request to make',
        note: 'Start with the missing item that unblocks the most next steps.',
        urgency: 'this_week',
        milestone: 'documentation',
        fallback: 'If a replacement will take time, ask whether temporary proof or an alternate document can be accepted.',
      },
    ],
  },
  {
    id: 'benefits-restart',
    title: 'Benefits restart',
    objective: 'Re-enter a benefits or public-support process with the minimum grounded steps needed to resume momentum.',
    description: 'Use this when an application stalled, a recertification was missed, or you need to restart a benefits workflow carefully.',
    emergencyKit: [
      'Current benefit letters, denial notices, or recertification messages',
      'Any agency account details or case numbers',
      'Income, household, or address documents already available',
      'A simple timeline of missed deadlines or last contact dates',
    ],
    items: [
      {
        title: 'Write down the current benefits status',
        note: 'Capture what was approved, denied, paused, or missed before making the next call.',
        urgency: 'this_week',
        milestone: 'benefits',
        whyItMatters: 'A precise starting point makes the next conversation faster and less error-prone.',
      },
      {
        title: 'Contact the agency or provider handling the case',
        note: 'Confirm what step is missing and whether the case can still be resumed.',
        urgency: 'this_week',
        milestone: 'benefits',
        whatToAsk: 'Ask what deadline applies now, what documents are still needed, and whether expedited review is possible.',
      },
      {
        title: 'Set a follow-up checkpoint after the first contact',
        note: 'Do not rely on memory alone once a next date or callback window is given.',
        urgency: 'later',
        milestone: 'benefits',
        fallback: 'If the case cannot move forward yet, ask what exact condition would reopen it and record that answer in the plan.',
      },
    ],
  },
] as const;

export function getSeekerPlanTemplate(templateId: string): SeekerPlanTemplate | null {
  return SEEKER_PLAN_TEMPLATES.find((template) => template.id === templateId) ?? null;
}
