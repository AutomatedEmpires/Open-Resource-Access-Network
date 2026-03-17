'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Check, FolderPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import {
  addServerSavedCollectionAssignment,
  createSavedCollection,
  createServerSavedCollection,
  fetchServerSavedCollectionsState,
  mergeSavedCollectionsStates,
  readStoredSavedCollectionsState,
  removeServerSavedCollectionAssignment,
  toggleSavedServiceCollection,
  writeStoredSavedCollectionsState,
  type SavedCollectionsState,
} from '@/services/saved/client';

function useOptionalToast() {
  try {
    return useToast();
  } catch {
    return { success: (_message: string) => {} };
  }
}

interface SavedCollectionsDialogProps {
  serviceId: string;
  serviceName: string;
  isSaved?: boolean;
  onEnsureSaved?: () => void;
  savedSyncEnabled?: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
}

export function SavedCollectionsDialog({
  serviceId,
  serviceName,
  isSaved = false,
  onEnsureSaved,
  savedSyncEnabled = false,
  triggerLabel,
  triggerClassName,
}: SavedCollectionsDialogProps) {
  const [open, setOpen] = useState(false);
  const [collectionsState, setCollectionsState] = useState<SavedCollectionsState>(() => readStoredSavedCollectionsState());
  const [newCollectionName, setNewCollectionName] = useState('');
  const [localSavedOverride, setLocalSavedOverride] = useState(false);
  const [isSyncingCollections, setIsSyncingCollections] = useState(false);
  const { success } = useOptionalToast();

  const effectiveSaved = isSaved || localSavedOverride;
  const assignedCollections = useMemo(
    () => collectionsState.serviceAssignments[serviceId] ?? [],
    [collectionsState.serviceAssignments, serviceId],
  );

  const syncCollectionsState = useCallback(async () => {
    const localState = readStoredSavedCollectionsState();
    setCollectionsState(localState);

    if (!savedSyncEnabled) {
      return;
    }

    setIsSyncingCollections(true);
    const serverState = await fetchServerSavedCollectionsState();
    if (serverState) {
      const merged = mergeSavedCollectionsStates(serverState, localState);
      writeStoredSavedCollectionsState(merged);
      setCollectionsState(merged);
    }
    setIsSyncingCollections(false);
  }, [savedSyncEnabled]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void syncCollectionsState();
  }, [open, syncCollectionsState]);

  const ensureServiceSaved = useCallback(() => {
    if (effectiveSaved || !onEnsureSaved) {
      return;
    }

    onEnsureSaved();
    setLocalSavedOverride(true);
  }, [effectiveSaved, onEnsureSaved]);

  const handleCreateCollection = useCallback(() => {
    void (async () => {
      const created = createSavedCollection(newCollectionName);
      if (!created) {
        return;
      }

      let nextState = readStoredSavedCollectionsState();
      if (savedSyncEnabled) {
        const serverCollection = await createServerSavedCollection(created.name);
        if (serverCollection) {
          nextState = {
            ...nextState,
            collections: nextState.collections.map((collection) => (
              collection.id === created.id ? serverCollection : collection
            )),
            serviceAssignments: Object.fromEntries(
              Object.entries(nextState.serviceAssignments).map(([savedServiceId, collectionIds]) => [
                savedServiceId,
                collectionIds.map((collectionId) => (collectionId === created.id ? serverCollection.id : collectionId)),
              ]),
            ),
          };
          writeStoredSavedCollectionsState(nextState);
        }
      }

      setCollectionsState(nextState);
      setNewCollectionName('');
      success(`Created ${created.name}`);
    })();
  }, [newCollectionName, savedSyncEnabled, success]);

  const handleToggleCollection = useCallback((collectionId: string) => {
    void (async () => {
      ensureServiceSaved();
      const wasAssigned = assignedCollections.includes(collectionId);
      const nextState = toggleSavedServiceCollection(serviceId, collectionId);
      setCollectionsState(nextState);

      if (savedSyncEnabled) {
        if (wasAssigned) {
          await removeServerSavedCollectionAssignment(collectionId, serviceId);
        } else {
          await addServerSavedCollectionAssignment(collectionId, serviceId);
        }
      }

      success(wasAssigned ? 'Removed from collection.' : 'Added to collection.');
    })();
  }, [assignedCollections, ensureServiceSaved, savedSyncEnabled, serviceId, success]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName ?? 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800'}
      >
        <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
        {triggerLabel ?? (effectiveSaved ? 'Collections' : 'Save + organize')}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl rounded-[28px] border border-slate-200 bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-200 px-6 py-5 text-left">
            <DialogTitle className="text-xl font-semibold text-slate-900">Organize saved service</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-500">
              Add {serviceName} to one or more collections so it stays easy to find later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            {!effectiveSaved ? (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="flex items-start gap-3">
                  <BookmarkPlus className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-slate-900">This will save the service first.</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Collections are part of the saved workspace, so ORAN will save this service before assigning it.</p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                  placeholder="Create a collection"
                  className="h-10 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                />
                <Button type="button" size="sm" onClick={handleCreateCollection} disabled={!newCollectionName.trim()}>
                  Add collection
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {savedSyncEnabled
                  ? isSyncingCollections ? 'Checking account collections…' : 'Collections can sync when your signed-in account is available.'
                  : 'Collections stay on this device.'}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Collections</p>
              {collectionsState.collections.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {collectionsState.collections.map((collection) => {
                    const assigned = assignedCollections.includes(collection.id);
                    return (
                      <button
                        key={collection.id}
                        type="button"
                        onClick={() => handleToggleCollection(collection.id)}
                        className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${assigned ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                        aria-pressed={assigned}
                      >
                        {assigned ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                        {collection.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-[18px] border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">Create your first collection to organize saved services by need, urgency, or next step.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SavedCollectionsDialog;