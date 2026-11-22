/** Cross-cutting read models: calendar and role-aware dashboard with drill-down ids. */
import { Hono } from 'hono';
import { seesClientContact } from '../../../shared/navigation.ts';
import { clientScope, clientVisible, warehouseScope } from '../../core/scope.ts';
import { all } from '../../core/db.ts';
import { camel, type AppEnv } from '../../core/http.ts';
import { can, hasRole, isSupervisor, venueScope } from '../../../shared/permissions.ts';
import { addDays, addHours, today, nowISO } from '../../../shared/dates.ts';
import type { CalendarItem, EventRecord } from '../../../shared/types.ts';
import { collectionFor, effectivePortions, readinessFor, shortItemsFor, venueFilter } from '../events/service.ts';
import { EVENT_LIST_SQL, listItem } from '../events/routes.ts';
import { decorate, taskScope, TASK_SQL } from '../tasks/routes.ts';
import { eventProgress } from '../process/service.ts';
import { getSettings } from '../../core/settings.ts';
import { homeFor, isStaffOnly } from '../../../shared/navigation.ts';

export const overviewRoutes = new Hono<AppEnv>();

overviewRoutes.get('/calendar', (c) => {
  const user = c.get('user');
  if (isStaffOnly(user.grants)) return c.json([]);
  const from = c.req.query('from') ?? today();
  const to = c.req.query('to') ?? addDays(from, 42);
  const venue = c.req.query('venue') || null;
  const vf = venueFilter(user);
  const items: CalendarItem[] = [];
  const venueSql = venue ? ' AND e.venue = ?' : '';
  const vp = venue ? [venue] : [];
  if (can(user, 'events', 1)) {
    for (const e of all<{ id: number; title: string; date: string; start_time: string; venue: never; client_id: number; guests: number; sales_status: string; lifecycle: string }>(
      `SELECT e.id, e.title, e.date, e.start_time, e.venue, e.client_id, e.guests, e.sales_status, e.lifecycle FROM events e
        WHERE ${vf.sql}${venueSql} AND e.date BETWEEN ? AND ? AND e.lifecycle != 'cancelled' AND e.sales_status != 'lost'`, ...vf.params, ...vp, from, to,
    )) items.push({ kind: 'event', id: e.id, title: e.title, date: e.date, time: e.start_time, venue: e.venue, eventId: e.id, clientId: e.client_id, status: e.sales_status === 'lead' || e.sales_status === 'quoted' || e.sales_status === 'tour' ? 'tentative' : e.lifecycle, guests: e.guests });
  }
  if (can(user, 'sales', 1) || can(user, 'menu', 1)) {
    for (const m of all<{ id: number; kind: 'tour' | 'tasting' | 'call'; date: string; time: string; event_id: number | null; client_id: number | null; title: string | null; client_name: string | null; venue: never | null; status: string }>(
      `SELECT m.id, m.kind, m.date, m.time, m.event_id, m.client_id, e.title, c.name AS client_name, e.venue, m.status FROM meetings m
         LEFT JOIN events e ON e.id = m.event_id LEFT JOIN clients c ON c.id = m.client_id
        WHERE m.date BETWEEN ? AND ? AND m.status != 'cancelled' ${venue ? 'AND e.venue = ?' : ''}`, from, to, ...vp,
    )) {
      if (m.venue && !can(user, 'events', 1, m.venue)) continue;
      if (!m.venue && (!m.client_id || !clientVisible(user, m.client_id))) continue;
      items.push({ kind: m.kind, id: m.id, title: `${m.kind === 'tour' ? 'סיור' : m.kind === 'tasting' ? 'טעימות' : 'שיחה'}: ${m.title ?? m.client_name ?? ''}`, date: m.date, time: m.time, venue: m.venue, eventId: m.event_id, clientId: m.client_id, status: m.status });
    }
  }
  if (can(user, 'clients', 1)) {
    const cs = clientScope(user, 'c');
    for (const a of all<{ id: number; client_id: number; event_id: number | null; next_action: string; next_action_at: string; name: string }>(
      `SELECT a.id, a.client_id, a.event_id, a.next_action, a.next_action_at, c.name FROM activities a JOIN clients c ON c.id = a.client_id
        WHERE a.next_action_at IS NOT NULL AND a.next_action_done = 0 AND substr(a.next_action_at, 1, 10) BETWEEN ? AND ? AND ${cs.sql}`, from, to, ...cs.params,
    )) items.push({ kind: 'followup', id: a.id, title: `שיחה: ${a.name} – ${a.next_action}`, date: a.next_action_at.slice(0, 10), time: a.next_action_at.slice(11, 16), venue: null, eventId: a.event_id, clientId: a.client_id });
  }
  if (can(user, 'purchasing', 1)) {
    const ws = warehouseScope(user, 'w');
    for (const p of all<{ id: number; expected_date: string; expected_time: string; name: string; venue: never | null; status: string }>(
      `SELECT p.id, p.expected_date, p.expected_time, s.name, p.venue, p.status FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
         JOIN warehouses w ON w.id = p.warehouse_id
        WHERE p.expected_date BETWEEN ? AND ? AND p.status IN ('ordered','partial') AND ${ws.sql}`, from, to, ...ws.params,
    )) items.push({ kind: 'delivery', id: p.id, title: `אספקה: ${p.name}`, date: p.expected_date, time: p.expected_time, venue: p.venue, eventId: null, clientId: null, status: p.status });
  }
  return c.json(items.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99'))));
});

/**
 * Dashboard. Every number comes with the ids that compose it so the UI can drill down.
 * The top always shows the user's own tasks and events.
 */
overviewRoutes.get('/dashboard', (c) => {
  const user = c.get('user');
  const t0 = today();
  const in7 = addDays(t0, 7);
  const vf = venueFilter(user);
  const scope = taskScope(user);

  // Own tasks + unclaimed tasks of the user's own (non-supervisor) role queues.
  const ownQueues = user.grants.filter((g) => g.role !== 'owner' && g.role !== 'ops');
  const queueSql = ownQueues.length
    ? ownQueues.map((g) => (g.venue ? '(t.role = ? AND (t.venue = ? OR t.venue IS NULL))' : 't.role = ?')).join(' OR ')
    : '0 = 1';
  const queueParams = ownQueues.flatMap((g) => (g.venue ? [g.role, g.venue] : [g.role]));
  const opsQueue = user.grants.some((g) => g.role === 'ops') ? " OR t.role = 'ops'" : '';
  const myTasks = all(
    `SELECT t.*, e.title AS event_title, e.date AS event_date, c.name AS client_name, u.name AS assignee_name, NULL AS completed_by_name
       FROM tasks t LEFT JOIN events e ON e.id = t.event_id LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.status IN ('open','in_progress','blocked') AND (t.assignee_id = ? OR (t.assignee_id IS NULL AND (${queueSql}${opsQueue}))
        OR (t.status = 'blocked' AND e.event_manager_id = ?))
        AND (? = 0 OR t.due_at IS NULL OR t.due_at <= ? OR t.status = 'blocked')
      ORDER BY t.status != 'blocked', t.due_at IS NULL, t.due_at LIMIT 40`, user.id, ...queueParams, user.id,
    getSettings().taskHorizonDays, addHours(nowISO(), getSettings().taskHorizonDays * 24),
  ).map(decorate);

  let eventsTitle = 'mine';
  let myEvents = can(user, 'events', 1)
    ? all(`${EVENT_LIST_SQL} WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle = 'planning' AND e.sales_status != 'lost'
            AND (e.event_manager_id = ? OR e.sales_rep_id = ? OR e.kitchen_manager_id = ? OR e.brand_manager_id = ?) ORDER BY e.date LIMIT 20`,
      ...vf.params, t0, addDays(t0, 21), user.id, user.id, user.id, user.id).map((r) => listItem(user, r))
    : [];
  if (!myEvents.length && can(user, 'events', 1)) {
    // Management / unassigned roles: show what is coming up across their venues.
    eventsTitle = 'upcoming';
    myEvents = all(`${EVENT_LIST_SQL} WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle = 'planning' AND e.sales_status IN ('signed','hall') ORDER BY e.date LIMIT 8`,
      ...vf.params, t0, addDays(t0, 14)).map((r) => listItem(user, r));
  }

  const kpis: Record<string, { value: number; ids: number[]; kind: 'events' | 'tasks' | 'money' | 'items'; money?: number }> = {};

  if (can(user, 'events', 1)) {
    const upcoming = all<Record<string, unknown>>(`SELECT e.* FROM events e WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle = 'planning' AND e.sales_status NOT IN ('lost','lead','quoted','tour')`, ...vf.params, t0, in7)
      .map((r) => camel<EventRecord>(r));
    kpis.upcoming = { value: upcoming.length, ids: upcoming.map((e) => e.id), kind: 'events' };
    const notReady = upcoming.filter((e) => readinessFor(e).pct < 100);
    kpis.notReady = { value: notReady.length, ids: notReady.map((e) => e.id), kind: 'events' };
    const short = upcoming.concat(all<Record<string, unknown>>(`SELECT e.* FROM events e WHERE ${vf.sql} AND e.date > ? AND e.date <= ? AND e.lifecycle = 'planning'`, ...vf.params, in7, addDays(t0, 30)).map((r) => camel<EventRecord>(r)))
      .filter((e) => shortItemsFor(e.id) > 0);
    kpis.shortages = { value: short.length, ids: short.map((e) => e.id), kind: 'events' };
    const menuPending = all<{ id: number }>(`SELECT e.id FROM events e WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle = 'planning' AND e.menu_status IN ('open','draft','changed') AND e.sales_status IN ('signed','hall')`, ...vf.params, t0, addDays(t0, 30));
    kpis.menuPending = { value: menuPending.length, ids: menuPending.map((r) => r.id), kind: 'events' };
  }

  const openTasks = all(`SELECT t.* FROM tasks t WHERE t.status IN ('open','in_progress','blocked') AND ${scope.sql}`, ...scope.params).map(decorate);
  kpis.overdue = { value: openTasks.filter((t) => t.overdue).length, ids: openTasks.filter((t) => t.overdue).map((t) => t.id), kind: 'tasks' };
  const blockedTasks = openTasks.filter((t) => t.status === 'blocked');
  kpis.blocked = { value: blockedTasks.length, ids: blockedTasks.map((t) => t.id), kind: 'tasks' };
  if (isSupervisor(user)) {
    const esc = openTasks.filter((t) => t.escalated);
    kpis.escalated = { value: esc.length, ids: esc.map((t) => t.id), kind: 'tasks' };
    const windowDays = getSettings().unclaimedWindowDays;
    const until = addDays(t0, windowDays);
    const unclaimed = openTasks.filter((t) => !t.assigneeId && (!windowDays || !t.dueAt || t.dueAt.slice(0, 10) <= until));
    kpis.unclaimed = { value: unclaimed.length, ids: unclaimed.map((t) => t.id), kind: 'tasks' };
  }

  if (can(user, 'finance', 1)) {
    const evs = all<Record<string, unknown>>(`SELECT e.* FROM events e WHERE ${vf.sql} AND e.lifecycle != 'cancelled' AND e.contract_total > 0`, ...vf.params).map((r) => camel<EventRecord>(r));
    const withBal = evs.map((e) => ({ e, s: collectionFor(e) })).filter((x) => x.s.balance > 0);
    const overdue = withBal.filter((x) => x.s.overdue > 0);
    kpis.receivables = { value: withBal.length, ids: withBal.map((x) => x.e.id), kind: 'money', money: withBal.reduce((s, x) => s + x.s.balance, 0) };
    kpis.overduePayments = { value: overdue.length, ids: overdue.map((x) => x.e.id), kind: 'money', money: overdue.reduce((s, x) => s + x.s.overdue, 0) };
  }

  if (can(user, 'sales', 1)) {
    const leads = all<{ id: number }>(`SELECT e.id FROM events e WHERE ${vf.sql} AND e.sales_status IN ('lead','quoted','tour') AND e.lifecycle = 'planning'`, ...vf.params);
    kpis.openLeads = { value: leads.length, ids: leads.map((r) => r.id), kind: 'events' };
    const newLeads = all<{ id: number }>(`SELECT e.id FROM events e WHERE ${vf.sql} AND e.venue IN (SELECT code FROM venues WHERE track = 'direct') AND e.created_at >= ?`, ...vf.params, addDays(t0, -7));
    kpis.newLeads = { value: newLeads.length, ids: newLeads.map((r) => r.id), kind: 'events' };
  }

  // Only the numbers this role is set to see (Settings → per-role view).
  const home = homeFor(user.grants);
  for (const k of Object.keys(kpis)) if (!home.has(k as never)) delete kpis[k];

  // Kitchen load next 7 days (portions per day).
  let kitchenLoad: { date: string; portions: number; events: number; guests: number }[] = [];
  if (can(user, 'kitchen', 1) && home.has('kitchenLoad')) {
    kitchenLoad = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(t0, i);
      const evs = all<Record<string, unknown>>(`SELECT e.* FROM events e WHERE ${vf.sql} AND e.date = ? AND e.lifecycle = 'planning' AND e.sales_status NOT IN ('lost')`, ...vf.params, date).map((r) => camel<EventRecord>(r));
      return { date, events: evs.length, guests: evs.reduce((s, e) => s + e.guests, 0), portions: evs.reduce((s, e) => s + effectivePortions(e).reduce((a, p) => a + p.portions, 0), 0) };
    });
  }

  const reportTargets = home.has('reports') ? ['kitchen', 'event_manager', 'ops'].filter((r) => hasRole(user, r as never) || hasRole(user, 'owner') || (r === 'ops' && hasRole(user, 'logistics'))) : [];
  const scopeV = venueScope(user);
  const openReports = reportTargets.length
    ? all<{ id: number; event_id: number; content: string; urgent: number; at: string; title: string; acked_at: string | null; target: string }>(
      `SELECT r.id, r.event_id, r.content, r.urgent, r.at, e.title, r.acked_at, r.target FROM field_reports r JOIN events e ON e.id = r.event_id
        WHERE r.resolved_at IS NULL AND r.target IN (${reportTargets.map(() => '?').join(',')}) ${scopeV === null ? '' : scopeV.length ? `AND e.venue IN (${scopeV.map(() => '?').join(',')})` : 'AND 0'}
        ORDER BY r.urgent DESC, r.at DESC LIMIT 20`, ...reportTargets, ...(scopeV ?? []),
    ).map((r) => camel(r))
    : [];

  // Sales see tours, tastings and calls; the kitchen only tastings.
  const meetingKinds = can(user, 'sales', 1) ? ['tour', 'tasting', 'call'] : ['tasting'];
  const meetings = home.has('meetings') && (can(user, 'sales', 1) || can(user, 'menu', 1))
    ? all(`SELECT m.id, m.kind, m.date, m.time, m.event_id, e.title, c.name AS client_name, u.name AS manager_name FROM meetings m
             LEFT JOIN events e ON e.id = m.event_id LEFT JOIN clients c ON c.id = m.client_id LEFT JOIN users u ON u.id = m.manager_id
            WHERE m.status = 'scheduled' AND m.date BETWEEN ? AND ? AND m.kind IN (${meetingKinds.map(() => '?').join(',')})
              AND (CASE WHEN m.event_id IS NOT NULL THEN ${vf.sql} ELSE ${clientScope(user, 'c').sql} END)
            ORDER BY m.date, m.time LIMIT 15`, t0, in7, ...meetingKinds, ...vf.params, ...clientScope(user, 'c').params).map((r) => camel(r))
    : [];

  // The control point: the next committed event and how ready it is for "one hour before".
  let checkpoint: null | { event: ReturnType<typeof listItem>; progress: ReturnType<typeof eventProgress>; blockers: ReturnType<typeof decorate>[] } = null;
  if (can(user, 'events', 1) && home.has('checkpoint')) {
    const next = all<Record<string, unknown>>(`${EVENT_LIST_SQL} WHERE ${vf.sql} AND e.date >= ? AND e.lifecycle = 'planning' AND e.sales_status IN ('signed','hall') ORDER BY e.date, e.start_time LIMIT 1`, ...vf.params, t0)[0];
    if (next) {
      const ev = camel<EventRecord>(next);
      checkpoint = {
        event: listItem(user, next),
        progress: eventProgress(ev),
        // Managers see every open item; everyone else only what is theirs to do.
        blockers: (() => {
          const roles = user.grants.map((g) => g.role);
          const mine = isSupervisor(user) ? '' : ` AND (t.role IN (${roles.map(() => '?').join(',')}) OR t.assignee_id = ?)`;
          return all(`${TASK_SQL} WHERE t.event_id = ? AND t.status IN ('open','in_progress','blocked') AND (t.required = 1 OR t.status = 'blocked')${mine} ORDER BY t.status != 'blocked', t.due_at LIMIT 8`,
            ev.id, ...(isSupervisor(user) ? [] : [...roles, user.id])).map(decorate);
        })(),
      };
    }
  }

  return c.json({ generatedAt: nowISO(), checkpoint, myTasks, myEvents, eventsTitle, kpis, kitchenLoad, openReports, meetings, supervisor: isSupervisor(user) });
});

overviewRoutes.get('/search', (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2 || isStaffOnly(user.grants)) return c.json({ events: [], clients: [] });
  const vf = venueFilter(user);
  const digits = q.replace(/\D/g, '');
  const events = can(user, 'events', 1)
    ? all(`SELECT e.id, e.title, e.date, e.venue, c.name AS client_name FROM events e LEFT JOIN clients c ON c.id = e.client_id
            WHERE ${vf.sql} AND (e.title LIKE ? OR c.name LIKE ? OR CAST(e.id AS TEXT) = ?${digits.length >= 3 ? ' OR c.phone_digits LIKE ?' : ''})
            ORDER BY ABS(julianday(e.date) - julianday('now')) LIMIT 8`, ...vf.params, `%${q}%`, `%${q}%`, q, ...(digits.length >= 3 ? [`%${digits}%`] : [])).map((r) => camel(r))
    : [];
  const clients = can(user, 'clients', 1)
    ? all(`SELECT c.id, c.name, ${seesClientContact(user.grants) ? 'c.phone' : "'' AS phone"}, c.kind FROM clients c
            WHERE (c.name LIKE ? OR c.company LIKE ?${digits.length >= 3 ? ' OR c.phone_digits LIKE ?' : ''}) AND ${clientScope(user, 'c').sql} LIMIT 8`,
      `%${q}%`, `%${q}%`, ...(digits.length >= 3 ? [`%${digits}%`] : []), ...clientScope(user, 'c').params).map((r) => camel(r))
    : [];
  return c.json({ events, clients });
});

