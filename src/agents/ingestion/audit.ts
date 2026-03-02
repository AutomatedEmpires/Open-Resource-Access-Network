import type { AuditEvent } from './contracts';

export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditWriter implements AuditWriter {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  snapshot(): AuditEvent[] {
    return [...this.events];
  }
}
