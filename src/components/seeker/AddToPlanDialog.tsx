'use client';

import React, { useCallback, useState } from 'react';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { SeekerPlanItemUrgency, SeekerPlanServiceSnapshot } from '@/domain/execution';
import {
  addServicePlanItem,
  createSeekerPlan,
  getActiveSeekerPlan,
  readStoredSeekerPlansState,
  setActiveSeekerPlan,
} from '@/services/plans/client';
import { useSeekerFeatureFlags } from '@/components/seeker/SeekerFeatureFlags';

const URGENCY_OPTIONS: Array<{ value: SeekerPlanItemUrgency; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'later', label: 'Later' },
  { value: 'backup', label: 'Backup' },
];

interface AddToPlanDialogProps {
  service: SeekerPlanServiceSnapshot;
  triggerLabel?: string;
  triggerClassName?: string;
  source?: 'saved_service' | 'directory_service' | 'chat_service';
}

export function AddToPlanDialog({
  service,
  triggerLabel = 'Add to plan',
  triggerClassName,
  source = 'saved_service',
}: AddToPlanDialogProps) {
  const { planEnabled } = useSeekerFeatureFlags();
  const [open, setOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [urgency, setUrgency] = useState<SeekerPlanItemUrgency>('this_week');
  const [note, setNote] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const { success } = useToast();

  const plansState = readStoredSeekerPlansState();
  const activePlan = getActiveSeekerPlan(plansState);

  const resetFormState = useCallback(() => {
    setSelectedPlanId(activePlan?.id ?? '__new__');
    setNewPlanTitle(activePlan ? '' : 'Current plan');
    setUrgency('this_week');
    setNote('');
    setTargetDate('');
  }, [activePlan]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      resetFormState();
    }
    setOpen(nextOpen);
  }, [resetFormState]);

  if (!planEnabled) {
    return null;
  }

  const handleSubmit = () => {
    let planId = selectedPlanId;
    if (planId === '__new__' || !planId) {
      const created = createSeekerPlan(newPlanTitle || 'Current plan');
      if (!created.plan) {
        return;
      }
      planId = created.plan.id;
    }

    setActiveSeekerPlan(planId);
    const result = addServicePlanItem(planId, service, {
      note,
      urgency,
      targetDate,
      source,
    });

    success(result.alreadyExists
      ? `${service.serviceName} is already in your active plan.`
      : `${service.serviceName} added to your plan.`);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className={triggerClassName ?? 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800'}
      >
        <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
        {triggerLabel}
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg rounded-[28px] border border-slate-200 bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
            <DialogTitle className="text-xl font-semibold text-slate-900">Add to plan</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              Put {service.serviceName} into a real action plan without losing the verified-service link.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
                <div>
                  <p className="font-medium text-slate-900">Provider facts stay linked.</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">The plan item points back to this stored service record so trust and detail review stay intact.</p>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Plan</label>
              <select
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
                className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                {plansState.plans.filter((plan) => plan.status === 'active').map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.title}</option>
                ))}
                <option value="__new__">Create a new plan</option>
              </select>
            </div>

            {selectedPlanId === '__new__' && (
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">New plan title</label>
                <input
                  type="text"
                  value={newPlanTitle}
                  onChange={(event) => setNewPlanTitle(event.target.value)}
                  placeholder="Current plan"
                  className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Urgency</label>
                <select
                  value={urgency}
                  onChange={(event) => setUrgency(event.target.value as SeekerPlanItemUrgency)}
                  className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                  {URGENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Target date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Plan note</label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Why this matters or what you need to do next"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmit} className="gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add to plan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AddToPlanDialog;
