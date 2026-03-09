import { describe, expect, it } from 'vitest';
import { getSavedTogglePresentation } from '../presentation';

describe('saved presentation helpers', () => {
  it('describes local-only save actions', () => {
    expect(getSavedTogglePresentation(false, false)).toEqual({
      ariaLabel: 'Save this service on this device',
      title: 'Save on this device',
      toastMessage: 'Saved on this device',
    });
    expect(getSavedTogglePresentation(true, false)).toEqual({
      ariaLabel: 'Remove this service from this device',
      title: 'Remove from this device',
      toastMessage: 'Removed from this device',
    });
  });

  it('describes synced save actions', () => {
    expect(getSavedTogglePresentation(false, true)).toEqual({
      ariaLabel: 'Save this service to this device and your synced account',
      title: 'Save to this device and your synced account',
      toastMessage: 'Saved to this device and your synced account',
    });
    expect(getSavedTogglePresentation(true, true)).toEqual({
      ariaLabel: 'Remove this service from this device and your synced account',
      title: 'Remove from this device and your synced account',
      toastMessage: 'Removed from this device and your synced account',
    });
  });
});
