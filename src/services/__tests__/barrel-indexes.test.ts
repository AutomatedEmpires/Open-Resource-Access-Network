import { describe, expect, it } from 'vitest';

import * as authIndex from '../auth';
import * as authSessionModule from '../auth/session';
import * as authGuardsModule from '../auth/guards';

import * as ingestionIndex from '../ingestion';
import * as taggingPromptModule from '../ingestion/tagging-prompt';

describe('services barrel indexes', () => {
  it('re-exports auth session and guard helpers', () => {
    expect(authIndex.getAuthContext).toBe(authSessionModule.getAuthContext);
    expect(authIndex.shouldEnforceAuth).toBe(authSessionModule.shouldEnforceAuth);
    expect(authIndex.requireRole).toBe(authGuardsModule.requireRole);
    expect(authIndex.requireOrgAccess).toBe(authGuardsModule.requireOrgAccess);
    expect(authIndex.canManageTeam).toBe(authGuardsModule.canManageTeam);
  });

  it('re-exports ingestion tagging helpers', () => {
    expect(ingestionIndex.generateTaggingPrompt).toBe(taggingPromptModule.generateTaggingPrompt);
    expect(ingestionIndex.generateQuickTaggingPrompt).toBe(taggingPromptModule.generateQuickTaggingPrompt);
    expect(ingestionIndex.extractTagsFromResponse).toBe(taggingPromptModule.extractTagsFromResponse);
    expect(ingestionIndex.validateAndFilterTags).toBe(taggingPromptModule.validateAndFilterTags);
  });
});
