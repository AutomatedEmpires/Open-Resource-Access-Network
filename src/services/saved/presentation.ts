export interface SavedTogglePresentation {
  ariaLabel: string;
  title: string;
  toastMessage: string;
}

export function getSavedTogglePresentation(
  isSaved: boolean,
  serverSyncEnabled: boolean,
): SavedTogglePresentation {
  if (isSaved) {
    return serverSyncEnabled
      ? {
          ariaLabel: 'Remove this service from this device and your synced account',
          title: 'Remove from this device and your synced account',
          toastMessage: 'Removed from this device and your synced account',
        }
      : {
          ariaLabel: 'Remove this service from this device',
          title: 'Remove from this device',
          toastMessage: 'Removed from this device',
        };
  }

  return serverSyncEnabled
    ? {
        ariaLabel: 'Save this service to this device and your synced account',
        title: 'Save to this device and your synced account',
        toastMessage: 'Saved to this device and your synced account',
      }
    : {
        ariaLabel: 'Save this service on this device',
        title: 'Save on this device',
        toastMessage: 'Saved on this device',
      };
}
