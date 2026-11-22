import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camel, camelAll, forbidden, intParam, invalid, notFound, requireAny, zId, zPhone, zText, type AppEnv, type SessionUser } from '../../core/http.ts';
import { patchRow } from '../../core/patch.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { can, venueScope } from '../../../shared/permissions.ts';
import { ACTIVITY_KIND } from '../../../shared/domain.ts';
import { nowISO } from '../../../shared/dates.ts';
import type { ActivityRecord, ClientRecord, ContactRecord, MeetingRecord } from '../../../shared/types.ts';
import { createClient, phoneDigits } from './service.ts';
import { EVENT_LIST_SQL, listItem } from '../events/routes.ts';
import { venueFilter } from '../events/service.ts';
import { ensureTask, reconcileClient, reconcileEvent } from '../tasks/engine.ts';
import { clientVisible } from '../../core/scope.ts';
import { eventFor } from '../events/service.ts';

export const clientsRoutes = new Hono<AppEnv>();

// clientVisible: server/core/scope.ts — one definition for every screen.

function loadClient(user: SessionUser, id: number): ClientRecord {
  requireClients(user);
  const row = get('SELECT * FROM clients WHERE id = ?', id);
  if (!row || !clientVisible(user, id)) throw notFound('הלקוח');
  return camel<ClientRecord>(row);
}
function requireClients(user: SessionUser, level: 1 | 2 = 1) {
  if (!can(user, 'clients', level)) throw forbidden('אין לך הרשאה לכרטיסי לקוח');
}

clientsRoutes.get('/', (c) => {
  const user = requireAny(c, 'clients', 1);
  const q = c.req.query();
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (q.q) {
    const digits = q.q.replace(/\D/g, '');
    where.push(`(c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ?${digits.length >= 3 ? ' OR c.phone_digits LIKE ?' : ''})`);
    params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, ...(digits.length >= 3 ? [`%${digits}%`] : []));
  }
  if (q.kind) { where.push('c.kind = ?'); params.push(q.kind); }
  const vf = venueFilter(user, 'e2.venue');
  const rows = all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM events e WHERE e.client_id = c.id AND e.lifecycle != 'cancelled') AS event_count,
            (SELECT MIN(e.date) FROM events e WHERE e.client_id = c.id AND e.date >= date('now') AND e.lifecycle = 'planning') AS next_event,
            (SELECT MAX(a.at) FROM activities a WHERE a.client_id = c.id) AS last_activity,
            (SELECT MIN(a.next_action_at) FROM activities a WHERE a.client_id = c.id AND a.next_action_at IS NOT NULL AND a.next_action_done = 0) AS next_call,
            (SELECT GROUP_CONCAT(DISTINCT e.venue) FROM events e WHERE e.client_id = c.id) AS venues
       FROM clients c
      WHERE ${where.join(' AND ')}
        AND (NOT EXISTS (SELECT 1 FROM events e2 WHERE e2.client_id = c.id) OR EXISTS (SELECT 1 FROM events e2 WHERE e2.client_id = c.id AND ${vf.sql}))
      ORDER BY COALESCE(last_activity, c.updated_at) DESC LIMIT 300`,
    ...params, ...vf.params,
  );
  return c.json(camelAll(rows));
});

clientsRoutes.get('/lookup', (c) => {
  requireAny(c, 'clients', 1);
  const digits = phoneDigits(c.req.query('phone') ?? '');
  if (digits.length < 9) return c.json(null);
  const row = get<{ id: number }>('SELECT id, name, phone, kind FROM clients WHERE phone_digits = ?', digits);
  if (!row) return c.json(null);
  // A client of another venue: say the number exists (so no duplicate card is opened) without revealing who it is.
  return c.json(clientVisible(c.get('user'), row.id) ? camel(row) : { id: row.id, hidden: true });
});

const clientSchema = z.object({
  name: zText(120).min(2, 'נדרש שם'),
  phone: zPhone.min(9, 'נדרש מספר טלפון תקין'),
  email: z.union([z.literal(''), z.email('מייל לא תקין')]).default(''),
  kind: z.enum(['private', 'company', 'producer']).default('private'),
  company: zText(120).default(''),
  source: zText(80).default(''),
  notes: zText(4000).default(''),
  allowDuplicate: z.boolean().default(false),
});

clientsRoutes.post('/', async (c) => {
  const user = requireAny(c, 'clients', 2);
  const b = await body(c, clientSchema);
  const id = tx(() => {
    const id = createClient(b, user.id, b.allowDuplicate, (id) => clientVisible(user, id));
    audit({ entity: 'client', entityId: id, clientId: id, userId: user.id, action: 'created', summary: 'נפתח כרטיס לקוח' });
    return id;
  });
  publish({ topic: 'client', id, clientId: id });
  return c.json({ id }, 201);
});

clientsRoutes.get('/:id', (c) => {
  const user = c.get('user');
  const client = loadClient(user, intParam(c));
  const vf = venueFilter(user);
  const events = all(`${EVENT_LIST_SQL} WHERE e.client_id = ? AND ${vf.sql} ORDER BY e.date DESC`, client.id, ...vf.params).map((r) => listItem(user, r));
  // Menu summary per event, so two events of the same client keep their own menus.
  const menus = Object.fromEntries(events.map((e) => [e.id, all<{ name: string }>(
    'SELECT d.name FROM menu_lines m JOIN dishes d ON d.id = m.dish_id WHERE m.event_id = ? ORDER BY m.sort, m.id', e.id,
  ).map((r) => r.name)]));
  const contacts = camelAll<ContactRecord>(all('SELECT * FROM contacts WHERE client_id = ? ORDER BY is_end_client DESC, id', client.id));
  const activities = camelAll<ActivityRecord>(all(
    `SELECT a.*, u.name AS user_name, e.title AS event_title FROM activities a
       JOIN users u ON u.id = a.user_id LEFT JOIN events e ON e.id = a.event_id
      WHERE a.client_id = ? ORDER BY a.at DESC LIMIT 200`, client.id));
  const meetings = camelAll<MeetingRecord>(all(
    `SELECT m.*, e.title AS event_title, u.name AS manager_name FROM meetings m
       LEFT JOIN events e ON e.id = m.event_id LEFT JOIN users u ON u.id = m.manager_id
      WHERE m.client_id = ? OR m.event_id IN (SELECT id FROM events WHERE client_id = ?) ORDER BY m.date DESC`, client.id, client.id));
  return c.json({ client, contacts, events, menus, activities, meetings, canEdit: can(user, 'clients', 2), canSell: can(user, 'sales', 2) });
});

clientsRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  requireClients(user, 2);
  const id = intParam(c);
  loadClient(user, id);
  const b = await body(c, z.object({ changes: z.record(z.string(), z.unknown()), base: z.record(z.string(), z.unknown()).optional() }));
  const partial = clientSchema.omit({ allowDuplicate: true }).partial().safeParse(b.changes);
  if (!partial.success) throw invalid('יש שדות שדורשים תיקון', { fields: Object.fromEntries(partial.error.issues.map((i) => [i.path.join('.'), i.message])) });
  const changes: Record<string, unknown> = { ...partial.data };
  if (typeof changes.phone === 'string') {
    const digits = phoneDigits(changes.phone);
    const dup = get<{ id: number; name: string }>('SELECT id, name FROM clients WHERE phone_digits = ? AND id != ?', digits, id);
    if (dup) throw invalid(`הטלפון שייך ללקוח אחר: ${dup.name}`, { fields: { phone: `שייך ל${dup.name}` } });
    changes.phoneDigits = digits;
  }
  const r = tx(() => {
    const r = patchRow<ClientRecord>('clients', id, { changes, base: b.base }, ['name', 'phone', 'phoneDigits', 'email', 'kind', 'company', 'source', 'notes']);
    if (Object.keys(r.changed).length) audit({ entity: 'client', entityId: id, clientId: id, userId: user.id, action: 'updated', diff: r.changed });
    return r;
  });
  publish({ topic: 'client', id, clientId: id });
  return c.json(r.after);
});

// ---------------------------------------------------------------- contacts

const contactSchema = z.object({
  name: zText(120).min(2, 'נדרש שם'),
  role: zText(80).default(''),
  phone: zPhone.default(''),
  email: z.union([z.literal(''), z.email('מייל לא תקין')]).default(''),
  isEndClient: z.boolean().default(false),
});

clientsRoutes.post('/:id/contacts', async (c) => {
  const user = c.get('user');
  requireClients(user, 2);
  const clientId = intParam(c);
  loadClient(user, clientId);
  const b = await body(c, contactSchema);
  const id = insert('contacts', { client_id: clientId, name: b.name, role: b.role, phone: b.phone, email: b.email, is_end_client: b.isEndClient });
  audit({ entity: 'contact', entityId: id, clientId, userId: user.id, action: 'created', summary: `איש קשר: ${b.name}` });
  publish({ topic: 'client', id: clientId, clientId });
  return c.json({ id }, 201);
});

clientsRoutes.delete('/:id/contacts/:contactId', (c) => {
  const user = c.get('user');
  requireClients(user, 2);
  const clientId = intParam(c);
  loadClient(user, clientId);
  run('DELETE FROM contacts WHERE id = ? AND client_id = ?', intParam(c, 'contactId'), clientId);
  publish({ topic: 'client', id: clientId, clientId });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- activities (calls, notes, feedback)

const activitySchema = z.object({
  kind: z.enum(Object.keys(ACTIVITY_KIND) as [keyof typeof ACTIVITY_KIND, ...(keyof typeof ACTIVITY_KIND)[]]),
  content: zText(4000).min(2, 'נדרש תיאור'),
  outcome: zText(1000).default(''),
  eventId: zId.nullable().default(null),
  nextAction: zText(500).default(''),
  nextActionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, 'מועד לא תקין').nullable().default(null),
  /** Mark earlier scheduled follow-ups of this client as done by this activity. */
  closesFollowups: z.boolean().default(true),
});

clientsRoutes.post('/:id/activities', async (c) => {
  const user = c.get('user');
  const clientId = intParam(c);
  if (!can(user, 'clients', 2) && !can(user, 'sales', 2)) throw forbidden('אין לך הרשאה לתעד פעילות');
  loadClient(user, clientId);
  const b = await body(c, activitySchema);
  if (b.nextActionAt && !b.nextAction) throw invalid('נדרש לפרט את הפעולה הבאה', { fields: { nextAction: 'מה צריך לעשות?' } });
  if (b.eventId && !get('SELECT 1 FROM events WHERE id = ? AND client_id = ?', b.eventId, clientId)) throw invalid('האירוע אינו שייך ללקוח');
  const now = nowISO();
  const id = tx(() => {
    if (b.closesFollowups && b.kind !== 'note') {
      run('UPDATE activities SET next_action_done = 1 WHERE client_id = ? AND next_action_at IS NOT NULL AND next_action_done = 0', clientId);
    }
    const id = insert('activities', {
      client_id: clientId, event_id: b.eventId, user_id: user.id, kind: b.kind, content: b.content, outcome: b.outcome,
      next_action: b.nextAction, next_action_at: b.nextActionAt, at: now,
    });
    if (b.nextActionAt) {
      const due = b.nextActionAt.length === 10 ? `${b.nextActionAt}T09:00` : b.nextActionAt;
      ensureTask({
        type: 'scheduled_call', key: `scheduled_call:${id}`, clientId, eventId: b.eventId, refType: 'activity', refId: id,
        assigneeId: user.id, dueAt: new Date(due).toISOString(),
        action: b.nextAction,
      }, user.id);
    }
    audit({ entity: 'activity', entityId: id, clientId, eventId: b.eventId, userId: user.id, action: 'created', summary: `${ACTIVITY_KIND[b.kind]}: ${b.content.slice(0, 80)}` });
    // A first real contact moves a fresh lead forward in the funnel only by explicit status change — not here.
    return id;
  });
  reconcileClient(clientId);
  if (b.eventId) reconcileEvent(b.eventId);
  publish({ topic: 'client', id: clientId, clientId }, { topic: 'calendar' });
  return c.json({ id }, 201);
});

// ---------------------------------------------------------------- meetings (tour, tasting, scheduled call)

export const meetingsRoutes = new Hono<AppEnv>();

const meetingSchema = z.object({
  kind: z.enum(['tour', 'tasting', 'call']),
  eventId: zId.nullable().default(null),
  clientId: zId.nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך לא תקין'),
  time: z.string().regex(/^(|\d{2}:\d{2})$/, 'שעה לא תקינה').default(''),
  managerId: zId.nullable().default(null),
  notes: zText(2000).default(''),
});

meetingsRoutes.post('/', async (c) => {
  const user = c.get('user');
  const b = await body(c, meetingSchema);
  let clientId = b.clientId;
  if (b.eventId) {
    const ev = get<{ venue: string; client_id: number; sales_status: string; date: string }>('SELECT venue, client_id, sales_status, date FROM events WHERE id = ?', b.eventId);
    if (!ev) throw notFound('האירוע');
    if (!can(user, b.kind === 'tasting' ? 'menu' : 'sales', 2, ev.venue as never)) throw forbidden();
    if (b.kind === 'tasting' && ev.sales_status !== 'signed' && ev.sales_status !== 'hall') throw invalid('טעימות מתקיימות לאחר חתימת החוזה');
    if (b.date > ev.date) throw invalid('המועד חייב להיות לפני האירוע', { fields: { date: 'אחרי מועד האירוע' } });
    clientId = ev.client_id;
  } else if (!can(user, 'sales', 2) || !b.clientId || !clientVisible(user, b.clientId)) throw forbidden();
  if (!clientId) throw invalid('נדרש לקוח או אירוע');
  const id = insert('meetings', { ...{ kind: b.kind, event_id: b.eventId, client_id: clientId, date: b.date, time: b.time, manager_id: b.managerId, notes: b.notes }, created_by: user.id, created_at: nowISO() });
  audit({ entity: 'meeting', entityId: id, eventId: b.eventId, clientId, userId: user.id, action: 'created', summary: `${b.kind === 'tour' ? 'סיור' : b.kind === 'tasting' ? 'טעימות' : 'שיחה'} ב-${b.date}` });
  if (b.eventId) reconcileEvent(b.eventId);
  publish({ topic: 'calendar' }, { topic: 'client', id: clientId, clientId });
  return c.json({ id }, 201);
});

meetingsRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const m = get<{ event_id: number | null; client_id: number | null; kind: string }>('SELECT event_id, client_id, kind FROM meetings WHERE id = ?', id);
  if (!m) throw notFound('הפגישה');
  // Scope comes from the meeting's event (its venue), or from the client when there is no event.
  if (m.event_id) eventFor(user, m.event_id, m.kind === 'tasting' ? 'menu' : 'sales', 2);
  else if (!can(user, 'sales', 2) || !m.client_id || !clientVisible(user, m.client_id)) throw notFound('הפגישה');
  const b = await body(c, z.object({
    status: z.enum(['scheduled', 'done', 'cancelled']).optional(),
    notes: zText(4000).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().regex(/^(|\d{2}:\d{2})$/).optional(),
    managerId: zId.nullable().optional(),
  }));
  const set: Record<string, unknown> = {};
  if (b.status) set.status = b.status;
  if (b.notes !== undefined) set.notes = b.notes;
  if (b.date) set.date = b.date;
  if (b.time !== undefined) set.time = b.time;
  if (b.managerId !== undefined) set.manager_id = b.managerId;
  const keys = Object.keys(set);
  if (keys.length) run(`UPDATE meetings SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => set[k]), id);
  audit({ entity: 'meeting', entityId: id, eventId: m.event_id, clientId: m.client_id, userId: user.id, action: 'updated', diff: b as Record<string, unknown> });
  // A cancelled tasting with no other tasting left reopens "schedule tasting".
  if (m.kind === 'tasting' && b.status === 'cancelled' && m.event_id
    && !get("SELECT 1 FROM meetings WHERE event_id = ? AND kind = 'tasting' AND status != 'cancelled'", m.event_id)) {
    run("UPDATE tasks SET status = 'open', completed_at = NULL, completed_by = NULL, evidence = '', version = version + 1 WHERE event_id = ? AND type = 'schedule_tasting' AND status = 'done'", m.event_id);
  }
  if (m.event_id) reconcileEvent(m.event_id);
  publish({ topic: 'calendar' }, { topic: 'client', id: m.client_id ?? undefined, clientId: m.client_id });
  return c.json({ ok: true });
});
