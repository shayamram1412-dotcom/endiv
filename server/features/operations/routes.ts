/**
 * Event operations: equipment & logistics, staffing standard vs. assigned vs. arrived (Ubeya stays external),
 * readiness confirmations, and two-way field reports between the event manager and the kitchen.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camelAll, forbidden, intParam, invalid, notFound, zId, zText, type AppEnv, type SessionUser } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { can, hasRole, venueScope } from '../../../shared/permissions.ts';
import { CONFIRMATIONS, REPORT_KIND, STAFF_ROLES, STAFF_ROLE_OWNER, VENUE_RULES, type ConfirmationKind, type StaffRole } from '../../../shared/domain.ts';
import { nowISO } from '../../../shared/dates.ts';
import { q } from '../../../shared/kitchen.ts';
import { suggestStaffing } from '../../../shared/staffing.ts';
import { getSettings } from '../../core/settings.ts';
import { seesClientContact } from '../../../shared/navigation.ts';
import type { ConfirmationRecord, EquipmentLine, FieldReport, StaffingLine, EventRecord } from '../../../shared/types.ts';
import { eventFor, loadEvent, menuLines, effectivePortions, readinessFor, userName } from '../events/service.ts';
import { ensureTask, reconcileEvent } from '../tasks/engine.ts';
import { conflictsBetween, maskConflicts } from './schedule.ts';
import { seesPrices } from '../../../shared/costing.ts';

export const operationsRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------- equipment

function equipment(eventId: number): EquipmentLine[] {
  return camelAll<EquipmentLine>(all(
    `SELECT q.*, s.name AS supplier_name, u.name AS gap_owner_name FROM event_equipment q
       LEFT JOIN suppliers s ON s.id = q.supplier_id LEFT JOIN users u ON u.id = q.gap_owner_id
      WHERE q.event_id = ? ORDER BY q.is_food, q.label`, eventId,
  ));
}

operationsRoutes.get('/:id/equipment', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'equipment', 1);
  // Owned items also wanted by another event on the same day, beyond what we own.
  const conflicts = conflictsBetween(ev.date, ev.date).equipment.filter((g) => g.events.some((e) => e.eventId === ev.id));
  const user = c.get('user');
  const showPrice = seesPrices(user) || can(user, 'equipment', 3, ev.venue);
  const lines = equipment(ev.id).map((l) => (showPrice ? l : { ...l, unitCost: 0 }));
  return c.json({ mode: VENUE_RULES[ev.venue].equipment, loadCheck: VENUE_RULES[ev.venue].loadCheck, lines, conflicts: maskConflicts(user, conflicts) });
});

/** Build the list from the venue/event-type template (and, for load checks, the food items). */
operationsRoutes.post('/:id/equipment/generate', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'equipment', 2);
  const rules = VENUE_RULES[ev.venue];
  if (rules.equipment === 'none') throw invalid('בנקודה זו אין דרישת ציוד מטעם הקייטרינג');
  const tpl = all<{ item_id: number; name: string; unit: string; per_guest: number; fixed_qty: number; supplier_id: number | null; kind: string; unit_cost: number }>(
    `SELECT t.item_id, i.name, i.unit, t.per_guest, t.fixed_qty, i.supplier_id, i.kind, i.unit_cost FROM equipment_templates t JOIN items i ON i.id = t.item_id
      WHERE t.venue = ? AND (t.event_type = '*' OR t.event_type = ?)`, ev.venue, ev.eventType,
  );
  let added = 0;
  tx(() => {
    const existing = new Set(all<{ item_id: number | null; label: string }>('SELECT item_id, label FROM event_equipment WHERE event_id = ?', ev.id).map((r) => r.item_id ?? r.label));
    for (const t of tpl) {
      if (existing.has(t.item_id)) continue;
      const planned = Math.ceil(q(t.fixed_qty + t.per_guest * ev.guests));
      insert('event_equipment', { event_id: ev.id, item_id: t.item_id, label: t.name, unit: t.unit, planned, supplier_id: t.kind === 'rental' ? t.supplier_id : null, unit_cost: t.kind === 'rental' ? t.unit_cost : 0 });
      added++;
    }
    if (rules.loadCheck) {
      // Food leaves the kitchen in boxes/trays per dish: count them on loading and unloading.
      for (const p of effectivePortions(ev, menuLines(ev))) {
        if (existing.has(`מזון: ${p.dishName}`)) continue;
        insert('event_equipment', { event_id: ev.id, item_id: null, label: `מזון: ${p.dishName}`, unit: 'מגשים', is_food: 1, planned: Math.max(1, Math.ceil(p.portions / Math.max(1, getSettings().foodTrayPortions))) });
        added++;
      }
    }
    audit({ entity: 'equipment', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'generated', summary: `נוספו ${added} פריטים מהתבנית` });
  });
  reconcileEvent(ev.id);
  return c.json({ added, lines: equipment(ev.id) });
});

const eqSchema = z.object({
  itemId: zId.nullable().default(null),
  label: zText(120).min(1, 'נדרש תיאור'),
  unit: zText(20).default('יח׳'),
  isFood: z.boolean().default(false),
  planned: z.number().min(0),
  supplierId: zId.nullable().default(null),
  unitCost: z.number().int().min(0).default(0),
  notes: zText(500).default(''),
});

operationsRoutes.post('/:id/equipment', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'equipment', 2);
  const b = await body(c, eqSchema);
  const id = insert('event_equipment', { event_id: ev.id, item_id: b.itemId, label: b.label, unit: b.unit, is_food: b.isFood, planned: b.planned, supplier_id: b.supplierId, unit_cost: b.unitCost, notes: b.notes });
  audit({ entity: 'equipment', entityId: id, eventId: ev.id, userId: user.id, action: 'created', summary: b.label });
  reconcileEvent(ev.id);
  return c.json({ id }, 201);
});

operationsRoutes.patch('/:id/equipment/:lineId', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'equipment', 2);
  const lineId = intParam(c, 'lineId');
  const b = await body(c, z.object({
    planned: z.number().min(0).optional(),
    supplierId: zId.nullable().optional(),
    supplierConfirmed: z.boolean().optional(),
    notes: zText(500).optional(),
    gapNote: zText(500).optional(),
    unitCost: z.number().int().min(0).optional(),
  }));
  const map: Record<string, string> = { planned: 'planned', supplierId: 'supplier_id', supplierConfirmed: 'supplier_confirmed', notes: 'notes', gapNote: 'gap_note', unitCost: 'unit_cost' };
  const keys = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (!keys.length) return c.json({ ok: true });
  const r = run(`UPDATE event_equipment SET ${keys.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ? AND event_id = ?`,
    ...keys.map((k) => (b as Record<string, unknown>)[k]), lineId, ev.id);
  if (!r.changes) throw notFound('השורה');
  audit({ entity: 'equipment', entityId: lineId, eventId: ev.id, userId: user.id, action: 'updated', diff: b as Record<string, unknown> });
  reconcileEvent(ev.id);
  return c.json({ ok: true });
});

operationsRoutes.delete('/:id/equipment/:lineId', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'equipment', 2);
  run('DELETE FROM event_equipment WHERE id = ? AND event_id = ?', intParam(c, 'lineId'), ev.id);
  reconcileEvent(ev.id);
  return c.json({ ok: true });
});

/**
 * Record counts at a logistics stage. Gaps (expected − counted) get an owner and open a field report to ops,
 * e.g. receiving 18 of 20 boxes after unloading at the farm.
 */
operationsRoutes.put('/:id/equipment/counts', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'equipment', 2);
  const b = await body(c, z.object({
    stage: z.enum(['loaded', 'unloaded', 'returned']),
    counts: z.array(z.object({ id: zId, qty: z.number().min(0) })).min(1),
    note: zText(1000).default(''),
  }));
  const rules = VENUE_RULES[ev.venue];
  if ((b.stage === 'loaded' || b.stage === 'unloaded') && !rules.loadCheck) throw invalid('ספירת העמסה ופריקה מוגדרת רק בנקודות שבהן היא פעילה (הגדרות הנקודה)');
  if (b.stage === 'returned' && rules.equipment !== 'rental') throw invalid('החזרת כלים שכורים רלוונטית ליקב בלבד');
  const lines = equipment(ev.id);
  const gaps: string[] = [];
  tx(() => {
    for (const cnt of b.counts) {
      const line = lines.find((l) => l.id === cnt.id);
      if (!line) throw invalid('שורה לא שייכת לאירוע');
      const expected = b.stage === 'loaded' ? line.planned : b.stage === 'unloaded' ? (line.loaded ?? line.planned) : line.planned;
      const gap = q(expected - cnt.qty);
      run(`UPDATE event_equipment SET ${b.stage} = ?, gap_owner_id = ? WHERE id = ?`, cnt.qty, gap > 0 ? user.id : line.gapOwnerId, line.id);
      if (gap > 0) gaps.push(`${line.label}: ${cnt.qty} מתוך ${expected} ${line.unit}`);
    }
    const kind: ConfirmationKind = b.stage === 'returned' ? 'rentals_returned' : b.stage;
    const allCounted = equipment(ev.id).filter((l) => b.stage !== 'returned' || !l.isFood).every((l) => l[b.stage] !== null);
    if (allCounted) {
      run('INSERT INTO confirmations (event_id, kind, user_id, note, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_id, kind) DO UPDATE SET user_id = excluded.user_id, note = excluded.note, at = excluded.at',
        ev.id, kind, user.id, [b.note, gaps.length ? `פערים: ${gaps.join('; ')}` : 'ללא פערים'].filter(Boolean).join(' · '), nowISO());
    }
    if (gaps.length) {
      const stageLabel = b.stage === 'loaded' ? 'בהעמסה' : b.stage === 'unloaded' ? 'בפריקה' : 'בהחזרה לספק';
      const rid = insert('field_reports', {
        event_id: ev.id, kind: 'shortage', target: b.stage === 'returned' ? 'event_manager' : 'ops',
        content: `פער ${stageLabel}: ${gaps.join('; ')}${b.note ? ` · ${b.note}` : ''}`, urgent: 0, reported_by: user.id, at: nowISO(),
      });
      ensureTask({ type: 'report_handle', key: `report_handle:${rid}`, role: b.stage === 'returned' ? 'event_manager' : 'ops', eventId: ev.id, refType: 'report', refId: rid, action: `לטפל בפער ${stageLabel}: ${gaps[0]}${gaps.length > 1 ? ` ועוד ${gaps.length - 1}` : ''}` }, user.id);
    }
    audit({ entity: 'equipment', entityId: ev.id, eventId: ev.id, userId: user.id, action: `count:${b.stage}`, summary: gaps.length ? `פערים: ${gaps.join('; ')}` : 'נספר ללא פערים' });
  });
  reconcileEvent(ev.id);
  return c.json({ gaps, lines: equipment(ev.id) });
});

// ---------------------------------------------------------------- staffing

operationsRoutes.get('/:id/staffing', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'staffing', 1);
  const lines = camelAll<StaffingLine>(all('SELECT * FROM staffing WHERE event_id = ? ORDER BY id', ev.id));
  return c.json({ lines, suggestion: suggestStaffing(ev.eventType, ev.serviceKind, ev.guests, getSettings().staffingRatios), ubeyaRef: ev.ubeyaRef });
});

const STAFF_KEYS = Object.keys(STAFF_ROLES) as [StaffRole, ...StaffRole[]];

operationsRoutes.put('/:id/staffing', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'staffing', 2);
  const b = await body(c, z.object({
    lines: z.array(z.object({
      role: z.enum(STAFF_KEYS),
      required: z.number().int().min(0).max(500),
      assigned: z.number().int().min(0).max(500),
      arrived: z.number().int().min(0).max(500).nullable(),
      notes: zText(500).default(''),
    })),
    ubeyaRef: zText(80).optional(),
  }));
  // Cooks belong to the kitchen manager, the rest to the event manager (spec §2).
  // Owner and operations may set any line; otherwise each line belongs to its responsible role.
  const isOwner = hasRole(user, 'owner') || hasRole(user, 'ops');
  for (const l of b.lines) {
    const owner = STAFF_ROLE_OWNER[l.role];
    if (!isOwner && !hasRole(user, owner === 'kitchen' ? 'kitchen' : 'event_manager', ev.venue)) {
      const prev = get<{ required: number; assigned: number; arrived: number | null }>('SELECT required, assigned, arrived FROM staffing WHERE event_id = ? AND role = ?', ev.id, l.role);
      if (!prev || prev.required !== l.required || prev.assigned !== l.assigned || prev.arrived !== l.arrived) {
        throw forbidden(`עדכון ${STAFF_ROLES[l.role]} באחריות ${owner === 'kitchen' ? 'מנהל המטבח' : 'מנהל האירוע'}`);
      }
    }
  }
  tx(() => {
    for (const l of b.lines) {
      run(`INSERT INTO staffing (event_id, role, required, assigned, arrived, notes) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id, role) DO UPDATE SET required = excluded.required, assigned = excluded.assigned, arrived = excluded.arrived, notes = excluded.notes`,
        ev.id, l.role, l.required, l.assigned, l.arrived, l.notes);
    }
    if (b.ubeyaRef !== undefined) run('UPDATE events SET ubeya_ref = ?, version = version + 1 WHERE id = ?', b.ubeyaRef, ev.id);
    audit({ entity: 'staffing', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'updated',
      summary: b.lines.map((l) => `${STAFF_ROLES[l.role]} ${l.assigned}/${l.required}${l.arrived !== null ? ` (הגיעו ${l.arrived})` : ''}`).join(' · ') });
  });
  reconcileEvent(ev.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- confirmations

operationsRoutes.get('/:id/confirmations', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'events', 1);
  return c.json(camelAll<ConfirmationRecord>(all('SELECT c.kind, c.note, c.at, u.name AS user_name FROM confirmations c JOIN users u ON u.id = c.user_id WHERE c.event_id = ?', ev.id)));
});

const CONF_ROLE: Record<ConfirmationKind, 'kitchen' | 'event_manager' | 'ops'> = {
  kitchen_ready: 'kitchen', field_ready: 'event_manager', loaded: 'ops', unloaded: 'ops', executed: 'event_manager', rentals_returned: 'event_manager',
};

function canConfirm(user: SessionUser, ev: EventRecord, kind: ConfirmationKind): boolean {
  // The responsible role confirms; owner and operations may confirm on their behalf.
  return hasRole(user, CONF_ROLE[kind], ev.venue) || hasRole(user, 'owner') || hasRole(user, 'ops');
}

operationsRoutes.post('/:id/confirm', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'events', 1);
  const b = await body(c, z.object({ kind: z.enum(Object.keys(CONFIRMATIONS) as [ConfirmationKind, ...ConfirmationKind[]]), note: zText(1000).default('') }));
  if (!canConfirm(user, ev, b.kind)) throw forbidden('אישור זה שמור לבעל התפקיד האחראי');
  if (b.kind === 'kitchen_ready' || b.kind === 'field_ready') {
    const r = readinessFor(ev);
    const blockers = r.items.filter((i) => !i.done && i.key !== 'kitchen_ready' && i.key !== 'field_ready' && i.key !== 'loaded');
    if (blockers.length && !b.note) {
      throw invalid(`יש פריטים שאינם מוכנים: ${blockers.map((x) => x.label).join(', ')}. כדי לאשר בכל זאת, פרט בהערה.`, { fields: { note: 'נדרש הסבר' }, blockers });
    }
  }
  run('INSERT INTO confirmations (event_id, kind, user_id, note, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_id, kind) DO UPDATE SET user_id = excluded.user_id, note = excluded.note, at = excluded.at',
    ev.id, b.kind, user.id, b.note, nowISO());
  audit({ entity: 'confirmation', entityId: ev.id, eventId: ev.id, userId: user.id, action: `confirm:${b.kind}`, summary: CONFIRMATIONS[b.kind] + (b.note ? ` – ${b.note}` : '') });
  reconcileEvent(ev.id);
  return c.json({ ok: true });
});

operationsRoutes.delete('/:id/confirm/:kind', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'events', 1);
  const kind = c.req.param('kind') as ConfirmationKind;
  if (!(kind in CONFIRMATIONS) || !canConfirm(user, ev, kind)) throw forbidden();
  run('DELETE FROM confirmations WHERE event_id = ? AND kind = ?', ev.id, kind);
  audit({ entity: 'confirmation', entityId: ev.id, eventId: ev.id, userId: user.id, action: `unconfirm:${kind}`, summary: `בוטל: ${CONFIRMATIONS[kind]}` });
  reconcileEvent(ev.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- field reports (two-way)

const REPORT_SQL = `SELECT r.*, e.title AS event_title, u1.name AS reported_by_name, u2.name AS acked_by_name, u3.name AS resolved_by_name
  FROM field_reports r JOIN events e ON e.id = r.event_id JOIN users u1 ON u1.id = r.reported_by
  LEFT JOIN users u2 ON u2.id = r.acked_by LEFT JOIN users u3 ON u3.id = r.resolved_by`;

operationsRoutes.get('/:id/reports', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'field', 1);
  return c.json(camelAll<FieldReport>(all(`${REPORT_SQL} WHERE r.event_id = ? ORDER BY r.resolved_at IS NOT NULL, r.at DESC`, ev.id)));
});

operationsRoutes.post('/:id/reports', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'field', 2);
  const b = await body(c, z.object({
    kind: z.enum(Object.keys(REPORT_KIND) as [keyof typeof REPORT_KIND, ...(keyof typeof REPORT_KIND)[]]),
    target: z.enum(['kitchen', 'event_manager', 'ops']),
    content: zText(2000).min(2, 'נדרש תיאור'),
    urgent: z.boolean().default(false),
  }));
  const id = tx(() => {
    const id = insert('field_reports', { event_id: ev.id, kind: b.kind, target: b.target, content: b.content, urgent: b.urgent, reported_by: user.id, at: nowISO() });
    ensureTask({
      type: 'report_handle', key: `report_handle:${id}`, role: b.target, eventId: ev.id, refType: 'report', refId: id,
      title: `${REPORT_KIND[b.kind]} מהשטח${b.urgent ? ' – דחוף' : ''}`, action: b.content,
    }, user.id);
    audit({ entity: 'report', entityId: id, eventId: ev.id, userId: user.id, action: 'created', summary: `${REPORT_KIND[b.kind]}: ${b.content.slice(0, 80)}` });
    return id;
  });
  reconcileEvent(ev.id);
  publish({ topic: 'event', id: ev.id, eventId: ev.id });
  return c.json({ id }, 201);
});

export const reportsRoutes = new Hono<AppEnv>();

/** Open reports addressed to the user's roles (kitchen board, event manager phone, ops). */
reportsRoutes.get('/', (c) => {
  const user = c.get('user');
  const scope = venueScope(user);
  const targets = ['kitchen', 'event_manager', 'ops'].filter((t) => hasRole(user, t as never) || hasRole(user, 'owner') || (t === 'ops' && hasRole(user, 'ops')));
  if (!targets.length) return c.json([]);
  const venueSql = scope === null ? '1 = 1' : scope.length ? `e.venue IN (${scope.map(() => '?').join(',')})` : '0 = 1';
  const rows = all(`${REPORT_SQL} WHERE r.resolved_at IS NULL AND r.target IN (${targets.map(() => '?').join(',')}) AND ${venueSql} ORDER BY r.urgent DESC, r.at`,
    ...targets, ...(scope ?? []));
  return c.json(camelAll<FieldReport>(rows));
});

function loadReport(user: SessionUser, id: number) {
  const r = get<{ event_id: number; target: string; acked_at: string | null; resolved_at: string | null }>('SELECT event_id, target, acked_at, resolved_at FROM field_reports WHERE id = ?', id);
  if (!r) throw notFound('הדיווח');
  const ev = loadEvent(r.event_id);
  if (!can(user, 'field', 1, ev.venue) && !can(user, 'kitchen', 1, ev.venue)) throw notFound('הדיווח');
  return { r, ev };
}

reportsRoutes.post('/:id/ack', (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const { r, ev } = loadReport(user, id);
  if (r.acked_at) return c.json({ ok: true, already: true, by: userName(get<{ acked_by: number }>('SELECT acked_by FROM field_reports WHERE id = ?', id)?.acked_by) });
  run('UPDATE field_reports SET acked_by = ?, acked_at = ? WHERE id = ? AND acked_at IS NULL', user.id, nowISO(), id);
  run("UPDATE tasks SET status = 'in_progress', assignee_id = COALESCE(assignee_id, ?), claimed_at = COALESCE(claimed_at, ?) WHERE ref_type = 'report' AND ref_id = ? AND status = 'open'", user.id, nowISO(), id);
  audit({ entity: 'report', entityId: id, eventId: ev.id, userId: user.id, action: 'acked', summary: 'אישור קבלת דיווח' });
  publish({ topic: 'event', id: ev.id, eventId: ev.id }, { topic: 'task' });
  return c.json({ ok: true });
});

reportsRoutes.post('/:id/resolve', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const { r, ev } = loadReport(user, id);
  if (r.resolved_at) throw invalid('הדיווח כבר טופל');
  const b = await body(c, z.object({ decision: zText(1000).min(2, 'נדרש לתעד מה הוחלט') }));
  run('UPDATE field_reports SET decision = ?, resolved_by = ?, resolved_at = ?, acked_by = COALESCE(acked_by, ?), acked_at = COALESCE(acked_at, ?) WHERE id = ?',
    b.decision, user.id, nowISO(), user.id, nowISO(), id);
  audit({ entity: 'report', entityId: id, eventId: ev.id, userId: user.id, action: 'resolved', summary: b.decision });
  reconcileEvent(ev.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- field bundle (mobile first screen)

operationsRoutes.get('/:id/field', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'field', 1);
  // On-site contact is operational and stays; the client's own phone only for roles that work with the client.
  const contact = seesClientContact(user.grants);
  const client = ev.clientId && contact ? get<{ name: string; phone: string }>('SELECT name, phone FROM clients WHERE id = ?', ev.clientId) : null;
  const contacts = ev.clientId && contact ? all<{ name: string; phone: string; role: string }>('SELECT name, phone, role FROM contacts WHERE client_id = ? AND phone != \'\'', ev.clientId) : [];
  const approved = ev.menuStatus === 'approved' || ev.menuStatus === 'changed';
  const lines = menuLines(ev);
  const reports = camelAll<FieldReport>(all(`${REPORT_SQL} WHERE r.event_id = ? ORDER BY r.resolved_at IS NOT NULL, r.urgent DESC, r.at DESC`, ev.id));
  const tasks = camelAll(all(
    `SELECT t.id, t.title, t.action, t.role, t.due_at, t.status, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.event_id = ? AND t.status IN ('open','in_progress','blocked') ORDER BY t.due_at`, ev.id,
  ));
  return c.json({
    event: { id: ev.id, title: ev.title, venue: ev.venue, date: ev.date, startTime: ev.startTime, endTime: ev.endTime, deliveryTime: ev.deliveryTime, guests: ev.guests, kids: ev.kids, vegetarian: ev.vegetarian, vegan: ev.vegan, address: ev.address, siteContactName: ev.siteContactName, siteContactPhone: ev.siteContactPhone, specialRequests: ev.specialRequests, kosher: ev.kosher, menuStatus: ev.menuStatus, menuVersion: ev.menuVersion, serviceKind: ev.serviceKind, lifecycle: ev.lifecycle },
    client,
    contacts,
    menuApproved: approved,
    menu: lines.map((l) => ({ dishName: l.dishName, category: l.category, portions: l.portions, notes: l.notes, allergens: l.allergens, audience: l.audience })),
    dietary: all('SELECT kind, count, description FROM dietary WHERE event_id = ?', ev.id),
    staffing: camelAll<StaffingLine>(all('SELECT * FROM staffing WHERE event_id = ? ORDER BY id', ev.id)),
    reports,
    tasks,
    readiness: readinessFor(ev),
    confirmations: camelAll<ConfirmationRecord>(all('SELECT c.kind, c.note, c.at, u.name AS user_name FROM confirmations c JOIN users u ON u.id = c.user_id WHERE c.event_id = ?', ev.id)),
    equipmentMode: VENUE_RULES[ev.venue].equipment,
    loadCheck: VENUE_RULES[ev.venue].loadCheck,
  });
});
