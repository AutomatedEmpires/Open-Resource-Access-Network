import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the openai module — use vi.hoisted so the variable exists when the
// vi.mock factory runs (vi.mock is hoisted above all imports by Vitest).
// ---------------------------------------------------------------------------

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  AzureOpenAI: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mockCreate } } };
  }),
}));

import { summarizeWithLLM } from '@/services/chat/llm';
import { ELIGIBILITY_DISCLAIMER } from '@/domain/constants';
import type { EnrichedService } from '@/domain/types';
import type { Intent } from '@/services/chat/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(overrides: Partial<EnrichedService> = {}): EnrichedService {
  return {
    service: {
      id: 'svc-1',
      name: 'City Food Bank',
      description: 'Emergency food assistance for residents.',
      url: 'https://example.org',
      organizationId: 'org-1',
      locationId: null,
      status: 'active',
      interpretationServices: null,
      applicationProcess: null,
      feesDescription: null,
      accreditations: null,
      licenses: null,
      alert: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EnrichedService['service'],
    organization: {
      id: 'org-1',
      name: 'City Relief Services',
      description: null,
      email: null,
      url: null,
      taxStatus: null,
      taxId: null,
      yearIncorporated: null,
      legalStatus: null,
      logoUrl: null,
      uri: null,
      parentOrganizationId: null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EnrichedService['organization'],
    phones: [{ id: 'p1', number: '555-1234', serviceId: null, organizationId: null, locationId: null, contactId: null, type: null, extension: null, language: null, description: null }],
    schedules: [{ id: 'sch1', serviceId: 'svc-1', locationId: null, serviceAtLocationId: null, validFrom: null, validTo: null, dtstart: null, freq: null, interval: null, byday: null, bymonthday: null, description: 'Mon–Fri 9am–5pm', opensAt: null, closesAt: null, timezone: null, count: null, until: null, excludedDate: null }],
    taxonomyTerms: [],
    eligibility: [{ id: 'el1', serviceId: 'svc-1', description: 'Income below 200% FPL', eligibilityType: null, minimumAge: null, maximumAge: null, gender: null, url: null }],
    address: {
      id: 'addr1',
      locationId: 'loc1',
      address1: '100 Main St',
      address2: null,
      city: 'Springfield',
      stateProvince: 'IL',
      postalCode: '62701',
      country: 'US',
      region: null,
      attention: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EnrichedService['address'],
    ...overrides,
  } as EnrichedService;
}

function makeIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    category: 'food',
    rawQuery: 'food bank near me',
    urgencyQualifier: 'standard',
    ...overrides,
  } as Intent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('summarizeWithLLM', () => {
  beforeAll(() => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com/';
    process.env.AZURE_OPENAI_KEY = 'test-key';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'gpt-4o-mini';
    process.env.AZURE_OPENAI_API_VERSION = '2024-07-01-preview';
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns LLM content with eligibility disclaimer appended', async () => {
    const llmContent = 'City Food Bank offers emergency food assistance Monday through Friday.';
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: llmContent } }],
    });

    const result = await summarizeWithLLM([makeService()], makeIntent());

    expect(result).toContain(llmContent);
    expect(result).toContain(ELIGIBILITY_DISCLAIMER);
    // Disclaimer appears after content
    expect(result.indexOf(llmContent)).toBeLessThan(result.indexOf(ELIGIBILITY_DISCLAIMER));
  });

  it('calls the API with temperature=0.2 and max_tokens=300', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Some summary.' } }],
    });

    await summarizeWithLLM([makeService()], makeIntent());

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.2,
        max_tokens: 300,
      })
    );
  });

  it('includes category label in user message', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Summary.' } }],
    });

    await summarizeWithLLM([makeService()], makeIntent({ category: 'mental_health' }));

    const call = mockCreate.mock.calls[0][0];
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('mental health');
  });

  it('marks urgent requests in the user message', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Urgent summary.' } }],
    });

    await summarizeWithLLM([makeService()], makeIntent({ urgencyQualifier: 'urgent' }));

    const call = mockCreate.mock.calls[0][0];
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('urgent');
  });

  it('system prompt forbids inventing facts', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'A summary.' } }],
    });

    await summarizeWithLLM([makeService()], makeIntent());

    const call = mockCreate.mock.calls[0][0];
    const systemMsg = call.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain('Never invent');
  });

  it('throws when the LLM returns an empty response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    await expect(summarizeWithLLM([makeService()], makeIntent())).rejects.toThrow(
      'LLM returned empty response'
    );
  });

  it('throws when the LLM API call fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API timeout'));

    await expect(summarizeWithLLM([makeService()], makeIntent())).rejects.toThrow('API timeout');
  });

  it('caps services at MAX_SERVICES_PER_RESPONSE (5) in the prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Six services found.' } }],
    });

    const sixServices = Array.from({ length: 6 }, (_, i) =>
      makeService({ service: { ...makeService().service, id: `svc-${i}`, name: `Service ${i}` } })
    );

    await summarizeWithLLM(sixServices, makeIntent());

    const call = mockCreate.mock.calls[0][0];
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
    // Only the first 5 records should appear (numbered [1]–[5], not [6])
    expect(userMsg.content).toContain('[5]');
    expect(userMsg.content).not.toContain('[6]');
  });
});
