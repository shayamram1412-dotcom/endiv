import { insert } from './db.ts';
import { nowISO } from '../../shared/dates.ts';

export interface AuditEntry {
  entity: string;
  entityId: number;
  eventId?: number | null;
  clientId?: number | null;
  userId: number | null;
  action: string;
  summary?: string;
  diff?: Record<string, { from: unknown; to: unknown }> | Record<string, unknown>;
}

export function audit(e: AuditEntry): void {
  insert('audit_log', {
    entity: e.entity,
    entity_id: e.entityId,
    event_id: e.eventId ?? null,
    client_id: e.clientId ?? null,
    user_id: e.userId,
    action: e.action,
    summary: e.summary ?? '',
    diff: JSON.stringify(e.diff ?? {}),
    at: nowISO(),
  });
}
