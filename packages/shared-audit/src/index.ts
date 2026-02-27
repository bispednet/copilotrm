import type { AuditRecord } from '@bisp/shared-types';

export class AuditTrail {
  private records: AuditRecord[] = [];

  write(record: AuditRecord): void {
    this.records.push(record);
  }

  list(): AuditRecord[] {
    return [...this.records];
  }

  byType(type: string): AuditRecord[] {
    return this.records.filter((r) => r.type === type);
  }
}

export function makeAuditRecord(actor: string, type: string, payload: Record<string, unknown>): AuditRecord {
  return {
    id: `audit_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    actor,
    type,
    payload,
  };
}
