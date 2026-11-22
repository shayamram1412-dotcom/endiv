/**
 * Event domain service: loading, access, and computed facts (portions, raw materials,
 * allocation, readiness, collection). Used by every feature that touches an event.
 */
import { all, get } from '../../core/db.ts';
import { camel, forbidden, notFound, type SessionUser } from '../../core/http.ts';
import { getSettings } from '../../core/settings.ts';
import { can, levelFor, MODULES, venueScope, type Module, type Level } from '../../../shared/permissions.ts';
import { VENUE_RULES, type VenueDefaults, type ConfirmationKind, type ItemKind, type VenueCode } from '../../../shared/domain.ts';
import { portionsFor, rawMaterials, type GuestCounts, type Recipe } from '../../../shared/kitchen.ts';
import { allocate, type Allocation } from '../../../shared/inventory.ts';
import { COVERS, computeReadiness, type Readiness } from '../../../shared/readiness.ts';
import type { Role } from '../../../shared/permissions.ts';
import { summarizeCollection, type CollectionSummary } from '../../../shared/finance.ts';
import { today } from '../../../shared/dates.ts';
import type { MenuSnapshot } from '../../../shared/menuDiff.ts';
import type { EventRecord, MenuLineRecord, RawNeedRecord } from '../../../shared/types.ts';

export function loadEvent(id: number): EventRecord {
  const row = get('SELECT * FROM events WHERE id = ?', id);
  if (!row) throw notFound('האירוע');
  return camel<EventRecord>(row);
}

/** Load an event and verify the user may act on it in `module` at `level`. */
export function eventFor(user: SessionUser, id: number, module: Module = 'events', level: Level = 1): EventRecord {
  const ev = loadEvent(id);
  if (!can(user, 'events', 1, ev.venue)) throw notFound('האירוע');
  if (!can(user, module, level, ev.venue)) {
    throw forbidden(`אין לך הרשאת ${level >= 3 ? 'אישור' : level >= 2 ? 'עריכה' : 'צפייה'} ב${MODULES[module]} באירוע זה`);
  }
  return ev;
}

/** Remove fields the user may not see. */
export function redactEvent(user: SessionUser, ev: EventRecord): EventRecord {
  const out = { ...ev };
  if (!can(user, 'finance', 1, ev.venue)) out.contractTotal = null;
  return out;
}

export function accessMap(user: SessionUser, venue: VenueCode): Record<string, number> {
  return Object.fromEntries(Object.keys(MODULES).map((m) => [m, levelFor(user, m as Module, venue)]));
}

/** SQL fragment restricting events to the user's venues. */
export function venueFilter(user: SessionUser, column = 'e.venue'): { sql: string; params: string[] } {
  const scope = venueScope(user);
  if (scope === null) return { sql: '1 = 1', params: [] };
  if (!scope.length) return { sql: '0 = 1', params: [] };
  return { sql: `${column} IN (${scope.map(() => '?').join(',')})`, params: scope };
}

export const guestCounts = (ev: Pick<EventRecord, 'guests' | 'kids' | 'vegetarian' | 'vegan'>): GuestCounts => ({
  guests: ev.guests,
  kids: ev.kids,
  vegetarian: ev.vegetarian,
  vegan: ev.vegan,
});

export function menuLines(ev: EventRecord): MenuLineRecord[] {
  const rows = all(
    `SELECT m.*, d.name AS dish_name, d.category, d.allergens
       FROM menu_lines m JOIN dishes d ON d.id = m.dish_id
      WHERE m.event_id = ? ORDER BY m.sort, m.id`,
    ev.id,
  ).map((r) => camel<Omit<MenuLineRecord, 'portions'>>(r));
  const f = getSettings().kitchen;
  const counts = guestCounts(ev);
  return rows.map((l) => ({ ...l, portions: portionsFor(l, counts, ev.eventType, f) }));
}

export function recipesFor(dishIds: number[]): Map<number, Recipe> {
  const map = new Map<number, Recipe>();
  if (!dishIds.length) return map;
  const ph = dishIds.map(() => '?').join(',');
  for (const d of all<{ id: number; yield_portions: number }>(`SELECT id, yield_portions FROM dishes WHERE id IN (${ph})`, ...dishIds)) {
    map.set(d.id, { dishId: d.id, yieldPortions: d.yield_portions, lines: [] });
  }
  for (const r of all<{ dish_id: number; item_id: number; qty: number; name: string; unit: string }>(
    `SELECT r.dish_id, r.item_id, r.qty, i.name, i.unit FROM recipe_lines r JOIN items i ON i.id = r.item_id WHERE r.dish_id IN (${ph})`,
    ...dishIds,
  )) {
    map.get(r.dish_id)?.lines.push({ itemId: r.item_id, itemName: r.name, unit: r.unit, qty: r.qty });
  }
  return map;
}

/** Portions per dish, honouring the chef's override in the prep plan. */
export function effectivePortions(ev: EventRecord, lines = menuLines(ev)): { dishId: number; dishName: string; portions: number }[] {
  const overrides = new Map(
    all<{ dish_id: number; portions_override: number | null }>('SELECT dish_id, portions_override FROM prep_plan WHERE event_id = ?', ev.id)
      .map((r) => [r.dish_id, r.portions_override]),
  );
  const byDish = new Map<number, { dishId: number; dishName: string; portions: number }>();
  for (const l of lines) {
    const cur = byDish.get(l.dishId) ?? { dishId: l.dishId, dishName: l.dishName, portions: 0 };
    cur.portions += l.portions;
    byDish.set(l.dishId, cur);
  }
  for (const v of byDish.values()) {
    const o = overrides.get(v.dishId);
    if (o !== null && o !== undefined) v.portions = o;
  }
  return [...byDish.values()];
}

export function defaultWarehouse(kind: ItemKind, venue: VenueCode): number | null {
  if (kind === 'food') {
    return get<{ id: number }>("SELECT id FROM warehouses WHERE venue IS NULL ORDER BY id LIMIT 1")?.id ?? null;
  }
  return (
    get<{ id: number }>('SELECT id FROM warehouses WHERE venue = ? ORDER BY id LIMIT 1', venue)?.id ??
    get<{ id: number }>('SELECT id FROM warehouses WHERE venue IS NULL ORDER BY id LIMIT 1')?.id ??
    null
  );
}

export function balance(itemId: number, warehouseId: number): number {
  return get<{ b: number }>('SELECT COALESCE(SUM(qty), 0) AS b FROM stock_movements WHERE item_id = ? AND warehouse_id = ?', itemId, warehouseId)!.b;
}

export function incoming(itemId: number, warehouseId: number): number {
  return get<{ q: number }>(
    `SELECT COALESCE(SUM(MAX(l.qty - l.received, 0)), 0) AS q
       FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
      WHERE l.item_id = ? AND p.warehouse_id = ? AND p.status IN ('ordered', 'partial')`,
    itemId, warehouseId,
  )!.q;
}

/** Allocation of one item in one warehouse across all open, approved event requirements. */
export function allocationFor(itemId: number, warehouseId: number): Allocation {
  const demands = all<{ event_id: number; date: string; title: string; qty: number }>(
    `SELECT r.event_id, e.date, e.title, r.qty
       FROM requirements r JOIN events e ON e.id = r.event_id
      WHERE r.item_id = ? AND r.warehouse_id = ? AND r.approved_at IS NOT NULL AND r.consumed = 0
        AND e.lifecycle = 'planning'`,
    itemId, warehouseId,
  ).map((d) => ({ eventId: d.event_id, date: d.date, title: d.title, qty: d.qty }));
  return allocate(balance(itemId, warehouseId), demands, incoming(itemId, warehouseId));
}

export function eventRaw(ev: EventRecord): { raw: RawNeedRecord[]; missingRecipes: { dishId: number; dishName: string }[] } {
  const portions = effectivePortions(ev);
  const recipes = recipesFor(portions.map((p) => p.dishId));
  const { needs, missingRecipes } = rawMaterials(portions, recipes);
  const reqs = new Map(
    all<{ item_id: number; qty: number; approved_at: string | null; source: 'menu' | 'manual'; warehouse_id: number | null }>(
      'SELECT item_id, qty, approved_at, source, warehouse_id FROM requirements WHERE event_id = ?', ev.id,
    ).map((r) => [r.item_id, r]),
  );
  const ids = new Set([...needs.map((n) => n.itemId), ...reqs.keys()]);
  const items = new Map(
    ids.size
      ? all<{ id: number; name: string; unit: string; kind: ItemKind }>(`SELECT id, name, unit, kind FROM items WHERE id IN (${[...ids].map(() => '?').join(',')})`, ...ids).map((i) => [i.id, i])
      : [],
  );
  const raw: RawNeedRecord[] = [...ids].map((itemId) => {
    const it = items.get(itemId)!;
    const n = needs.find((x) => x.itemId === itemId);
    const r = reqs.get(itemId);
    const allocation = r?.approved_at && r.warehouse_id ? allocationFor(itemId, r.warehouse_id) : null;
    const row = allocation?.rows.find((x) => x.eventId === ev.id);
    return {
      itemId,
      itemName: it.name,
      unit: it.unit,
      kind: it.kind,
      computed: n?.qty ?? 0,
      required: r?.qty ?? null,
      approvedAt: r?.approved_at ?? null,
      source: r?.source ?? null,
      warehouseId: r?.warehouse_id ?? null,
      allocation,
      eventShort: row?.short ?? 0,
    };
  }).sort((a, b) => a.itemName.localeCompare(b.itemName, 'he'));
  const dishNames = new Map(portions.map((p) => [p.dishId, p.dishName]));
  return { raw, missingRecipes: missingRecipes.map((id) => ({ dishId: id, dishName: dishNames.get(id) ?? String(id) })) };
}

/** Count of approved requirement items that are short for this event (after physical stock). */
export function shortItemsFor(eventId: number): number {
  const reqs = all<{ item_id: number; warehouse_id: number }>(
    'SELECT item_id, warehouse_id FROM requirements WHERE event_id = ? AND approved_at IS NOT NULL AND consumed = 0 AND warehouse_id IS NOT NULL',
    eventId,
  );
  let n = 0;
  for (const r of reqs) {
    const row = allocationFor(r.item_id, r.warehouse_id).rows.find((x) => x.eventId === eventId);
    if (row && row.short > 0) n++;
  }
  return n;
}

/** Items short for the event even after open purchase orders arrive. */
export function uncoveredItemsFor(eventId: number): { itemId: number; name: string; short: number }[] {
  const reqs = all<{ item_id: number; warehouse_id: number; name: string }>(
    `SELECT r.item_id, r.warehouse_id, i.name FROM requirements r JOIN items i ON i.id = r.item_id
      WHERE r.event_id = ? AND r.approved_at IS NOT NULL AND r.consumed = 0 AND r.warehouse_id IS NOT NULL`,
    eventId,
  );
  const out: { itemId: number; name: string; short: number }[] = [];
  for (const r of reqs) {
    const a = allocationFor(r.item_id, r.warehouse_id);
    const row = a.rows.find((x) => x.eventId === eventId);
    if (row && row.short > 0 && a.uncovered > 0) out.push({ itemId: r.item_id, name: r.name, short: Math.min(row.short, a.uncovered) });
  }
  return out;
}

export function pendingMenuAcks(eventId: number, menuVersion: number): number {
  return get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM menu_acks a JOIN menu_versions v ON v.id = a.menu_version_id
      WHERE v.event_id = ? AND v.version = ? AND a.acked_at IS NULL`,
    eventId, menuVersion,
  )!.n;
}

export function confirmationsFor(eventId: number): ConfirmationKind[] {
  return all<{ kind: ConfirmationKind }>('SELECT kind FROM confirmations WHERE event_id = ?', eventId).map((r) => r.kind);
}

export function readinessFor(ev: EventRecord): Readiness {
  const staffing = all<{ role: never; required: number; assigned: number }>('SELECT role, required, assigned FROM staffing WHERE event_id = ? AND required > 0', ev.id);
  const eq = get<{ n: number; unconf: number }>(
    'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN supplier_confirmed = 0 AND is_food = 0 THEN 1 ELSE 0 END), 0) AS unconf FROM event_equipment WHERE event_id = ?',
    ev.id,
  )!;
  const openDeliveries = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
      WHERE l.event_id = ? AND p.status IN ('ordered','partial') AND l.received < l.qty AND l.gap_resolved = 0`,
    ev.id,
  )!.n;
  const openReports = get<{ n: number }>('SELECT COUNT(*) AS n FROM field_reports WHERE event_id = ? AND resolved_at IS NULL', ev.id)!.n;
  const disabled = Object.entries(getSettings().readinessItems).filter(([, on]) => on === false).map(([k]) => k);
  let skipped: string[] = [];
  try { skipped = JSON.parse(ev.readinessSkip || '[]'); } catch { skipped = []; }
  return computeReadiness({
    venue: ev.venue,
    serviceKind: ev.serviceKind,
    salesStatus: ev.salesStatus,
    intakeStatus: ev.intakeStatus,
    menuStatus: ev.menuStatus,
    pendingMenuAcks: pendingMenuAcks(ev.id, ev.menuVersion),
    shortItems: shortItemsFor(ev.id),
    openDeliveries,
    staffing,
    equipmentLines: eq.n,
    rentalsUnconfirmed: VENUE_RULES[ev.venue].equipment === 'rental' ? eq.unconf : 0,
    siteDetailsComplete: Boolean(ev.address && ev.siteContactName && ev.siteContactPhone && (ev.startTime || ev.deliveryTime)),
    confirmations: confirmationsFor(ev.id),
    openReports,
    tasks: all<{ id: number; type: string; done_when: string | null; title: string; status: string; role: Role }>(
      "SELECT id, type, done_when, title, status, role FROM tasks WHERE event_id = ? AND required = 1 AND status != 'cancelled' ORDER BY due_at IS NULL, due_at", ev.id,
    ).map((t) => ({ id: t.id, covers: COVERS[t.done_when ?? ''] ?? COVERS[t.type] ?? null, title: t.title, done: t.status === 'done', blocked: t.status === 'blocked', role: t.role })),
  }, { disabled, skipped });
}

export function collectionFor(ev: EventRecord): CollectionSummary {
  const lines = all<{ kind: never; amount: number; due_date: string | null; received: number; received_at: string | null }>(
    'SELECT kind, amount, due_date, received, received_at FROM payments WHERE event_id = ?', ev.id,
  ).map((l) => ({ kind: l.kind, amount: l.amount, dueDate: l.due_date, received: l.received, receivedAt: l.received_at }));
  return summarizeCollection(ev.contractTotal, lines, today());
}

export function menuSnapshot(ev: EventRecord): MenuSnapshot {
  const lines = all<{ dish_id: number; name: string; audience: never; per_guest: number; qty_override: number | null; notes: string }>(
    'SELECT m.dish_id, d.name, m.audience, m.per_guest, m.qty_override, m.notes FROM menu_lines m JOIN dishes d ON d.id = m.dish_id WHERE m.event_id = ? ORDER BY m.sort, m.id',
    ev.id,
  );
  const dietary = all<{ kind: never; count: number; description: string }>('SELECT kind, count, description FROM dietary WHERE event_id = ? ORDER BY id', ev.id);
  return {
    guests: ev.guests,
    kids: ev.kids,
    kosher: ev.kosher,
    lines: lines.map((l) => ({ dishId: l.dish_id, dishName: l.name, audience: l.audience, perGuest: l.per_guest, qtyOverride: l.qty_override, notes: l.notes })),
    dietary: dietary.map((d) => ({ kind: d.kind, count: d.count, description: d.description })),
  };
}

export function userName(id: number | null | undefined): string | null {
  if (!id) return null;
  return get<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name ?? null;
}

/** Event start as ISO timestamp (start time, else delivery time, else noon). */
export function eventStartISO(ev: Pick<EventRecord, 'date' | 'startTime' | 'deliveryTime'>): string {
  const time = ev.startTime || ev.deliveryTime || '12:00';
  return new Date(`${ev.date}T${time}:00`).toISOString();
}

/**
 * A venue's day: booked events (signed / from the hall) count against its daily capacity;
 * open leads for the same day are shown but do not hold the date.
 */
export function availability(venue: string, date: string, excludeId?: number): { max: number | null; booked: number; full: boolean; events: { id: number; title: string; startTime: string; salesStatus: string; booked: boolean }[] } {
  const max = get<{ max_per_day: number | null }>('SELECT max_per_day FROM venues WHERE code = ?', venue)?.max_per_day ?? null;
  const events = all<{ id: number; title: string; start_time: string; sales_status: string }>(
    `SELECT id, title, start_time, sales_status FROM events WHERE venue = ? AND date = ? AND id != ? AND lifecycle != 'cancelled' AND sales_status != 'lost' ORDER BY start_time`,
    venue, date, excludeId ?? 0,
  ).map((e) => ({ id: e.id, title: e.title, startTime: e.start_time, salesStatus: e.sales_status, booked: e.sales_status === 'signed' || e.sales_status === 'hall' }));
  const booked = events.filter((e) => e.booked).length;
  return { max, booked, full: max !== null && booked >= max, events };
}

/** A venue's defaults for new events (read from the table, so it is always current). */
export function venueDefaults(venue: string): VenueDefaults {
  try { return JSON.parse(get<{ defaults: string }>('SELECT defaults FROM venues WHERE code = ?', venue)?.defaults ?? '{}'); } catch { return {}; }
}
