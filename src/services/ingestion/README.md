# ORAN Ingestion Service

This module handles automated service data ingestion, including LLM-assisted tagging of resources from unstructured sources.

## Files

- `tagging-prompt.ts` — LLM prompt templates for extracting tags from service descriptions
- `tag-extractor.ts` — LLM-agnostic tag extraction logic
- `README.md` — This file

## Usage

The LLM ingestion agent uses these modules to:

1. Parse unstructured service data (website scrapes, PDF text, etc.)
2. Extract structured tags using the taxonomy defined in `src/domain/taxonomy.ts`
3. Validate tags before database insertion
4. Generate confidence scores for extracted tags

## Example Flow

```typescript
import { generateTaggingPrompt, extractTagsFromResponse } from './tagging-prompt';
import { ALL_TAXONOMIES } from '@/domain/taxonomy';

// 1. Raw service text from scrape
const rawText = `
  Downtown Food Bank - Open Mon-Fri 9-5, Saturdays 10-2.
  Free food for anyone in need. No ID required. Drive-through and delivery available.
  Halal and kosher options by request. Wheelchair accessible building.
  Spanish-speaking staff available. We serve undocumented community members.
`;

// 2. Generate prompt for LLM
const prompt = generateTaggingPrompt(rawText);

// 3. Send to LLM (OpenAI, Anthropic, Azure OpenAI, etc.)
const llmResponse = await callYourLLM(prompt);

// 4. Parse response into structured tags
const tags = extractTagsFromResponse(llmResponse);
// → { delivery: ['in_person', 'drive_through', 'delivery_available'],
//     cost: ['free'],
//     access: ['walk_in', 'no_id_required', 'weekend_hours'],
//     culture: ['spanish_speaking_staff'],
//     population: ['undocumented_friendly'],
//     dietary: [{ type: 'halal', availability: 'by_request' }, ...],
//     accessibility: ['wheelchair'] }
```

## Safety Notes

- Tags are validated against `src/domain/taxonomy.ts` before insertion
- LLM-generated tags MUST be reviewed before going live (see verification_queue)
- Confidence scores from LLM should be captured for audit
