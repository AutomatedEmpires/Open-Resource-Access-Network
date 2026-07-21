import { z } from 'zod';
import {
  parseGuidedIntakeRequest,
  type GuidedIntakeRequestValue,
} from '@/services/chat/guidedIntakeValidation';

export const GuidedIntakeRequestSchema = z.unknown().transform((value, context) => {
  const parsed = parseGuidedIntakeRequest(value);
  if (!parsed.success) {
    context.addIssue({ code: 'custom', message: parsed.message });
    return z.NEVER;
  }
  return parsed.data;
});

export type GuidedIntakeRequest = GuidedIntakeRequestValue;
