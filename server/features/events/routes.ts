import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { notFound, body, camel, forbidden, intParam, invalid, requireAny, zDate, zId, zPhone, zText, zTime, zAgorot, zStageKey, zVenueCode, zEventTypeKey, type AppEnv, type SessionUser } from '../../core/http.ts';
import { patchRow } from '../../core/patch.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { getSettings } from '../../core/settings.ts';
import { can, isSupervisor } from '../../../shared/permissions.ts';
import { EVENT_TYPES, VENUE_CODES, VENUE_RULES } from '../../../shared/domain.ts';
import { addDays, nowISO, today } from '../../../shared/dates.ts';
import { guestChangeImpact } from '../../../shared/kitchen.ts';
import type { EventDetail, EventListItem, EventRecord, ClientRecord, AuditRecord } from '../../../shared/types.ts';
import {
  accessMap, collectionFor, eventFor, guestCounts, loadEvent, menuLines, readinessFor, recipesFor, redactEvent,
  shortItemsFor, userName, venueFilter,
  availability, venueDefaults,
} from './service.ts';
import { reconcileEvent, rerouteEventTasks, upsertOpenTask } from '../tasks/engine.ts';
import { createClient } from '../clients/service.ts';
import { clientVisible } from '../../core/scope.ts';
import { phoneDigits } from '../clients/service.ts';
import { eventProgress } from '../process/service.ts';
import { WORK_STAGE_ORDER } from '../../../shared/domain.ts';
import { isStaffOnly, seesClientContact } from '../../../shared/navigation.ts';

export const eventsRoutes = new Hono<AppEnv>();

const zVenue = zVenueCode;
const zEventType = zEventTypeKey;
const zCount = z.number().int().min(0).max(20000);
const zUserId = zId.nullable();

// ---------------------------------------------------------------- list

export function listItem(user: SessionUser, row: Record<string, unknown>): EventListItem {
  const ev = camel<EventRecord & { clientName: string | null; clientPhone: string | null; eventManagerName: string | null }>(row);
  const readiness = readinessFor(ev);
  const item: EventListItem = {
    id: ev.id, title: ev.title, venue: ev.venue, eventType: ev.eventType, serviceKind: ev.serviceKind, date: ev.date,
    startTime: ev.startTime, guests: ev.guests, clientId: ev.clientId, clientName: ev.clientName, clientPhone: ev.clientPhone,
    salesStatus: ev.salesStatus, intakeStatus: ev.intakeStatus, menuStatus: ev.menuStatus, lifecycle: ev.lifecycle,
    ...(seesClientContact(user.grants) ? {} : { clientPhone: null }),
    eventManagerId: ev.eventManagerId, eventManagerName: ev.eventManagerName,
    readinessPct: readiness.pct, readinessLabel: readiness.label,
    openTasks: get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND status IN ('open','in_progress','blocked')", ev.id)!.n,
    shortItems: readiness.items.find((i) => i.key === 'stock')?.done === false ? shortItemsFor(ev.id) : 0,
    ...(() => { const p = eventProgress(ev); return { stage: p.stage, taskPct: p.taskPct, blockedTasks: p.blocked }; })(),
  };
  if (can(user, 'finance', 1, ev.venue)) {
    const col = collectionFor(ev);
    item.paymentStatus = col.status;
    item.balance = col.balance;
  }
  return item;
}

export const EVENT_LIST_SQL = `
  SELECT e.*, c.name AS client_name, c.phone AS client_phone, u.name AS event_manager_name
    FROM events e
    LEFT JOIN clients c ON c.id = e.client_id
    LEFT JOIN users u ON u.id = e.event_manager_id`;

eventsRoutes.get('/', (c) => {
  const user = requireAny(c, 'events', 1);
  const q = c.req.query();
  const where: string[] = [];
  const params: unknown[] = [];
  const vf = venueFilter(user);
  where.push(vf.sql);
  params.push(...vf.params);
  // Complementary staff see only the days around today.
  if (isStaffOnly(user.grants)) { where.push('e.date BETWEEN ? AND ?'); params.push(addDays(today(), -1), addDays(today(), 2)); }
  if (q.from) { where.push('e.date >= ?'); params.push(q.from); }
  if (q.to) { where.push('e.date <= ?'); params.push(q.to); }
  if (q.venue) { where.push('e.venue = ?'); params.push(q.venue); }
  if (q.lifecycle) { where.push(`e.lifecycle IN (${q.lifecycle.split(',').map(() => '?').join(',')})`); params.push(...q.lifecycle.split(',')); }
  else if (!q.ids) where.push("e.lifecycle != 'cancelled'");
  if (q.sales) { where.push(`e.sales_status IN (${q.sales.split(',').map(() => '?').join(',')})`); params.push(...q.sales.split(',')); }
  if (q.menu) { where.push('e.menu_status = ?'); params.push(q.menu); }
  if (q.client) { where.push('e.client_id = ?'); params.push(Number(q.client)); }
  if (q.ids) { const ids = q.ids.split(',').map(Number).filter(Boolean); where.push(`e.id IN (${ids.map(() => '?').join(',') || 'NULL'})`); params.push(...ids); }
  if (q.mine === '1') {
    where.push('(e.event_manager_id = ? OR e.sales_rep_id = ? OR e.kitchen_manager_id = ? OR e.brand_manager_id = ?)');
    params.push(user.id, user.id, user.id, user.id);
  }
  if (q.q) {
    const term = `%${q.q.trim()}%`;
    const digits = q.q.replace(/\D/g, '');
    where.push(`(e.title LIKE ? OR c.name LIKE ? OR e.address LIKE ? OR CAST(e.id AS TEXT) = ?${digits.length >= 3 ? ' OR c.phone_digits LIKE ?' : ''})`);
    params.push(term, term, term, q.q.trim(), ...(digits.length >= 3 ? [`%${digits}%`] : []));
  }
  const order = q.order === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Number(q.limit) || 400, 1000);
  const rows = all(`${EVENT_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY e.date ${order}, e.start_time ${order} LIMIT ${limit}`, ...params);
  let items = rows.map((r) => listItem(user, r));
  if (q.readiness === 'incomplete') items = items.filter((i) => i.readinessPct < 100);
  if (q.stage) items = items.filter((i) => i.stage === q.stage);
  if (q.blocked === '1') items = items.filter((i) => i.blockedTasks > 0);
  if (q.short === '1') items = items.filter((i) => i.shortItems > 0);
  return c.json(items);
});

// ---------------------------------------------------------------- create (direct inquiry or hall intake)

const createSchema = z.object({
  venue: zVenue,
  eventType: zEventType,
  serviceKind: z.enum(['full', 'platters']).default('full'),
  title: zText(120).optional(),
  date: zDate,
  dateFlexible: z.boolean().default(false),
  startTime: zTime.default(''),
  endTime: zTime.default(''),
  deliveryTime: zTime.default(''),
  guests: zCount.default(0),
  kids: zCount.default(0),
  menuType: zText(120).default(''),
  kosher: z.enum(['none', 'kosher', 'mehadrin']).default('none'),
  address: zText(300).default(''),
  siteContactName: zText(120).default(''),
  siteContactPhone: zPhone.default(''),
  siteRequirements: zText(2000).default(''),
  specialRequests: zText(2000).default(''),
  notes: zText(4000).default(''),
  source: zText(80).default(''),
  campaign: zText(120).default(''),
  hallContactName: zText(120).default(''),
  hallContactPhone: zPhone.default(''),
  intakeMissing: zText(1000).default(''),
  payer: zText(120).default(''),
  salesRepId: zUserId.optional(),
  eventManagerId: zUserId.optional(),
  kitchenManagerId: zUserId.optional(),
  brandManagerId: zUserId.optional(),
  clientId: zId.optional(),
  client: z.object({
    name: zText(120).min(2, 'נדרש שם לקוח'),
    phone: zPhone.min(9, 'נדרש מספר טלפון'),
    email: z.union([z.literal(''), z.email('מייל לא תקין')]).default(''),
    kind: z.enum(['private', 'company', 'producer']).default('private'),
    company: zText(120).default(''),
  }).optional(),
  allowDuplicateClient: z.boolean().default(false),
  /** The phone the user typed when linking to a client of another venue (proves they know the client). */
  linkPhone: zPhone.optional(),
  /** Book even though the venue is full that day (management decision). */
  allowOverbook: z.boolean().default(false),
  firstNote: zText(2000).default(''),
}).refine((v) => v.clientId || v.client, { message: 'יש לבחור לקוח קיים או לפתוח כרטיס חדש', path: ['client'] });

eventsRoutes.post('/', async (c) => {
  const b = await body(c, createSchema);
  const user = c.get('user');
  const rules = VENUE_RULES[b.venue];
  const needed = rules.track === 'direct' ? can(user, 'sales', 2, b.venue) : can(user, 'events', 2, b.venue);
  if (!needed) throw forbidden(rules.track === 'direct' ? 'קליטת פנייה דורשת הרשאת מכירות בנקודה זו' : 'קליטה מאולם דורשת הרשאת עריכת אירועים בנקודה זו');
  // A hall hands over an event it already sold — it books the date. A lead only warns.
  const day = availability(b.venue, b.date);
  if (day.full && rules.track === 'hall' && !(b.allowOverbook && isSupervisor(user))) {
    throw invalid(`הנקודה מלאה בתאריך זה (${day.booked}/${day.max}): ${day.events.filter((e) => e.booked).map((e) => e.title).join(', ')}`, { fields: { date: 'התאריך מלא בנקודה זו' }, availability: day });
  }

  // What is fixed per venue (hall contact, payer, address, manager) fills in whatever the form left empty.
  const vd = venueDefaults(b.venue);
  const id = tx(() => {
    // Linking to an existing client: one the user can see, or one whose phone the user just typed (a client of another venue).
    if (b.clientId && !clientVisible(user, b.clientId)) {
      const typed = phoneDigits(b.linkPhone ?? '');
      if (!typed || !get('SELECT 1 FROM clients WHERE id = ? AND phone_digits = ?', b.clientId, typed)) throw notFound('הלקוח');
    }
    const clientId = b.clientId ?? createClient({ ...b.client!, source: b.source }, user.id, b.allowDuplicateClient, (id) => clientVisible(user, id));
    const client = get<{ name: string }>('SELECT name FROM clients WHERE id = ?', clientId);
    if (!client) throw invalid('הלקוח לא נמצא');
    const now = nowISO();
    const isHall = rules.track === 'hall';
    const hasRole = (r: string) => user.grants.some((g) => g.role === r);
    const eventId = insert('events', {
      client_id: clientId,
      venue: b.venue,
      title: b.title || `${EVENT_TYPES[b.eventType]} – ${client.name}`,
      event_type: b.eventType,
      service_kind: b.serviceKind,
      date: b.date,
      date_flexible: b.dateFlexible,
      start_time: b.startTime,
      end_time: b.endTime,
      delivery_time: b.deliveryTime,
      guests: b.guests,
      kids: b.kids,
      menu_type: b.menuType,
      kosher: b.kosher,
      address: b.address || vd.address || '',
      site_contact_name: b.siteContactName,
      site_contact_phone: b.siteContactPhone,
      site_requirements: b.siteRequirements,
      special_requests: b.specialRequests,
      notes: b.notes,
      source: b.source,
      campaign: b.campaign,
      sales_status: isHall ? 'hall' : 'lead',
      intake_status: isHall ? 'received' : null,
      hall_received_at: isHall ? now : null,
      hall_contact_name: b.hallContactName || vd.hallContactName || '',
      hall_contact_phone: b.hallContactPhone || vd.hallContactPhone || '',
      intake_missing: b.intakeMissing,
      payer: b.payer || vd.payer || '',
      sales_rep_id: b.salesRepId ?? (hasRole('sales') ? user.id : null),
      event_manager_id: b.eventManagerId ?? vd.eventManagerId ?? null,
      kitchen_manager_id: b.kitchenManagerId ?? null,
      brand_manager_id: b.brandManagerId ?? (hasRole('brand') && isHall ? user.id : null),
      created_by: user.id,
      created_at: now,
      updated_at: now,
    });
    if (b.firstNote) {
      insert('activities', { client_id: clientId, event_id: eventId, user_id: user.id, kind: 'note', content: b.firstNote, at: now });
    }
    audit({ entity: 'event', entityId: eventId, eventId, clientId, userId: user.id, action: 'created', summary: isHall ? 'אירוע נקלט מהאולם' : 'נקלטה פנייה חדשה' });
    return eventId;
  });
  reconcileEvent(id);
  publish({ topic: 'event', id, eventId: id }, { topic: 'calendar' });
  return c.json({ id }, 201);
});

// ---------------------------------------------------------------- detail

eventsRoutes.get('/availability', (c) => {
  requireAny(c, 'events', 1);
  const venue = c.req.query('venue') ?? '';
  const date = c.req.query('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(venue in VENUE_RULES)) throw invalid('נדרשים נקודה ותאריך');
  const exclude = Number(c.req.query('exclude') ?? 0) || undefined;
  const day = availability(venue, date, exclude);
  // Outside the user's venues: whether the day is taken, not by whom.
  if (!can(c.get('user'), 'events', 1, venue as never)) return c.json({ ...day, events: day.events.map((e, i) => ({ ...e, id: 0, title: `אירוע ${i + 1}` })) });
  return c.json(day);
});

eventsRoutes.get('/:id', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c));
  // Client contact details only for roles that work with the client (editable in Settings).
  const contact = seesClientContact(user.grants);
  const client = ev.clientId && can(user, 'clients', 1, ev.venue) && contact
    ? camel<ClientRecord>(get('SELECT * FROM clients WHERE id = ?', ev.clientId))
    : ev.clientId
      ? (camel<ClientRecord>(get(`SELECT id, name, ${contact ? 'phone, email' : "'' AS phone, '' AS email"}, kind, company, '' AS notes, '' AS source, NULL AS owner_id, version, created_at, updated_at FROM clients WHERE id = ?`, ev.clientId)))
      : null;
  const ref = (id: number | null) => (id ? { id, name: userName(id) ?? '' } : null);
  const detail: EventDetail = {
    event: redactEvent(user, ev),
    client,
    readiness: readinessFor(ev),
    collection: can(user, 'finance', 1, ev.venue) ? collectionFor(ev) : null,
    people: {
      salesRep: ref(ev.salesRepId),
      eventManager: ref(ev.eventManagerId),
      kitchenManager: ref(ev.kitchenManagerId),
      brandManager: ref(ev.brandManagerId),
    },
    counts: {
      openTasks: get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND status IN ('open','in_progress','blocked')", ev.id)!.n,
      openReports: get<{ n: number }>('SELECT COUNT(*) AS n FROM field_reports WHERE event_id = ? AND resolved_at IS NULL', ev.id)!.n,
      documents: get<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE event_id = ?', ev.id)!.n,
    },
    access: accessMap(user, ev.venue),
    progress: eventProgress(ev),
  };
  return c.json(detail);
});

// ---------------------------------------------------------------- patch with field groups

const FIELD_GROUPS = {
  events: [
    'title', 'eventType', 'serviceKind', 'date', 'dateFlexible', 'startTime', 'endTime', 'deliveryTime', 'guests', 'kids',
    'vegetarian', 'vegan', 'menuType', 'kosher', 'address', 'siteContactName', 'siteContactPhone', 'siteRequirements',
    'specialRequests', 'notes', 'eventManagerId', 'kitchenManagerId', 'brandManagerId', 'salesRepId', 'ubeyaRef', 'clientId', 'workStage', 'checkpointMinutes', 'readinessSkip',
  ],
  sales: ['salesStatus', 'source', 'campaign', 'lostReason'],
  finance: ['contractTotal', 'payer'],
  intake: ['intakeStatus', 'hallContactName', 'hallContactPhone', 'intakeMissing', 'hallReceivedAt'],
} as const;

const fieldSchemas: Record<string, z.ZodType> = {
  title: zText(120).min(2, 'נדרשת כותרת'),
  eventType: zEventType,
  serviceKind: z.enum(['full', 'platters']),
  date: zDate,
  dateFlexible: z.union([z.boolean(), z.number().int().min(0).max(1)]),
  startTime: zTime, endTime: zTime, deliveryTime: zTime,
  guests: zCount, kids: zCount, vegetarian: zCount, vegan: zCount,
  menuType: zText(120), kosher: z.enum(['none', 'kosher', 'mehadrin']),
  address: zText(300), siteContactName: zText(120), siteContactPhone: zPhone, siteRequirements: zText(2000),
  specialRequests: zText(2000), notes: zText(4000),
  eventManagerId: zUserId, kitchenManagerId: zUserId, brandManagerId: zUserId, salesRepId: zUserId,
  ubeyaRef: zText(80), clientId: zId,
  workStage: zStageKey.nullable(),
  checkpointMinutes: z.number().int().min(0).max(24 * 60).nullable(),
  readinessSkip: z.array(z.string().max(40)).max(20).transform((a) => JSON.stringify([...new Set(a)])),
  salesStatus: z.enum(['lead', 'quoted', 'tour', 'lost']),
  source: zText(80), campaign: zText(120), lostReason: zText(500),
  contractTotal: zAgorot.nullable(), payer: zText(120),
  intakeStatus: z.enum(['received', 'missing', 'verified']),
  hallContactName: zText(120), hallContactPhone: zPhone, intakeMissing: zText(1000), hallReceivedAt: z.string().nullable(),
};

const patchSchema = z.object({ changes: z.record(z.string(), z.unknown()), base: z.record(z.string(), z.unknown()).optional(), allowOverbook: z.boolean().optional() });

eventsRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const ev = eventFor(user, id);
  const b = await body(c, patchSchema);

  // Permission per field group, validation per field.
  const allowed: string[] = [];
  const errors: Record<string, string> = {};
  for (const [field, value] of Object.entries(b.changes)) {
    const group = (Object.keys(FIELD_GROUPS) as (keyof typeof FIELD_GROUPS)[]).find((g) => (FIELD_GROUPS[g] as readonly string[]).includes(field));
    if (!group) { errors[field] = 'שדה לא מוכר'; continue; }
    const ok = group === 'events' ? can(user, 'events', 2, ev.venue)
      : group === 'sales' ? can(user, 'sales', 2, ev.venue)
      : group === 'finance' ? can(user, 'finance', 2, ev.venue)
      : can(user, 'events', 3, ev.venue);
    if (!ok) throw forbidden(`אין לך הרשאה לעדכן את השדה הזה (${field})`);
    const r = fieldSchemas[field].safeParse(value);
    if (!r.success) errors[field] = r.error.issues[0]?.message ?? 'ערך לא תקין';
    else { allowed.push(field); b.changes[field] = typeof r.data === 'boolean' ? (r.data ? 1 : 0) : r.data; }
  }
  if (Object.keys(errors).length) throw invalid('יש שדות שדורשים תיקון', { fields: errors });
  if (ev.lifecycle === 'closed' && !can(user, 'events', 3, ev.venue)) throw forbidden('האירוע סגור. פתיחה מחדש דורשת הרשאת אישור.');
  // Moving a booked event (or moving it to another venue) must not overbook the target day.
  const booked = ev.salesStatus === 'signed' || ev.salesStatus === 'hall';
  if (booked && (('date' in b.changes && b.changes.date !== ev.date) || ('venue' in b.changes && b.changes.venue !== ev.venue)) && !(b.allowOverbook && isSupervisor(user))) {
    const day = availability(String(b.changes.venue ?? ev.venue), String(b.changes.date ?? ev.date), ev.id);
    if (day.full) throw invalid(`הנקודה מלאה בתאריך זה (${day.booked}/${day.max}): ${day.events.filter((e) => e.booked).map((e) => e.title).join(', ')}`, { fields: { date: 'התאריך מלא בנקודה זו' }, availability: day });
  }

  const result = tx(() => {
    const r = patchRow<EventRecord>('events', id, b, allowed);
    if (Object.keys(r.changed).length) {
      audit({ entity: 'event', entityId: id, eventId: id, clientId: r.after.clientId, userId: user.id, action: 'updated', diff: r.changed });
      // Guest-count change after the menu was approved → flag impact on prep and purchasing.
      const guestFields = ['guests', 'kids', 'vegetarian', 'vegan'];
      if (guestFields.some((f) => f in r.changed) && (ev.menuStatus === 'approved' || ev.menuStatus === 'changed')) {
        const lines = menuLines(ev);
        const impact = guestChangeImpact(lines, guestCounts(r.before), guestCounts(r.after), r.after.eventType, recipesFor(lines.map((l) => l.dishId)), getSettings().kitchen);
        const summary = impact.dishes.slice(0, 5).map((d) => `${lines.find((l) => l.dishId === d.dishId)?.dishName}: ${d.before}→${d.after}`).join(', ');
        upsertOpenTask({
          type: 'guest_change', eventId: id,
          action: `אורחים ${r.before.guests}→${r.after.guests}. השפעה על מנות: ${summary || 'ללא שינוי במנות'}. לעדכן דרישות רכש והכנות.`,
        }, user.id);
        if (r.after.date > today() && r.after.date <= addDays(today(), getSettings().guestLockDays)) {
          audit({ entity: 'event', entityId: id, eventId: id, userId: user.id, action: 'late_change', summary: 'שינוי אורחים לאחר מועד הנעילה' });
        }
      }
      if (['eventManagerId', 'kitchenManagerId', 'brandManagerId', 'salesRepId'].some((f) => f in r.changed)) rerouteEventTasks(r.after);
    }
    return r;
  });
  reconcileEvent(id);
  publish({ topic: 'event', id, eventId: id }, { topic: 'calendar' });
  return c.json({ event: redactEvent(user, loadEvent(id)), changed: Object.keys(result.changed) });
});

// ---------------------------------------------------------------- contract signing

const signSchema = z.object({
  signedAt: zDate,
  contractTotal: zAgorot.refine((v) => v > 0, 'נדרש סכום חוזה'),
  deposit: zAgorot,
  depositDue: zDate.nullable(),
  finalDue: zDate.nullable(),
  version: z.number().int(),
  allowOverbook: z.boolean().default(false),
});

eventsRoutes.post('/:id/sign', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const ev = eventFor(user, id, 'sales', 3);
  if (VENUE_RULES[ev.venue].track !== 'direct') throw invalid('חתימת חוזה רלוונטית למכירה ישירה בלבד');
  if (ev.salesStatus === 'signed') throw invalid('החוזה כבר נחתם');
  const b = await body(c, signSchema);
  if (b.deposit > b.contractTotal) throw invalid('המקדמה גדולה מסכום החוזה', { fields: { deposit: 'המקדמה גדולה מסכום החוזה' } });
  const day = availability(ev.venue, ev.date, ev.id);
  if (day.full && !(b.allowOverbook && isSupervisor(user))) throw invalid(`הנקודה כבר תפוסה בתאריך זה (${day.booked}/${day.max}): ${day.events.filter((e) => e.booked).map((e) => e.title).join(', ')}. קביעה ביום מלא – באישור הנהלה בלבד.`, { fields: { allowOverbook: 'התאריך מלא' }, availability: day });
  tx(() => {
    const r = run("UPDATE events SET sales_status = 'signed', contract_signed_at = ?, contract_total = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      b.signedAt, b.contractTotal, nowISO(), id, b.version);
    if (!r.changes) throw invalid('האירוע עודכן בינתיים על ידי משתמש אחר. רענן ונסה שוב.');
    if (b.deposit > 0) insert('payments', { event_id: id, kind: 'deposit', amount: b.deposit, due_date: b.depositDue });
    if (b.contractTotal - b.deposit > 0) insert('payments', { event_id: id, kind: 'final', amount: b.contractTotal - b.deposit, due_date: b.finalDue });
    audit({ entity: 'event', entityId: id, eventId: id, clientId: ev.clientId, userId: user.id, action: 'signed', summary: 'חוזה נחתם' });
  });
  reconcileEvent(id);
  publish({ topic: 'finance', eventId: id });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- lifecycle

const lifecycleSchema = z.object({ lifecycle: z.enum(['planning', 'completed', 'closed', 'cancelled']), reason: zText(500).default('') });

eventsRoutes.post('/:id/lifecycle', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const b = await body(c, lifecycleSchema);
  const ev = eventFor(user, id, 'events', b.lifecycle === 'cancelled' || b.lifecycle === 'planning' ? 3 : 2);
  if (b.lifecycle === 'closed') {
    const blockers: string[] = [];
    const open = get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND status IN ('open','in_progress','blocked')", id)!.n;
    if (open) blockers.push(`${open} משימות פתוחות`);
    const reports = get<{ n: number }>('SELECT COUNT(*) AS n FROM field_reports WHERE event_id = ? AND resolved_at IS NULL', id)!.n;
    if (reports) blockers.push(`${reports} דיווחים פתוחים`);
    const bal = collectionFor(ev).balance;
    if (bal > 0) blockers.push('יתרה פתוחה לגבייה');
    if (blockers.length) throw invalid(`לא ניתן לסגור את האירוע: ${blockers.join(', ')}`, { blockers });
  }
  if (b.lifecycle === 'cancelled' && !b.reason) throw invalid('נדרשת סיבת ביטול', { fields: { reason: 'נדרשת סיבת ביטול' } });
  tx(() => {
    run('UPDATE events SET lifecycle = ?, closed_at = ?, version = version + 1, updated_at = ? WHERE id = ?',
      b.lifecycle, b.lifecycle === 'closed' ? nowISO() : null, nowISO(), id);
    audit({ entity: 'event', entityId: id, eventId: id, clientId: ev.clientId, userId: user.id, action: `lifecycle:${b.lifecycle}`, summary: b.reason });
  });
  reconcileEvent(id);
  publish({ topic: 'calendar' });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- history

eventsRoutes.get('/:id/history', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c));
  const rows = all(
    `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.event_id = ? ORDER BY a.at DESC, a.id DESC LIMIT 300`,
    ev.id,
  ).map((r) => ({ ...camel<AuditRecord>(r), diff: JSON.parse(String(r.diff || '{}')) }));
  const showFinance = can(user, 'finance', 1, ev.venue);
  return c.json(showFinance ? rows : rows.map((r) => ({ ...r, diff: Object.fromEntries(Object.entries(r.diff).filter(([k]) => k !== 'contractTotal')) })));
});
