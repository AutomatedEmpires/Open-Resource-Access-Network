import { describe, it, expect, beforeEach } from 'vitest';
import type { AuditEvent } from '../contracts';
import { InMemoryAuditWriter } from '../audit';

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: 'ae-1',
    correlationId: 'job-100',
    eventType: 'candidate.located',
    actorType: 'system',
    actorId: 'agent-scraper',
    targetType: 'candidate',
    targetId: 'cand-1',
    timestamp: '2026-03-03T00:00:00Z',
    inputs: {},
    outputs: {},
    evidenceRefs: [],
    ...overrides,
  };
}

describe('InMemoryAuditWriter (AuditStore)', () => {
  let store: InMemoryAuditWriter;

  beforeEach(() => {
    store = new InMemoryAuditWriter();
  });

  it('append stores events retrievable via snapshot', async () => {
    const event = makeEvent();
    await store.append(event);

    const all = store.snapshot();
    expect(all).toHaveLength(1);
    expect(all[0].eventId).toBe('ae-1');
  });

  it('listByCorrelation filters by correlationId', async () => {
    await store.append(makeEvent({ correlationId: 'job-100' }));
    await store.append(makeEvent({ eventId: 'ae-2', correlationId: 'job-200' }));
    await store.append(makeEvent({ eventId: 'ae-3', correlationId: 'job-100' }));

    const result = await store.listByCorrelation('job-100');
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.correlationId === 'job-100')).toBe(true);
  });

  it('listByCorrelation returns empty for unknown correlationId', async () => {
    await store.append(makeEvent());
    const result = await store.listByCorrelation('nonexistent');
    expect(result).toHaveLength(0);
  });

  it('listByTarget filters by targetType and targetId', async () => {
    await store.append(makeEvent({ targetType: 'candidate', targetId: 'cand-1' }));
    await store.append(makeEvent({ eventId: 'ae-2', targetType: 'evidence', targetId: 'ev-1' }));
    await store.append(makeEvent({ eventId: 'ae-3', targetType: 'candidate', targetId: 'cand-1' }));

    const result = await store.listByTarget('candidate', 'cand-1');
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.targetId === 'cand-1')).toBe(true);
  });

  it('listByTarget matches both targetType AND targetId', async () => {
    await store.append(makeEvent({ targetType: 'candidate', targetId: 'cand-1' }));
    await store.append(makeEvent({ eventId: 'ae-2', targetType: 'evidence', targetId: 'cand-1' }));

    const result = await store.listByTarget('candidate', 'cand-1');
    expect(result).toHaveLength(1);
    expect(result[0].targetType).toBe('candidate');
  });

  it('listByType filters by eventType', async () => {
    await store.append(makeEvent({ eventType: 'candidate.located' }));
    await store.append(makeEvent({ eventId: 'ae-2', eventType: 'evidence.fetched' }));
    await store.append(makeEvent({ eventId: 'ae-3', eventType: 'candidate.located' }));

    const result = await store.listByType('candidate.located');
    expect(result).toHaveLength(2);
  });

  it('listByType respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await store.append(makeEvent({ eventId: `ae-${i}`, eventType: 'extract.completed' }));
    }

    const result = await store.listByType('extract.completed', 3);
    expect(result).toHaveLength(3);
  });

  it('snapshot returns a defensive copy', async () => {
    await store.append(makeEvent());
    const snap1 = store.snapshot();
    snap1.push(makeEvent({ eventId: 'injected' }));

    const snap2 = store.snapshot();
    expect(snap2).toHaveLength(1);
  });

  it('preserves full event fields through append and retrieval', async () => {
    const event = makeEvent({
      inputs: { url: 'https://example.gov' },
      outputs: { candidateCount: 3 },
      evidenceRefs: ['ev-1', 'ev-2'],
    });
    await store.append(event);

    const [retrieved] = await store.listByCorrelation('job-100');
    expect(retrieved.inputs).toEqual({ url: 'https://example.gov' });
    expect(retrieved.outputs).toEqual({ candidateCount: 3 });
    expect(retrieved.evidenceRefs).toEqual(['ev-1', 'ev-2']);
  });
});
