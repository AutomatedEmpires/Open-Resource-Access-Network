import type { AuditEvent } from './contracts';
import type { AuditStore } from './stores';

/**
 * Minimal writer interface for pipeline stages that only need to append.
 * Kept for backward compatibility — new code should prefer AuditStore.
 */
export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}

/**
 * In-memory implementation of the full AuditStore interface.
 * Useful for tests and short-lived pipeline runs.
 * WARNING: all events are lost when the process exits.
 */
export class InMemoryAuditWriter implements AuditStore {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async listByCorrelation(correlationId: string): Promise<AuditEvent[]> {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  async listByTarget(targetType: string, targetId: string): Promise<AuditEvent[]> {
    return this.events.filter(
      (e) => e.targetType === targetType && e.targetId === targetId
    );
  }

  async listByType(eventType: string, limit = 100): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => e.eventType === eventType)
      .slice(0, limit);
  }

  /** Return a defensive copy of all stored events (test helper). */
  snapshot(): AuditEvent[] {
    return [...this.events];
  }
}
