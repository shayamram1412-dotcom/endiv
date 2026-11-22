/**
 * Which rows a user may see, as SQL. Every list query on venue-owned data goes through one of these.
 *  - clients belong to the venues of their events (a client with no events yet is visible to CRM users);
 *  - warehouses belong to a venue; the central warehouse (venue NULL) only to users with an all-venue grant;
 *  - events: venueFilter in features/events/service.ts.
 */
import { all, get } from './db.ts';
import { venueScope, type Principal } from '../../shared/permissions.ts';

const list = (n: number) => Array.from({ length: n }, () => '?').join(',');

export function clientScope(user: Pick<Principal, 'grants'>, alias = 'c'): { sql: string; params: string[] } {
  const scope = venueScope(user);
  if (scope === null) return { sql: '1 = 1', params: [] };
  if (!scope.length) return { sql: '0 = 1', params: [] };
  return {
    sql: `(NOT EXISTS (SELECT 1 FROM events sx WHERE sx.client_id = ${alias}.id) OR EXISTS (SELECT 1 FROM events sx WHERE sx.client_id = ${alias}.id AND sx.venue IN (${list(scope.length)})))`,
    params: scope,
  };
}

export function clientVisible(user: Pick<Principal, 'grants'>, clientId: number): boolean {
  const s = clientScope(user, 'c');
  return !!get(`SELECT 1 FROM clients c WHERE c.id = ? AND ${s.sql}`, clientId, ...s.params);
}

export function warehouseScope(user: Pick<Principal, 'grants'>, alias = 'w'): { sql: string; params: string[] } {
  const scope = venueScope(user);
  if (scope === null) return { sql: '1 = 1', params: [] };
  if (!scope.length) return { sql: '0 = 1', params: [] };
  return { sql: `${alias}.venue IN (${list(scope.length)})`, params: scope };
}

export function warehouseVenue(id: number): { venue: string | null } | undefined {
  return get<{ venue: string | null }>('SELECT venue FROM warehouses WHERE id = ?', id);
}

/** Events in the user's venues, as a set (for masking rows that mention other venues' events). */
export function visibleEventIds(user: Pick<Principal, 'grants'>, ids: number[]): Set<number> {
  const scope = venueScope(user);
  if (scope === null || !ids.length) return new Set(scope === null ? ids : []);
  return new Set(all<{ id: number }>(`SELECT id FROM events WHERE id IN (${list(ids.length)}) AND venue IN (${list(scope.length)})`, ...ids, ...scope).map((r) => r.id));
}

/** Allocation rows of events outside the user's venues keep their quantities (they share the stock) but not their names. */
export function maskAllocation<R extends { eventId: number; title?: string }, T extends { rows: R[] }>(user: Pick<Principal, 'grants'>, a: T): T {
  const seen = visibleEventIds(user, a.rows.map((r) => r.eventId));
  return { ...a, rows: a.rows.map((r) => (seen.has(r.eventId) ? r : { ...r, title: 'אירוע בנקודה אחרת' })) };
}
