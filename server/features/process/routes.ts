/**
 * Work process: the editable template, the 8-stage process map, roles & accountability, and data export.
 */
import { Hono } from 'hono';
import { clientScope } from '../../core/scope.ts';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camelAll, forbidden, intParam, invalid, notFound, requireAny, zText, zStageKey, zVenueCode, zEventTypeKey, type AppEnv } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { can, isSupervisor, ROLES, ROLE_DESC, type Role } from '../../../shared/permissions.ts';
import { DONE_WHEN, EVENT_TYPES, VENUE_CODES, VENUE_LABEL, WORK_STAGE_ORDER, WORK_STAGES, SALES_STATUS, MENU_STATUS, PAYMENT_STATUS, type WorkStage } from '../../../shared/domain.ts';
import { TASK_STATUS } from '../../../shared/tasks.ts';
import { nowISO, today, addDays } from '../../../shared/dates.ts';
import type { TaskTemplate } from '../../../shared/types.ts';
import { taskScope, decorate, TASK_SQL } from '../tasks/routes.ts';
import { venueFilter, collectionFor } from '../events/service.ts';
import { EVENT_LIST_SQL, listItem } from '../events/routes.ts';
import { sweep } from '../tasks/engine.ts';
import { seesClientContact } from '../../../shared/navigation.ts';
import { camel } from '../../core/http.ts';
import type { EventRecord } from '../../../shared/types.ts';

export const processRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------- templates

processRoutes.get('/templates', (c) => {
  requireAny(c, 'process', 1);
  return c.json(camelAll<TaskTemplate>(all('SELECT * FROM task_templates ORDER BY active DESC, sort, id')));
});

const zStage = zStageKey;
const templateSchema = z.object({
  title: zText(160).min(2, 'נדרשת כותרת למשימה'),
  action: zText(1000).default(''),
  stage: zStage,
  role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]),
  venue: zVenueCode.nullable().default(null),
  eventType: z.union([z.literal('*'), zEventTypeKey]).default('*'),
  serviceKind: z.enum(['*', 'full', 'platters']).default('*'),
  offsetHours: z.number().min(-24 * 120, 'עד 120 יום לפני').max(24 * 60, 'עד 60 יום אחרי'),
  required: z.boolean().default(true),
  doneWhen: z.enum(Object.keys(DONE_WHEN) as [string, ...string[]]).nullable().default(null),
  anchor: z.enum(['event_start', 'event_end', 'contract_signed', 'event_created']).default('event_start'),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});

const toRow = (b: z.infer<typeof templateSchema>, userId: number) => ({
  title: b.title, action: b.action, stage: b.stage, role: b.role, venue: b.venue, event_type: b.eventType, service_kind: b.serviceKind,
  offset_hours: b.offsetHours, anchor: b.anchor, required: b.required, done_when: b.doneWhen, active: b.active, sort: b.sort, updated_by: userId, updated_at: nowISO(),
});

processRoutes.post('/templates', async (c) => {
  const user = requireAny(c, 'process', 3);
  const b = await body(c, templateSchema);
  const id = insert('task_templates', toRow(b, user.id));
  audit({ entity: 'task_template', entityId: id, userId: user.id, action: 'created', summary: `${WORK_STAGES[b.stage].label}: ${b.title}` });
  sweep(); // reaches open events right away
  publish({ topic: 'task' }, { topic: 'settings' });
  return c.json({ id }, 201);
});

processRoutes.put('/templates/:id', async (c) => {
  const user = requireAny(c, 'process', 3);
  const id = intParam(c);
  if (!get('SELECT 1 FROM task_templates WHERE id = ?', id)) throw notFound('משימת התבנית');
  const b = await body(c, templateSchema);
  const r = toRow(b, user.id);
  run(`UPDATE task_templates SET ${Object.keys(r).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(r), id);
  // Open tasks created from this template follow its wording, role and stage (dates stay as planned).
  run("UPDATE tasks SET title = ?, action = ?, stage = ?, required = ?, done_when = ?, version = version + 1 WHERE template_id = ? AND status IN ('open','in_progress','blocked')",
    b.title, b.action || b.title, b.stage, b.required, b.doneWhen, id);
  audit({ entity: 'task_template', entityId: id, userId: user.id, action: 'updated', summary: `${WORK_STAGES[b.stage].label}: ${b.title}${b.active ? '' : ' (הושבתה)'}` });
  sweep();
  publish({ topic: 'task' }, { topic: 'settings' });
  return c.json({ ok: true });
});

processRoutes.delete('/templates/:id', (c) => {
  const user = requireAny(c, 'process', 3);
  const id = intParam(c);
  const t = get<{ title: string }>('SELECT title FROM task_templates WHERE id = ?', id);
  if (!t) throw notFound('משימת התבנית');
  tx(() => {
    run("UPDATE tasks SET status = 'cancelled', evidence = 'משימת התבנית הוסרה', completed_at = ? WHERE template_id = ? AND status IN ('open','in_progress','blocked')", nowISO(), id);
    run('DELETE FROM task_templates WHERE id = ?', id);
    audit({ entity: 'task_template', entityId: id, userId: user.id, action: 'deleted', summary: t.title });
  });
  publish({ topic: 'task' }, { topic: 'settings' });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- process map

processRoutes.get('/map', (c) => {
  const user = c.get('user');
  if (!isSupervisor(user)) throw forbidden('מפת התהליכים מיועדת להנהלה ולתפעול');
  const scope = taskScope(user);
  const rows = all(`${TASK_SQL} WHERE ${scope.sql} AND t.status != 'cancelled' AND (e.id IS NULL OR e.lifecycle != 'cancelled')`, ...scope.params).map(decorate);
  const stages = WORK_STAGE_ORDER.map((stage) => {
    const list = rows.filter((t) => t.stage === stage);
    const open = list.filter((t) => t.status !== 'done');
    return {
      stage,
      label: WORK_STAGES[stage].label,
      desc: WORK_STAGES[stage].desc,
      templates: get<{ n: number }>('SELECT COUNT(*) AS n FROM task_templates WHERE stage = ? AND active = 1', stage)!.n,
      open: open.length,
      blocked: open.filter((t) => t.status === 'blocked').length,
      overdue: open.filter((t) => t.overdue).length,
      done: list.length - open.length,
      events: new Set(open.map((t) => t.eventId).filter(Boolean)).size,
    };
  });
  return c.json(stages);
});

// ---------------------------------------------------------------- roles & accountability

processRoutes.get('/roles', (c) => {
  const user = c.get('user');
  if (!isSupervisor(user)) throw forbidden('מסך בעלי התפקידים מיועד להנהלה ולתפעול');
  const scope = taskScope(user);
  const tasks = all(`${TASK_SQL} WHERE ${scope.sql} AND t.status IN ('open','in_progress','blocked')`, ...scope.params).map(decorate);
  const people = all<{ id: number; name: string; role: Role; venue: string | null }>(
    'SELECT u.id, u.name, r.role, r.venue FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.active = 1 ORDER BY u.name',
  );
  const roles = (Object.keys(ROLES) as Role[]).filter((r) => r !== 'owner').map((role) => {
    const list = tasks.filter((t) => t.role === role);
    return {
      role,
      label: ROLES[role],
      desc: ROLE_DESC[role],
      people: people.filter((p) => p.role === role).map((p) => ({ id: p.id, name: p.name, venue: p.venue ? VENUE_LABEL[p.venue as keyof typeof VENUE_LABEL] : null })),
      open: list.length,
      blocked: list.filter((t) => t.status === 'blocked').length,
      overdue: list.filter((t) => t.overdue).length,
      unclaimed: list.filter((t) => !t.assigneeId).length,
    };
  });
  return c.json(roles);
});

// ---------------------------------------------------------------- export (CSV for Excel)

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralize spreadsheet formulas; quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
function csv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

processRoutes.get('/export/:kind', (c) => {
  const user = c.get('user');
  const kind = c.req.param('kind');
  let content: string;
  if (kind === 'events') {
    requireAny(c, 'events', 1);
    const vf = venueFilter(user);
    const from = c.req.query('from') ?? addDays(today(), -365);
    const to = c.req.query('to') ?? addDays(today(), 365);
    const rows = all(`${EVENT_LIST_SQL} WHERE ${vf.sql} AND e.date BETWEEN ? AND ? ORDER BY e.date`, ...vf.params, from, to).map((r) => listItem(user, r));
    const money = can(user, 'finance', 1);
    content = csv(
      ['מס׳', 'תאריך', 'שעה', 'אירוע', 'לקוח', 'טלפון', 'נקודה', 'אורחים', 'שלב', 'משימות שהושלמו %', 'חסומות', 'מכירה', 'תפריט', 'מוכנות %', 'מנהל אירוע', ...(money ? ['גבייה', 'יתרה ₪'] : [])],
      rows.map((e) => [e.id, e.date, e.startTime, e.title, e.clientName, seesClientContact(user.grants) ? e.clientPhone : '', VENUE_LABEL[e.venue], e.guests, WORK_STAGES[e.stage].label, e.taskPct, e.blockedTasks,
        SALES_STATUS[e.salesStatus], MENU_STATUS[e.menuStatus], e.readinessPct, e.eventManagerName,
        ...(money ? [e.paymentStatus ? PAYMENT_STATUS[e.paymentStatus as keyof typeof PAYMENT_STATUS] : '', e.balance !== undefined ? (e.balance / 100).toFixed(2) : ''] : [])]),
    );
  } else if (kind === 'tasks') {
    const scope = taskScope(user);
    const rows = all(`${TASK_SQL} WHERE ${scope.sql} AND t.status != 'cancelled' ORDER BY t.due_at`, ...scope.params).map(decorate);
    content = csv(['מס׳', 'משימה', 'פעולה', 'שלב', 'תפקיד', 'מטפל', 'אירוע', 'תאריך אירוע', 'יעד', 'מצב', 'נדרש למוכנות', 'באיחור', 'סיבת חסימה'],
      rows.map((t) => [t.id, t.title, t.action, WORK_STAGES[t.stage]?.label, ROLES[t.role], t.assigneeName, t.eventTitle, t.eventDate, t.dueAt, TASK_STATUS[t.status], t.required ? 'כן' : '', t.overdue ? 'כן' : '', t.blockedReason]));
  } else if (kind === 'clients') {
    requireAny(c, 'clients', 1);
    const cs = clientScope(user, 'c');
    const vf = venueFilter(user);
    const rows = all<{ id: number; name: string; phone: string; email: string; kind: string; company: string; source: string; n: number }>(
      `SELECT c.id, c.name, c.phone, c.email, c.kind, c.company, c.source, (SELECT COUNT(*) FROM events e WHERE e.client_id = c.id AND ${vf.sql}) AS n
         FROM clients c WHERE ${cs.sql} ORDER BY c.name`, ...vf.params, ...cs.params,
    );
    // Phone and e-mail only for roles that work with the client.
    const contact = seesClientContact(user.grants);
    content = csv(['מס׳', 'שם', ...(contact ? ['טלפון', 'מייל'] : []), 'סוג', 'חברה', 'מקור', 'אירועים'],
      rows.map((r) => [r.id, r.name, ...(contact ? [r.phone, r.email] : []), r.kind, r.company, r.source, r.n]));
  } else if (kind === 'receivables') {
    requireAny(c, 'finance', 1);
    const vf = venueFilter(user);
    const rows = all(`SELECT e.*, c.name AS client_name FROM events e LEFT JOIN clients c ON c.id = e.client_id WHERE ${vf.sql} AND e.lifecycle != 'cancelled' AND e.contract_total > 0 ORDER BY e.date`, ...vf.params)
      .map((r) => { const ev = camel<EventRecord & { clientName: string }>(r); return { ev, s: collectionFor(ev) }; });
    content = csv(['מס׳', 'תאריך', 'אירוע', 'לקוח', 'נקודה', 'גורם משלם', 'חוזה ₪', 'התקבל ₪', 'יתרה ₪', 'באיחור ₪', 'מצב'],
      rows.map(({ ev, s }) => [ev.id, ev.date, ev.title, ev.clientName, VENUE_LABEL[ev.venue], ev.payer, (s.contract / 100).toFixed(2), (s.received / 100).toFixed(2), (s.balance / 100).toFixed(2), (s.overdue / 100).toFixed(2), PAYMENT_STATUS[s.status]]));
  } else {
    throw invalid('סוג ייצוא לא מוכר');
  }
  if (!content) throw forbidden();
  return new Response(content, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="matbachon-${kind}-${today()}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
