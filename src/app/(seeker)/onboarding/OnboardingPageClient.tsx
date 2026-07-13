'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  Clock3,
  Info,
  MapPin,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DISCOVERY_NEEDS, getDiscoveryNeed, type DiscoveryNeedId } from '@/domain/discoveryNeeds';
import {
  type AccessibilityNeedId,
  type EmploymentStatusId,
  type IncomeRangeId,
} from '@/services/profile/contracts';
import {
  buildOnboardingChatPrompt,
  EMPTY_ONBOARDING_DRAFT,
  getOnboardingNeedId,
  hasOnboardingNeed,
  mergeOnboardingIntoProfile,
  type ImmigrationSupportNeed,
  type OnboardingAudience,
  type OnboardingDraft,
  type OnboardingUrgency,
} from '@/services/profile/onboarding';
import { writeOnboardingChatHandoff } from '@/services/profile/onboardingHandoff';
import {
  readStoredSeekerProfile,
  writeStoredSeekerProfile,
} from '@/services/profile/clientContext';
import {
  isServerSyncEnabledOnDevice,
  readStoredProfilePreferences,
  writeStoredProfilePreferences,
} from '@/services/profile/syncPreference';

const STEPS = ['Need', 'Timing', 'Household', 'Optional', 'Privacy'] as const;

const URGENCY_OPTIONS: ReadonlyArray<{ value: OnboardingUrgency; label: string; description: string }> = [
  { value: 'today', label: 'Today', description: 'Show options that may be reachable now.' },
  { value: 'one_to_two_days', label: 'In 1–2 days', description: 'Prioritize near-term intake.' },
  { value: 'this_week', label: 'This week', description: 'Include services with a short next step.' },
  { value: 'planning', label: 'Planning ahead', description: 'Include longer-term programs.' },
  { value: 'prefer_not_to_say', label: 'Not sure yet', description: 'Timing will not narrow your search.' },
];

const AUDIENCE_OPTIONS: ReadonlyArray<{ value: OnboardingAudience; label: string }> = [
  { value: 'self', label: 'Me' },
  { value: 'child', label: 'A child' },
  { value: 'household', label: 'My household' },
  { value: 'someone_else', label: 'Someone else' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const EMPLOYMENT_OPTIONS: ReadonlyArray<{ value: EmploymentStatusId; label: string }> = [
  { value: 'employed_full_time', label: 'Employed full time' },
  { value: 'employed_part_time', label: 'Employed part time' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'unemployed_looking', label: 'Looking for work' },
  { value: 'not_currently_working', label: 'Not currently working' },
  { value: 'student', label: 'Student' },
  { value: 'retired', label: 'Retired' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const INCOME_OPTIONS: ReadonlyArray<{ value: IncomeRangeId; label: string }> = [
  { value: 'no_income', label: 'No monthly household income' },
  { value: 'under_1500_monthly', label: 'Under $1,500 / month' },
  { value: '1500_2999_monthly', label: '$1,500–$2,999 / month' },
  { value: '3000_4999_monthly', label: '$3,000–$4,999 / month' },
  { value: '5000_plus_monthly', label: '$5,000+ / month' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const ACCESSIBILITY_OPTIONS: ReadonlyArray<{ value: AccessibilityNeedId; label: string }> = [
  { value: 'wheelchair_access', label: 'Wheelchair access' },
  { value: 'hearing_support', label: 'Hearing support or captions' },
  { value: 'vision_support', label: 'Low-vision support or large print' },
  { value: 'language_interpretation', label: 'Language interpretation' },
  { value: 'quiet_space', label: 'Quiet or low-sensory setting' },
  { value: 'child_friendly', label: 'Child-friendly appointments' },
  { value: 'virtual_option', label: 'Virtual options' },
  { value: 'evening_hours', label: 'Evening or weekend hours' },
];

const IMMIGRATION_SUPPORT_OPTIONS: ReadonlyArray<{ value: ImmigrationSupportNeed; label: string }> = [
  { value: 'immigration_legal_aid', label: 'Immigration legal aid' },
  { value: 'language_support', label: 'Language or interpretation support' },
  { value: 'no_ssn_services', label: 'Services that do not require an SSN' },
];

function ChoiceButton({
  selected,
  label,
  description,
  onClick,
}: {
  selected: boolean;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-[54px] rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-azure)] focus-visible:ring-offset-2 ${
        selected
          ? 'border-[var(--brand-azure)] bg-[var(--brand-navy)] text-white shadow-lg'
          : 'border-slate-300 bg-white text-slate-950 hover:border-[var(--brand-azure)] hover:bg-slate-50'
      }`}
    >
      <span className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-white bg-[var(--brand-azure)]' : 'border-slate-400 bg-white'
        }`} aria-hidden="true">
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        <span>
          <span className="block text-sm font-semibold">{label}</span>
          {description ? (
            <span className={`mt-1 block text-xs leading-5 ${selected ? 'text-slate-200' : 'text-slate-600'}`}>
              {description}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function WhyThisHelps({ children }: { children: ReactNode }) {
  return (
    <div className="bg-gradient-chrome mt-5 flex gap-3 rounded-2xl border border-slate-300 p-4 text-sm leading-6 text-slate-800">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-cobalt)]" aria-hidden="true" />
      <p><strong>Why this helps:</strong> {children}</p>
    </div>
  );
}

function OptionalCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium ${
      checked ? 'border-[var(--brand-azure)] bg-blue-50 text-[var(--brand-navy)]' : 'border-slate-300 bg-white text-slate-800'
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 rounded border-slate-400 accent-[var(--brand-azure)]"
      />
      <span>{label}</span>
    </label>
  );
}

function StepActions({
  back,
  next,
  nextDisabled = false,
  nextLabel = 'Continue',
}: {
  back?: () => void;
  next: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {back ? (
        <Button type="button" variant="ghost" onClick={back} className="min-h-[48px] px-5">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
        </Button>
      ) : <span />}
      <Button
        type="button"
        onClick={next}
        disabled={nextDisabled}
        className="bg-gradient-brand min-h-12 rounded-xl px-6 text-white shadow-lg hover:brightness-110"
      >
        {nextLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

export default function OnboardingPageClient() {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<OnboardingDraft>({ ...EMPTY_ONBOARDING_DRAFT });
  const [customNeedMode, setCustomNeedMode] = useState(false);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const selectedNeed = draft.needId ? getDiscoveryNeed(draft.needId) : undefined;
  const urgencyLabel = URGENCY_OPTIONS.find((option) => option.value === draft.urgency)?.label;
  const audienceLabel = AUDIENCE_OPTIONS.find((option) => option.value === draft.audience)?.label;
  const optionalSummary = useMemo(() => {
    const values: string[] = [];
    const employment = EMPLOYMENT_OPTIONS.find((option) => option.value === draft.employmentStatus)?.label;
    const income = INCOME_OPTIONS.find((option) => option.value === draft.incomeRange)?.label;
    if (employment && draft.employmentStatus !== 'prefer_not_to_say') values.push(employment);
    if (income && draft.incomeRange !== 'prefer_not_to_say') values.push(income);
    if (draft.accessibilityNeeds.length > 0) values.push(`${draft.accessibilityNeeds.length} access preference${draft.accessibilityNeeds.length === 1 ? '' : 's'}`);
    if (draft.veteranSupport) values.push('Veteran or military-family services');
    if (draft.immigrationSupportNeeds.length > 0) values.push(`${draft.immigrationSupportNeeds.length} immigration-support preference${draft.immigrationSupportNeeds.length === 1 ? '' : 's'}`);
    return values;
  }, [draft]);

  function updateDraft<K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleAccessibility(value: AccessibilityNeedId, checked: boolean) {
    updateDraft(
      'accessibilityNeeds',
      checked
        ? Array.from(new Set([...draft.accessibilityNeeds, value]))
        : draft.accessibilityNeeds.filter((item) => item !== value),
    );
  }

  function toggleImmigrationSupport(value: ImmigrationSupportNeed, checked: boolean) {
    updateDraft(
      'immigrationSupportNeeds',
      checked
        ? Array.from(new Set([...draft.immigrationSupportNeeds, value]))
        : draft.immigrationSupportNeeds.filter((item) => item !== value),
    );
  }

  function selectNeed(needId: DiscoveryNeedId) {
    setCustomNeedMode(false);
    setDraft((current) => ({ ...current, needId, customNeed: '' }));
  }

  async function continueToChat(saveToProfile: boolean) {
    setError('');
    const prompt = buildOnboardingChatPrompt(draft);
    if (!prompt) {
      setStep(0);
      setError('Tell us what kind of help you need before continuing.');
      return;
    }

    const handoffWritten = writeOnboardingChatHandoff({
      prompt,
      needId: getOnboardingNeedId(draft),
    });
    if (!handoffWritten) {
      setError('This browser could not open a private one-time handoff. Check private browsing settings and try again.');
      return;
    }

    setIsSaving(true);
    if (saveToProfile) {
      const seekerProfile = mergeOnboardingIntoProfile(readStoredSeekerProfile(), draft);
      const preferences = readStoredProfilePreferences();
      writeStoredSeekerProfile(seekerProfile);
      writeStoredProfilePreferences({
        ...preferences,
        ...(draft.approximateLocation.trim()
          ? { approximateCity: draft.approximateLocation.trim() }
          : {}),
      });

      if (isServerSyncEnabledOnDevice()) {
        try {
          await fetch('/api/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(draft.approximateLocation.trim()
                ? { approximateCity: draft.approximateLocation.trim() }
                : {}),
              seekerProfile,
            }),
          });
        } catch {
          // The local, explicitly consented profile remains available if account sync is offline.
        }
      }
    }

    router.push('/chat?from=onboarding');
  }

  return (
    <main className="bg-gradient-surface min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="bg-gradient-brand-deep mb-5 overflow-hidden rounded-[28px] border border-white/70 p-5 text-white shadow-xl sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-100">Private, progressive onboarding</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Find help that fits today.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50 sm:text-base">
            Start with what you need. Every personal detail is optional, and you decide whether ORAN uses it once or saves it to your profile.
          </p>
        </header>

        <nav aria-label="Onboarding progress" className="mb-4 rounded-2xl border border-slate-300 bg-white/90 px-3 py-3 shadow-sm backdrop-blur">
          <ol className="grid grid-cols-5 gap-1">
            {STEPS.map((label, index) => (
              <li key={label} className="text-center">
                <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
                  index === step
                    ? 'border-[var(--brand-azure)] bg-[var(--brand-azure)] text-white'
                    : index < step
                      ? 'border-[var(--brand-cobalt)] bg-[var(--brand-navy)] text-white'
                      : 'border-slate-300 bg-white text-slate-500'
                }`} aria-hidden="true">
                  {index < step ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className={`mt-1 hidden text-[11px] font-semibold sm:block ${index === step ? 'text-[var(--brand-cobalt)]' : 'text-slate-600'}`}>
                  {label}
                </span>
              </li>
            ))}
          </ol>
          <p className="sr-only">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
        </nav>

        <section className="rounded-[28px] border border-slate-300 bg-white p-5 shadow-xl sm:p-8">
          {step === 0 ? (
            <div>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[var(--brand-navy)] focus:outline-none">
                What do you need help with right now?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Choose a starting point. You can explain more in chat.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {DISCOVERY_NEEDS.map((need) => (
                  <ChoiceButton
                    key={need.id}
                    selected={draft.needId === need.id && !customNeedMode}
                    label={`${need.icon} ${need.label}`}
                    onClick={() => selectNeed(need.id)}
                  />
                ))}
                <ChoiceButton
                  selected={customNeedMode}
                  label="Something else"
                  description="Describe it in your own words."
                  onClick={() => {
                    setCustomNeedMode(true);
                    updateDraft('needId', '');
                  }}
                />
              </div>
              {customNeedMode ? (
                <label className="mt-4 block text-sm font-semibold text-slate-800">
                  What kind of help are you looking for?
                  <textarea
                    value={draft.customNeed}
                    onChange={(event) => updateDraft('customNeed', event.target.value)}
                    maxLength={160}
                    rows={3}
                    autoFocus
                    placeholder="For example: help replacing an ID after a fire"
                    className="mt-2 w-full rounded-2xl border border-slate-400 bg-white px-4 py-3 text-base text-slate-950 outline-none focus:border-[var(--brand-azure)] focus:ring-2 focus:ring-blue-200"
                  />
                </label>
              ) : null}
              <WhyThisHelps>Your answer starts the search. It does not prove eligibility or limit you to one category.</WhyThisHelps>
              <StepActions next={() => setStep(1)} nextDisabled={!hasOnboardingNeed(draft)} />
            </div>
          ) : null}

          {step === 1 ? (
            <div>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[var(--brand-navy)] focus:outline-none">
                Where and how soon?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Nationwide search is available. Share only an approximate area if local services would help.</p>

              <label className="mt-6 block text-sm font-semibold text-slate-800" htmlFor="onboarding-location">
                City, county, or ZIP code <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <div className="relative mt-2">
                <MapPin className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-[var(--brand-cobalt)]" aria-hidden="true" />
                <input
                  id="onboarding-location"
                  value={draft.approximateLocation}
                  onChange={(event) => updateDraft('approximateLocation', event.target.value)}
                  maxLength={100}
                  autoComplete="postal-code"
                  placeholder="For example: Tacoma, WA or 98402"
                  className="min-h-12 w-full rounded-2xl border border-slate-400 bg-white py-3 pl-11 pr-4 text-base text-slate-950 outline-none focus:border-[var(--brand-azure)] focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">ORAN does not request precise GPS location during onboarding.</p>

              <fieldset className="mt-7">
                <legend className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Clock3 className="h-4 w-4 text-[var(--brand-cobalt)]" aria-hidden="true" /> How soon do you need help? <span className="font-normal text-slate-500">(optional)</span>
                </legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {URGENCY_OPTIONS.map((option) => (
                    <ChoiceButton
                      key={option.value}
                      selected={draft.urgency === option.value}
                      label={option.label}
                      description={option.description}
                      onClick={() => updateDraft('urgency', option.value)}
                    />
                  ))}
                </div>
              </fieldset>

              <WhyThisHelps>Approximate area and timing help prioritize reachable services. Leaving either blank keeps the search broad.</WhyThisHelps>
              <StepActions back={() => setStep(0)} next={() => setStep(2)} />
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[var(--brand-navy)] focus:outline-none">
                Who needs the help?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">This can change which programs and age groups are relevant. Both answers are optional.</p>

              <fieldset className="mt-6">
                <legend className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Users className="h-4 w-4 text-[var(--brand-cobalt)]" aria-hidden="true" /> This help is for…
                </legend>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {AUDIENCE_OPTIONS.map((option) => (
                    <ChoiceButton
                      key={option.value}
                      selected={draft.audience === option.value}
                      label={option.label}
                      onClick={() => updateDraft('audience', option.value)}
                    />
                  ))}
                </div>
              </fieldset>

              <label className="mt-7 block text-sm font-semibold text-slate-800" htmlFor="onboarding-household-size">
                Number of people in the household <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="onboarding-household-size"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                value={draft.householdSize ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return updateDraft('householdSize', null);
                  const parsed = Number(value);
                  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20) {
                    updateDraft('householdSize', parsed);
                  }
                }}
                className="mt-2 min-h-12 w-full rounded-2xl border border-slate-400 bg-white px-4 py-3 text-base text-slate-950 outline-none focus:border-[var(--brand-azure)] focus:ring-2 focus:ring-blue-200 sm:max-w-xs"
              />
              <WhyThisHelps>Some benefits use household size. ORAN asks for a count, not names, birthdays, or relationship documents.</WhyThisHelps>
              <StepActions back={() => setStep(1)} next={() => setStep(3)} />
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[var(--brand-navy)] focus:outline-none">
                Add details only if they help.
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                These questions may improve matching, but none is required. Skipping them never blocks search.
              </p>

              {!showOptionalDetails ? (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setStep(4)}
                    className="rounded-2xl border border-slate-400 bg-white p-5 text-left transition hover:border-[var(--brand-azure)] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-azure)]"
                  >
                    <span className="block text-base font-bold text-[var(--brand-navy)]">Skip optional questions</span>
                    <span className="mt-2 block text-sm leading-6 text-slate-600">Continue with need, area, timing, and household context only.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOptionalDetails(true)}
                    className="bg-gradient-brand-deep rounded-2xl border border-[var(--brand-azure)] p-5 text-left text-white shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-azure)] focus-visible:ring-offset-2"
                  >
                    <span className="block text-base font-bold">Add optional matching details</span>
                    <span className="mt-2 block text-sm leading-6 text-slate-200">Choose only the work, access, veteran, or immigration-support context you want to use.</span>
                  </button>
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  <section className="rounded-2xl border border-slate-300 bg-slate-50 p-4 sm:p-5" aria-labelledby="work-income-heading">
                    <h3 id="work-income-heading" className="flex items-center gap-2 text-base font-bold text-[var(--brand-navy)]">
                      <BriefcaseBusiness className="h-5 w-5 text-[var(--brand-cobalt)]" aria-hidden="true" /> Work and income bands
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-slate-600">Why this helps: some programs screen on broad work and household-income bands. Exact income is never requested here.</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-slate-800">
                        Employment context <span className="font-normal text-slate-500">(optional)</span>
                        <select
                          value={draft.employmentStatus}
                          onChange={(event) => updateDraft('employmentStatus', event.target.value as OnboardingDraft['employmentStatus'])}
                          className="mt-2 min-h-[48px] w-full rounded-xl border border-slate-400 bg-white px-3 text-sm text-slate-950 focus:border-[var(--brand-azure)] focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                          <option value="">Skip this question</option>
                          {EMPLOYMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-slate-800">
                        Approximate monthly household income <span className="font-normal text-slate-500">(optional)</span>
                        <select
                          value={draft.incomeRange}
                          onChange={(event) => updateDraft('incomeRange', event.target.value as OnboardingDraft['incomeRange'])}
                          className="mt-2 min-h-[48px] w-full rounded-xl border border-slate-400 bg-white px-3 text-sm text-slate-950 focus:border-[var(--brand-azure)] focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                          <option value="">Skip this question</option>
                          {INCOME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    </div>
                  </section>

                  <fieldset className="rounded-2xl border border-slate-300 bg-slate-50 p-4 sm:p-5">
                    <legend className="flex items-center gap-2 px-1 text-base font-bold text-[var(--brand-navy)]">
                      <Accessibility className="h-5 w-5 text-[var(--brand-cobalt)]" aria-hidden="true" /> Access preferences <span className="text-xs font-normal text-slate-500">(optional)</span>
                    </legend>
                    <p className="mt-1 text-xs leading-5 text-slate-600">Why this helps: prioritize providers whose access options are actually documented.</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {ACCESSIBILITY_OPTIONS.map((option) => (
                        <OptionalCheckbox
                          key={option.value}
                          checked={draft.accessibilityNeeds.includes(option.value)}
                          label={option.label}
                          onChange={(checked) => toggleAccessibility(option.value, checked)}
                        />
                      ))}
                    </div>
                  </fieldset>

                  <section className="rounded-2xl border border-slate-300 bg-slate-50 p-4 sm:p-5" aria-labelledby="veteran-support-heading">
                    <h3 id="veteran-support-heading" className="text-base font-bold text-[var(--brand-navy)]">Veteran and military-family services <span className="text-xs font-normal text-slate-500">(optional)</span></h3>
                    <p className="mt-1 text-xs leading-5 text-slate-600">Why this helps: some programs are reserved for people who served and their families. You do not need to explain a service record here.</p>
                    <div className="mt-4">
                      <OptionalCheckbox
                        checked={draft.veteranSupport}
                        label="Include veteran or military-family programs"
                        onChange={(checked) => updateDraft('veteranSupport', checked)}
                      />
                    </div>
                  </section>

                  <fieldset className="rounded-2xl border border-slate-300 bg-slate-50 p-4 sm:p-5">
                    <legend className="px-1 text-base font-bold text-[var(--brand-navy)]">Immigration-related support <span className="text-xs font-normal text-slate-500">(optional)</span></legend>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Why this helps: choose a service feature—not an immigration status. ORAN does not ask whether anyone is documented, a citizen, or a visa holder.
                    </p>
                    <div className="mt-4 grid gap-2">
                      {IMMIGRATION_SUPPORT_OPTIONS.map((option) => (
                        <OptionalCheckbox
                          key={option.value}
                          checked={draft.immigrationSupportNeeds.includes(option.value)}
                          label={option.label}
                          onChange={(checked) => toggleImmigrationSupport(option.value, checked)}
                        />
                      ))}
                    </div>
                  </fieldset>

                  <StepActions back={() => setStep(2)} next={() => setStep(4)} nextLabel="Review privacy choices" />
                </div>
              )}

              {!showOptionalDetails ? (
                <div className="mt-6">
                  <Button type="button" variant="ghost" onClick={() => setStep(2)} className="min-h-[48px] px-5">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-[var(--brand-navy)] focus:outline-none">
                Choose what ORAN remembers.
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Review the context that will be copied into chat, then choose one-time use or profile storage.</p>

              <dl className="mt-6 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-300 bg-slate-50">
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Immediate need</dt>
                  <dd className="text-sm font-semibold text-slate-900 sm:col-span-2">{draft.customNeed.trim() || selectedNeed?.label || 'Not provided'}</dd>
                </div>
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Area and timing</dt>
                  <dd className="text-sm text-slate-800 sm:col-span-2">{[draft.approximateLocation.trim() || 'Nationwide', urgencyLabel].filter(Boolean).join(' · ')}</dd>
                </div>
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Household</dt>
                  <dd className="text-sm text-slate-800 sm:col-span-2">{[audienceLabel, draft.householdSize ? `${draft.householdSize} people` : undefined].filter(Boolean).join(' · ') || 'Not shared'}</dd>
                </div>
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Optional context</dt>
                  <dd className="text-sm text-slate-800 sm:col-span-2">{optionalSummary.join(' · ') || 'None added'}</dd>
                </div>
              </dl>

              <div className="bg-gradient-brand-deep mt-6 rounded-2xl border border-[var(--brand-azure)] p-5 text-white">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-[var(--brand-sky)]" aria-hidden="true" />
                  <div>
                    <h3 className="font-bold">Your choice controls storage</h3>
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-blue-50">
                      <li><strong>Use once:</strong> moves these answers into the next chat through a one-time browser handoff. Nothing is added to your profile.</li>
                      <li><strong>Save to profile:</strong> stores the selected matching context on this device. It syncs to your account only if cross-device sync is already enabled.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {error ? (
                <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
              ) : null}

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => void continueToChat(false)}
                  className="min-h-[60px] rounded-xl border-slate-400 px-5 text-slate-950"
                >
                  Use once in chat
                </Button>
                <Button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void continueToChat(true)}
                  className="bg-gradient-brand min-h-[60px] rounded-xl px-5 text-white shadow-lg hover:brightness-110"
                >
                  {isSaving ? 'Preparing chat…' : 'Save to profile & continue'}
                  {!isSaving ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
                </Button>
              </div>
              <div className="mt-4 text-center">
                <button type="button" onClick={() => setStep(0)} className="text-sm font-semibold text-[var(--brand-cobalt)] underline-offset-4 hover:underline">
                  Edit answers
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-5 text-slate-600">
          Never enter a Social Security number, full birth date, immigration document number, medical record number, or case number in onboarding.
        </p>
      </div>
    </main>
  );
}
