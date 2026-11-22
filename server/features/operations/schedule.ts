/**
 * Run of show per event, transport (vehicles), the printable event sheet,
 * staffing across events by day, and owned equipment / vehicle conflicts between overlapping events.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camelAll, intParam, invalid, notFound, requireAny, requireGlobal, zDate, zId, zText, zTime, type AppEnv, type SessionUser } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { getSettings } from '../../core/settings.ts';
import { visibleEventIds } from '../../core/scope.ts';
import { ROLES, can } from '../../../shared/permissions.ts';
import { STAFF_ROLES, VENUE_LABEL, type StaffRole } from '../../../shared/domain.ts';
import { addDays, today } from '../../../shared/dates.ts';
import { equipmentConflicts, shiftTime, vehicleConflicts } from '../../../shared/schedule.ts';
import { seesClientContact } from '../../../shared/navigation.ts';
import type { EventRecord } from '../../../shared/types.ts';
import { eventFor, menuLines, venueFilter } from '../events/service.ts';

export const scheduleRoutes = new Hono<AppEnv>();
export const opsRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------- run of show

export interface ShowRow { id?: number; time: string; title: string; role: string; notes: string }

function defaultShow(ev: EventRecord): ShowRow[] {
  const start = ev.startTime || ev.deliveryTime;
  return getSettings().runOfShow.map((r) => ({ time: shiftTime(start, r.offsetMin), title: r.title, role: r.role, notes: '' }));
}

function showFor(ev: EventRecord): { rows: ShowRow[]; isDefault: boolean } {
  const rows = camelAll<ShowRow>(all('SELECT id, time, title, role, notes FROM run_of_show WHERE event_id = ? ORDER BY time, sort, id', ev.id));
  return rows.length ? { rows, isDefault: false } : { rows: defaultShow(ev), isDefault: true };
}

scheduleRoutes.get('/:id/run-of-show', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'events', 1);
  return c.json({ ...showFor(ev), canEdit: can(c.get('user'), 'events', 2, ev.venue) });
});

const showSchema = z.object({
  rows: z.array(z.object({
    time: zTime.refine((v) => v !== '', 'נדרשת שעה'),
    title: zText(160).min(2, 'נדרש תיאור'),
    role: z.string().refine((v) => v === '' || v in ROLES, 'תפקיד לא מוכר').default(''),
    notes: zText(500).default(''),
  })).max(80),
});

scheduleRoutes.put('/:id/run-of-show', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'events', 2);
  const b = await body(c, showSchema);
  tx(() => {
    run('DELETE FROM run_of_show WHERE event_id = ?', ev.id);
    b.rows.forEach((r, i) => insert('run_of_show', { event_id: ev.id, time: r.time, title: r.title, role: r.role, notes: r.notes, sort: i }));
    audit({ entity: 'event', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'run_of_show', summary: `לו״ז האירוע עודכן (${b.rows.length} שורות)` });
  });
  publish({ topic: 'event', eventId: ev.id });
  return c.json(showFor(ev));
});

/** Back to the default from settings (shifted to this event's start time). */
scheduleRoutes.delete('/:id/run-of-show', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'events', 2);
  run('DELETE FROM run_of_show WHERE event_id = ?', ev.id);
  audit({ entity: 'event', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'run_of_show', summary: 'לו״ז האירוע הוחזר לברירת המחדל' });
  publish({ topic: 'event', eventId: ev.id });
  return c.json(showFor(ev));
});

// ---------------------------------------------------------------- transport

const TRANSPORT_SQL = `SELECT t.*, v.name AS vehicle_name, v.plate FROM event_transport t JOIN vehicles v ON v.id = t.vehicle_id`;

function vehicleClashesFor(ev: EventRecord) {
  const rows = all<{ date: string; vehicle_id: number; vehicle_name: string; event_id: number; title: string; depart_time: string; return_time: string }>(
    `SELECT e.date, t.vehicle_id, v.name AS vehicle_name, t.event_id, e.title, t.depart_time, t.return_time FROM event_transport t
       JOIN vehicles v ON v.id = t.vehicle_id JOIN events e ON e.id = t.event_id
      WHERE e.date = ? AND e.lifecycle != 'cancelled'`, ev.date,
  ).map((r) => ({ date: r.date, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, eventId: r.event_id, title: r.title, depart: r.depart_time, back: r.return_time }));
  return vehicleConflicts(rows).filter((g) => g.events.some((e) => e.eventId === ev.id));
}

scheduleRoutes.get('/:id/transport', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'equipment', 1);
  return c.json({
    lines: camelAll(all(`${TRANSPORT_SQL} WHERE t.event_id = ? ORDER BY t.depart_time`, ev.id)),
    vehicles: camelAll(all('SELECT * FROM vehicles WHERE active = 1 ORDER BY name')),
    conflicts: maskConflicts(c.get('user'), vehicleClashesFor(ev)),
  });
});

scheduleRoutes.put('/:id/transport', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'equipment', 2);
  const b = await body(c, z.object({
    lines: z.array(z.object({ vehicleId: zId, driver: zText(80).default(''), departTime: zTime.default(''), returnTime: zTime.default(''), notes: zText(300).default('') })).max(20),
  }));
  for (const l of b.lines) if (!get('SELECT 1 FROM vehicles WHERE id = ? AND active = 1', l.vehicleId)) throw invalid('רכב לא קיים או לא פעיל');
  tx(() => {
    run('DELETE FROM event_transport WHERE event_id = ?', ev.id);
    for (const l of b.lines) insert('event_transport', { event_id: ev.id, vehicle_id: l.vehicleId, driver: l.driver, depart_time: l.departTime, return_time: l.returnTime, notes: l.notes });
    audit({ entity: 'event', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'transport', summary: `הובלה: ${b.lines.length} רכבים` });
  });
  publish({ topic: 'event', eventId: ev.id }, { topic: 'calendar' });
  return c.json({ ok: true, conflicts: maskConflicts(user, vehicleClashesFor(ev)) });
});

// ---------------------------------------------------------------- printable event sheet

scheduleRoutes.get('/:id/sheet', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'events', 1);
  const client = ev.clientId ? get<{ name: string; phone: string }>('SELECT name, phone FROM clients WHERE id = ?', ev.clientId) : null;
  const people = (id: number | null) => (id ? get<{ name: string; phone: string }>('SELECT name, phone FROM users WHERE id = ?', id) ?? null : null);
  return c.json({
    event: ev,
    venueName: VENUE_LABEL[ev.venue],
    client: client ? { name: client.name, phone: seesClientContact(user.grants) ? client.phone : '' } : null,
    eventManager: people(ev.eventManagerId),
    kitchenManager: people(ev.kitchenManagerId),
    menu: can(user, 'menu', 1, ev.venue) || can(user, 'field', 1, ev.venue)
      ? menuLines(ev).map((l) => ({ dishName: l.dishName, category: l.category, portions: l.portions, notes: l.notes, allergens: l.allergens, audience: l.audience }))
      : [],
    dietary: all('SELECT kind, count, description FROM dietary WHERE event_id = ?', ev.id),
    staffing: all<{ role: StaffRole; required: number; assigned: number }>('SELECT role, required, assigned FROM staffing WHERE event_id = ? AND required > 0', ev.id),
    show: showFor(ev).rows,
    equipment: can(user, 'equipment', 1, ev.venue) ? camelAll(all('SELECT label, unit, planned, notes FROM event_equipment WHERE event_id = ? ORDER BY is_food, label', ev.id)) : [],
    transport: camelAll(all(`${TRANSPORT_SQL} WHERE t.event_id = ? ORDER BY t.depart_time`, ev.id)),
  });
});

// ---------------------------------------------------------------- vehicles

opsRoutes.get('/vehicles', (c) => {
  requireAny(c, 'equipment', 1);
  return c.json(camelAll(all('SELECT * FROM vehicles ORDER BY active DESC, name')));
});

const vehicleSchema = z.object({ name: zText(80).min(2, 'נדרש שם'), plate: zText(20).default(''), notes: zText(300).default(''), active: z.boolean().default(true) });

opsRoutes.post('/vehicles', async (c) => {
  const user = requireGlobal(c, 'equipment', 3);
  const b = await body(c, vehicleSchema);
  const id = insert('vehicles', { name: b.name, plate: b.plate, notes: b.notes, active: b.active });
  audit({ entity: 'vehicle', entityId: id, userId: user.id, action: 'created', summary: b.name });
  publish({ topic: 'settings' });
  return c.json({ id }, 201);
});

opsRoutes.put('/vehicles/:id', async (c) => {
  const user = requireGlobal(c, 'equipment', 3);
  const id = intParam(c);
  const b = await body(c, vehicleSchema);
  const r = run('UPDATE vehicles SET name = ?, plate = ?, notes = ?, active = ? WHERE id = ?', b.name, b.plate, b.notes, b.active, id);
  if (!r.changes) throw notFound('הרכב');
  audit({ entity: 'vehicle', entityId: id, userId: user.id, action: 'updated', summary: b.name });
  publish({ topic: 'settings' });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- staffing by day

/** Every committed event in the range with its staffing, grouped by day, with totals per staff group. */
opsRoutes.get('/staffing', (c) => {
  const user = requireAny(c, 'staffing', 1);
  const from = c.req.query('from') ?? today();
  const to = c.req.query('to') ?? addDays(from, 13);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw invalid('טווח תאריכים לא תקין');
  const vf = venueFilter(user);
  const events = all<{ id: number; title: string; date: string; venue: string; start_time: string; guests: number; service_kind: string; ubeya_ref: string }>(
    `SELECT e.id, e.title, e.date, e.venue, e.start_time, e.guests, e.service_kind, e.ubeya_ref FROM events e
      WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle = 'planning' AND e.sales_status IN ('signed','hall') AND e.service_kind = 'full'
      ORDER BY e.date, e.start_time`, ...vf.params, from, to,
  );
  const lines = events.length
    ? all<{ event_id: number; role: StaffRole; required: number; assigned: number }>(`SELECT event_id, role, required, assigned FROM staffing WHERE event_id IN (${events.map(() => '?').join(',')})`, ...events.map((e) => e.id))
    : [];
  const roles = Object.keys(STAFF_ROLES) as StaffRole[];
  const days = new Map<string, { date: string; events: unknown[]; totals: Record<string, { required: number; assigned: number }> }>();
  for (const e of events) {
    const day = days.get(e.date) ?? { date: e.date, events: [], totals: Object.fromEntries(roles.map((r) => [r, { required: 0, assigned: 0 }])) };
    const mine = lines.filter((l) => l.event_id === e.id);
    for (const l of mine) { day.totals[l.role].required += l.required; day.totals[l.role].assigned += l.assigned; }
    day.events.push({
      id: e.id, title: e.title, venue: e.venue, startTime: e.start_time, guests: e.guests, ubeyaRef: e.ubeya_ref,
      lines: Object.fromEntries(mine.map((l) => [l.role, { required: l.required, assigned: l.assigned }])),
      missing: mine.reduce((a, l) => a + Math.max(0, l.required - l.assigned), 0),
      planned: mine.some((l) => l.required > 0),
    });
    days.set(e.date, day);
  }
  return c.json({ from, to, roles, days: [...days.values()] });
});

// ---------------------------------------------------------------- conflicts between events

export function conflictsBetween(from: string, to: string, venueSql = '1 = 1', venueParams: string[] = []) {
  const eq = equipmentConflicts(all<{ date: string; item_id: number; name: string; owned_qty: number; event_id: number; title: string; planned: number }>(
    `SELECT e.date, q.item_id, i.name, i.owned_qty, q.event_id, e.title, q.planned FROM event_equipment q
       JOIN items i ON i.id = q.item_id JOIN events e ON e.id = q.event_id
      WHERE i.kind = 'equipment' AND e.date BETWEEN ? AND ? AND e.lifecycle = 'planning' AND e.sales_status IN ('signed','hall') AND q.planned > 0`, from, to,
  ).map((r) => ({ date: r.date, itemId: r.item_id, itemName: r.name, owned: r.owned_qty, eventId: r.event_id, title: r.title, qty: r.planned })));
  const vh = vehicleConflicts(all<{ date: string; vehicle_id: number; vehicle_name: string; event_id: number; title: string; depart_time: string; return_time: string }>(
    `SELECT e.date, t.vehicle_id, v.name AS vehicle_name, t.event_id, e.title, t.depart_time, t.return_time FROM event_transport t
       JOIN vehicles v ON v.id = t.vehicle_id JOIN events e ON e.id = t.event_id
      WHERE e.date BETWEEN ? AND ? AND e.lifecycle = 'planning' AND ${venueSql}`, from, to, ...venueParams,
  ).map((r) => ({ date: r.date, vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, eventId: r.event_id, title: r.title, depart: r.depart_time, back: r.return_time })));
  return { equipment: eq, vehicles: vh };
}

/**
 * Shared equipment and vehicles span venues, so a clash can involve another venue's event: the user sees
 * that it is taken and by how much, not whose event it is.
 */
export function maskConflicts<T extends { events: { eventId: number; title: string }[] }>(user: SessionUser, groups: T[]): T[] {
  const seen = visibleEventIds(user, groups.flatMap((g) => g.events.map((e) => e.eventId)));
  return groups
    .filter((g) => g.events.some((e) => seen.has(e.eventId)))
    .map((g) => ({ ...g, events: g.events.map((e) => (seen.has(e.eventId) ? e : { ...e, eventId: 0, title: 'אירוע בנקודה אחרת' })) }));
}

opsRoutes.get('/conflicts', (c) => {
  const user = requireAny(c, 'equipment', 1);
  const from = c.req.query('from') ?? today();
  const to = c.req.query('to') ?? addDays(from, 30);
  const all = conflictsBetween(from, to);
  return c.json({ from, to, equipment: maskConflicts(user, all.equipment), vehicles: maskConflicts(user, all.vehicles) });
});

/** Venue daily capacity for a month: used by the calendar and the event form. */
opsRoutes.get('/capacity', (c) => {
  const user = requireAny(c, 'events', 1);
  const from = c.req.query('from') ?? today();
  const to = c.req.query('to') ?? addDays(from, 41);
  const vf = venueFilter(user);
  const rows = all<{ date: string; venue: string; n: number }>(
    `SELECT e.date, e.venue, COUNT(*) AS n FROM events e WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle != 'cancelled' AND e.sales_status IN ('signed','hall') GROUP BY e.date, e.venue`,
    ...vf.params, from, to,
  );
  return c.json(rows);
});
