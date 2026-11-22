/** Task queues: mine, my role queues, unclaimed, overdue/escalated (supervisors), claim/transfer/complete. */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camel, forbidden, intParam, invalid, notFound, zId, zText, HttpError, zStageKey, type AppEnv, type SessionUser } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { getSettings } from '../../core/settings.ts';
import { can, hasRole, isSupervisor, ROLES, venueScope, type Role } from '../../../shared/permissions.ts';
import { TASK_TYPES } from '../../../shared/tasks.ts';
import { WORK_STAGE_ORDER, type VenueCode, type WorkStage } from '../../../shared/domain.ts';
import { addHours, nowISO } from '../../../shared/dates.ts';
import type { TaskLogRecord, TaskRecord } from '../../../shared/types.ts';
import { ensureTask, reconcileEvent } from './engine.ts';
import { loadPrincipal } from '../../core/auth.ts';

export const tasksRoutes = new Hono<AppEnv>();

export const TASK_SQL = `SELECT t.*, e.title AS event_title, e.date AS event_date, c.name AS client_name, u.name AS assignee_name, u2.name AS completed_by_name, u3.name AS blocked_by_name
  FROM tasks t LEFT JOIN events e ON e.id = t.event_id LEFT JOIN clients c ON c.id = t.client_id
  LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users u2 ON u2.id = t.completed_by LEFT JOIN users u3 ON u3.id = t.blocked_by`;

export function decorate(row: Record<string, unknown>): TaskRecord {
  const t = camel<TaskRecord>(row);
  const now = nowISO();
  const open = t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked';
  const overdue = open && !!t.dueAt && t.dueAt < now;
  // Unclaimed work escalates only when it is getting close (process tasks are created weeks ahead).
  const s = getSettings();
  const soon = !s.escalationWindowHours || !t.dueAt || t.dueAt < addHours(now, s.escalationWindowHours);
  const unclaimedTooLong = open && !t.assigneeId && soon && addHours(t.createdAt, s.unclaimedEscalationHours) < now;
  // Per-task override beats the settings default.
  const escalated = !open ? false : t.escalation === 'never' ? false : t.escalation === 'always' ? overdue || !t.assigneeId : overdue || unclaimedTooLong;
  return { ...t, overdue, escalated };
}

/** Tasks the user may see: own, their role queues in their venues, or everything for supervisors. */
export function taskScope(user: SessionUser): { sql: string; params: unknown[] } {
  if (isSupervisor(user) && venueScope(user) === null) return { sql: '1 = 1', params: [] };
  const parts: string[] = ['t.assignee_id = ?'];
  const params: unknown[] = [user.id];
  for (const g of user.grants) {
    if (g.role === 'owner' || g.role === 'ops') {
      parts.push(g.venue ? '(t.venue = ? OR t.venue IS NULL)' : '1 = 1');
      if (g.venue) params.push(g.venue);
      continue;
    }
    parts.push(g.venue ? '(t.role = ? AND (t.venue = ? OR t.venue IS NULL))' : 't.role = ?');
    params.push(g.role, ...(g.venue ? [g.venue] : []));
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

tasksRoutes.get('/', (c) => {
  const user = c.get('user');
  const q = c.req.query();
  // On an event page, everyone who can see the event sees all of its tasks (actions stay limited by role).
  const eventId = q.event ? Number(q.event) : null;
  const eventVenue = eventId ? get<{ venue: VenueCode }>('SELECT venue FROM events WHERE id = ?', eventId)?.venue : undefined;
  const scope = eventVenue && can(user, 'events', 1, eventVenue) ? { sql: '1 = 1', params: [] as unknown[] } : taskScope(user);
  const where: string[] = [scope.sql];
  const params: unknown[] = [...scope.params];
  const status = q.status ?? 'open';
  if (status === 'open') where.push("t.status IN ('open','in_progress','blocked')");
  else if (status !== 'all') { where.push('t.status = ?'); params.push(status); }
  if (q.view === 'mine') { where.push('t.assignee_id = ?'); params.push(user.id); }
  if (q.view === 'unclaimed') where.push('t.assignee_id IS NULL');
  if (q.role) { where.push('t.role = ?'); params.push(q.role); }
  if (q.stage) { where.push('t.stage = ?'); params.push(q.stage); }
  // Horizon: only what is due soon (overdue, blocked and undated always show).
  if (q.horizon && q.horizon !== 'all' && Number(q.horizon) > 0) {
    where.push("(t.due_at IS NULL OR t.due_at <= ? OR t.status = 'blocked')");
    params.push(addHours(nowISO(), Number(q.horizon) * 24));
  }
  if (q.view === 'blocked') where.push("t.status = 'blocked'");
  if (q.q) { where.push('(t.title LIKE ? OR t.action LIKE ? OR e.title LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.venue) { where.push('t.venue = ?'); params.push(q.venue); }
  if (q.event) { where.push('t.event_id = ?'); params.push(Number(q.event)); }
  if (q.client) { where.push('t.client_id = ?'); params.push(Number(q.client)); }
  if (q.assignee) { where.push('t.assignee_id = ?'); params.push(Number(q.assignee)); }
  if (q.ids) { const ids = q.ids.split(',').map(Number).filter(Boolean); where.push(`t.id IN (${ids.map(() => '?').join(',') || 'NULL'})`); params.push(...ids); }
  const rows = all(`${TASK_SQL} WHERE ${where.join(' AND ')} ORDER BY t.status = 'done', t.due_at IS NULL, t.due_at, t.id LIMIT 500`, ...params).map(decorate);
  const filtered = q.view === 'overdue' ? rows.filter((r) => r.overdue) : q.view === 'escalated' ? rows.filter((r) => r.escalated) : rows;
  return c.json(filtered);
});

/** A task is visible if it is in the user's queues, or belongs to an event the user can see. */
function loadTask(user: SessionUser, id: number): TaskRecord {
  const scope = taskScope(user);
  let row = get(`${TASK_SQL} WHERE t.id = ? AND ${scope.sql}`, id, ...scope.params);
  if (!row) {
    const r = get<Record<string, unknown>>(`${TASK_SQL} WHERE t.id = ?`, id);
    if (r && r.venue && r.event_id && can(user, 'events', 1, r.venue as VenueCode)) row = r;
  }
  if (!row) throw notFound('המשימה');
  return decorate(row);
}

tasksRoutes.get('/:id', (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  const log = all<Record<string, unknown>>('SELECT l.*, u.name AS user_name FROM task_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.task_id = ? ORDER BY l.at, l.id', t.id).map((r) => camel<TaskLogRecord>(r));
  const def = TASK_TYPES[t.type];
  return c.json({ task: t, log, evidence: def.evidence, trigger: def.trigger, auto: def.auto });
});

function canWorkOn(user: SessionUser, t: TaskRecord): boolean {
  return t.assigneeId === user.id || hasRole(user, t.role, t.venue) || isSupervisor(user);
}

/** Take a task from the queue. If someone else already took it, report who. */
tasksRoutes.post('/:id/claim', (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canWorkOn(user, t)) throw forbidden('המשימה אינה בתור שלך');
  const r = run("UPDATE tasks SET assignee_id = ?, claimed_at = ?, status = 'in_progress', version = version + 1 WHERE id = ? AND (assignee_id IS NULL OR assignee_id = ?) AND status IN ('open','in_progress','blocked')",
    user.id, nowISO(), t.id, user.id);
  if (!r.changes) {
    const cur = loadTask(user, t.id);
    throw new HttpError(409, cur.assigneeName ? `${cur.assigneeName} כבר לקח/ה את המשימה` : 'המשימה כבר טופלה', 'taken', { assigneeName: cur.assigneeName });
  }
  insert('task_log', { task_id: t.id, user_id: user.id, action: 'claimed', at: nowISO() });
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json(loadTask(user, t.id));
});

tasksRoutes.post('/:id/release', (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (t.assigneeId !== user.id && !isSupervisor(user)) throw forbidden();
  run("UPDATE tasks SET assignee_id = NULL, claimed_at = NULL, status = 'open', version = version + 1 WHERE id = ?", t.id);
  insert('task_log', { task_id: t.id, user_id: user.id, action: 'released', at: nowISO() });
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json(loadTask(user, t.id));
});

/** Hand over to an authorized replacement (same role / venue, or a supervisor). */
tasksRoutes.post('/:id/transfer', async (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canWorkOn(user, t)) throw forbidden();
  const b = await body(c, z.object({ userId: zId, note: zText(500).default('') }));
  const target = loadPrincipal(b.userId);
  if (!target) throw invalid('המשתמש אינו פעיל');
  if (!hasRole(target, t.role, t.venue) && !isSupervisor(target)) throw invalid(`${target.name} אינו מורשה לטפל במשימות ${ROLES[t.role]} בנקודה זו`);
  run('UPDATE tasks SET assignee_id = ?, claimed_at = ?, version = version + 1 WHERE id = ?', target.id, nowISO(), t.id);
  insert('task_log', { task_id: t.id, user_id: user.id, action: 'transferred', note: `הועבר ל${target.name}${b.note ? ` – ${b.note}` : ''}`, at: nowISO() });
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json(loadTask(user, t.id));
});

tasksRoutes.post('/:id/note', async (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canWorkOn(user, t)) throw forbidden();
  const b = await body(c, z.object({ note: zText(1000).min(1, 'נדרש תוכן') }));
  insert('task_log', { task_id: t.id, user_id: user.id, action: 'note', note: b.note, at: nowISO() });
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json({ ok: true });
});

/** Who may change or remove a task by hand: its handler, its role queue, the event's manager, or a supervisor. */
function canManage(user: SessionUser, t: TaskRecord): boolean {
  if (canWorkOn(user, t)) return true;
  return !!t.eventId && !!get('SELECT 1 FROM events WHERE id = ? AND event_manager_id = ?', t.eventId, user.id);
}

/** Manual change of any task (from the template, automatic or manual): wording, stage, role, handler, timing, readiness, escalation. */
tasksRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canManage(user, t)) throw forbidden('אין לך הרשאה לשנות משימה זו');
  if (t.status === 'done' || t.status === 'cancelled') throw invalid('המשימה סגורה. פתח אותה מחדש לפני שינוי.');
  const b = await body(c, z.object({
    version: z.number().int(),
    title: zText(160).min(2, 'נדרשת כותרת').optional(),
    action: zText(1000).optional(),
    stage: zStageKey.optional(),
    role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]).optional(),
    assigneeId: zId.nullable().optional(),
    dueAt: z.string().nullable().optional(),
    required: z.boolean().optional(),
    escalation: z.enum(['never', 'always']).nullable().optional(),
  }));
  if (b.version !== t.version) throw new HttpError(409, 'המשימה עודכנה בינתיים על ידי משתמש אחר. רענן ונסה שוב.', 'conflict');
  if (b.assigneeId) {
    const target = loadPrincipal(b.assigneeId);
    if (!target) throw invalid('המשתמש אינו פעיל', { fields: { assigneeId: 'לא פעיל' } });
  }
  let due: string | null | undefined;
  if (b.dueAt !== undefined) {
    due = b.dueAt ? new Date(b.dueAt).toISOString() : null;
    if (b.dueAt && Number.isNaN(new Date(b.dueAt).getTime())) throw invalid('מועד לא תקין', { fields: { dueAt: 'מועד לא תקין' } });
  }
  const set: Record<string, unknown> = {};
  const changes: string[] = [];
  const current = get<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?', t.id)!;
  // Record only fields whose value actually changed.
  const put = (col: string, v: unknown, label: string) => {
    if (v === undefined || (current[col] ?? null) === (v ?? null)) return;
    set[col] = v;
    changes.push(label);
  };
  put('title', b.title, 'כותרת');
  put('action', b.action, 'פירוט');
  put('stage', b.stage, 'שלב');
  put('role', b.role, 'תפקיד');
  put('assignee_id', b.assigneeId, 'מטפל');
  put('due_at', due, 'מועד');
  put('required', b.required === undefined ? undefined : b.required ? 1 : 0, 'נדרש למוכנות');
  put('escalation', b.escalation, 'הסלמה');
  if (!changes.length) return c.json(t);
  if (b.assigneeId !== undefined) set.claimed_at = b.assigneeId ? nowISO() : null;
  tx(() => {
    run(`UPDATE tasks SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')}, version = version + 1 WHERE id = ?`, ...Object.values(set), t.id);
    insert('task_log', { task_id: t.id, user_id: user.id, action: 'edited', note: `שונה: ${changes.join(', ')}${due !== undefined && changes.includes('מועד') ? ` (יעד ${due ? new Date(due).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }) : 'ללא'})` : ''}`, at: nowISO() });
    audit({ entity: 'task', entityId: t.id, eventId: t.eventId, clientId: t.clientId, userId: user.id, action: 'updated', summary: `${t.title}: ${changes.join(', ')}` });
  });
  if (t.eventId) reconcileEvent(t.eventId);
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json(loadTask(user, t.id));
});

/** Remove a task from the event (kept in history as "removed"; it will not be recreated for this event). */
tasksRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canManage(user, t)) throw forbidden('אין לך הרשאה להסיר משימה זו');
  if (t.status === 'cancelled') return c.json({ ok: true });
  const reason = (c.req.query('reason') ?? '').trim().slice(0, 300);
  if (reason.length < 2) throw invalid('נדרשת סיבה להסרה', { fields: { reason: 'נדרשת סיבה' } });
  tx(() => {
    run("UPDATE tasks SET status = 'cancelled', completed_at = ?, completed_by = ?, evidence = ?, version = version + 1 WHERE id = ?", nowISO(), user.id, `הוסרה ידנית: ${reason}`, t.id);
    insert('task_log', { task_id: t.id, user_id: user.id, action: 'removed', note: reason, at: nowISO() });
    audit({ entity: 'task', entityId: t.id, eventId: t.eventId, clientId: t.clientId, userId: user.id, action: 'removed', summary: `${t.title} – ${reason}` });
  });
  if (t.eventId) reconcileEvent(t.eventId);
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json({ ok: true });
});

/** Reopen a task that was done or removed by mistake. */
tasksRoutes.post('/:id/reopen', (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canManage(user, t)) throw forbidden();
  if (t.status !== 'done' && t.status !== 'cancelled') throw invalid('המשימה פתוחה');
  run("UPDATE tasks SET status = CASE WHEN assignee_id IS NULL THEN 'open' ELSE 'in_progress' END, completed_at = NULL, completed_by = NULL, evidence = '', version = version + 1 WHERE id = ?", t.id);
  insert('task_log', { task_id: t.id, user_id: user.id, action: 'reopened', at: nowISO() });
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json(loadTask(user, t.id));
});

/** Flag a blocker: the task cannot move without someone else's decision. Visible to the event manager and supervisors. */
tasksRoutes.post('/:id/block', async (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canWorkOn(user, t)) throw forbidden();
  if (t.status === 'done' || t.status === 'cancelled') throw invalid('המשימה כבר סגורה');
  const b = await body(c, z.object({ reason: zText(500).min(3, 'נדרש לפרט מה חוסם ומי צריך להחליט') }));
  tx(() => {
    run("UPDATE tasks SET status = 'blocked', blocked_reason = ?, blocked_at = ?, blocked_by = ?, version = version + 1 WHERE id = ?", b.reason, nowISO(), user.id, t.id);
    insert('task_log', { task_id: t.id, user_id: user.id, action: 'blocked', note: b.reason, at: nowISO() });
    audit({ entity: 'task', entityId: t.id, eventId: t.eventId, clientId: t.clientId, userId: user.id, action: 'blocked', summary: `${t.title} – חסום: ${b.reason}` });
  });
  publish({ topic: 'task', id: t.id, eventId: t.eventId }, ...(t.eventId ? [{ topic: 'event' as const, id: t.eventId, eventId: t.eventId }] : []));
  return c.json(loadTask(user, t.id));
});

tasksRoutes.post('/:id/unblock', async (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (t.status !== 'blocked') throw invalid('המשימה אינה חסומה');
  if (!canWorkOn(user, t) && !(t.eventId && get('SELECT 1 FROM events WHERE id = ? AND event_manager_id = ?', t.eventId, user.id))) throw forbidden();
  const b = await body(c, z.object({ note: zText(500).default('') }));
  tx(() => {
    run("UPDATE tasks SET status = CASE WHEN assignee_id IS NULL THEN 'open' ELSE 'in_progress' END, blocked_reason = '', blocked_at = NULL, blocked_by = NULL, version = version + 1 WHERE id = ?", t.id);
    insert('task_log', { task_id: t.id, user_id: user.id, action: 'unblocked', note: b.note, at: nowISO() });
  });
  publish({ topic: 'task', id: t.id, eventId: t.eventId }, ...(t.eventId ? [{ topic: 'event' as const, id: t.eventId, eventId: t.eventId }] : []));
  return c.json(loadTask(user, t.id));
});

/**
 * Manual completion. Tasks whose evidence is operational data are closed automatically;
 * closing them by hand requires a note that explains the evidence.
 */
tasksRoutes.post('/:id/complete', async (c) => {
  const user = c.get('user');
  const t = loadTask(user, intParam(c));
  if (!canWorkOn(user, t)) throw forbidden();
  if (t.status === 'done' || t.status === 'cancelled') throw invalid('המשימה כבר סגורה');
  const b = await body(c, z.object({ note: zText(1000).default('') }));
  const def = TASK_TYPES[t.type];
  if (def.auto && b.note.length < 3) {
    throw invalid(`משימה זו נסגרת אוטומטית כאשר מתועד: ${def.evidence}. לסגירה ידנית יש לפרט בהערה.`, { fields: { note: 'נדרש הסבר' } });
  }
  tx(() => {
    const r = run("UPDATE tasks SET status = 'done', completed_at = ?, completed_by = ?, evidence = ?, assignee_id = COALESCE(assignee_id, ?), version = version + 1 WHERE id = ? AND status NOT IN ('done','cancelled')",
      nowISO(), user.id, b.note || 'בוצע', user.id, t.id);
    if (!r.changes) throw invalid('המשימה כבר נסגרה');
    insert('task_log', { task_id: t.id, user_id: user.id, action: 'completed', note: b.note, at: nowISO() });
    audit({ entity: 'task', entityId: t.id, eventId: t.eventId, clientId: t.clientId, userId: user.id, action: 'completed', summary: `${t.title}${b.note ? ` – ${b.note}` : ''}` });
  });
  if (t.eventId) reconcileEvent(t.eventId);
  publish({ topic: 'task', id: t.id, eventId: t.eventId });
  return c.json(loadTask(user, t.id));
});

tasksRoutes.post('/', async (c) => {
  const user = c.get('user');
  const b = await body(c, z.object({
    title: zText(160).min(2, 'נדרשת כותרת'),
    action: zText(1000).default(''),
    role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]),
    eventId: zId.nullable().default(null),
    clientId: zId.nullable().default(null),
    assigneeId: zId.nullable().default(null),
    dueAt: z.string().nullable().default(null),
    stage: zStageKey.default('readiness'),
    required: z.boolean().default(false),
  }));
  if (!can(user, 'tasks', 2)) throw forbidden();
  if (b.eventId) {
    const ev = get<{ venue: never }>('SELECT venue FROM events WHERE id = ?', b.eventId);
    if (!ev || !can(user, 'events', 1, ev.venue)) throw invalid('האירוע לא נמצא');
  }
  if (b.assigneeId) {
    const target = loadPrincipal(b.assigneeId);
    if (!target) throw invalid('המשתמש אינו פעיל');
  }
  const id = ensureTask({ type: 'manual', key: `manual:${Date.now()}:${user.id}`, title: b.title, action: b.action || b.title, role: b.role, eventId: b.eventId, clientId: b.clientId, assigneeId: b.assigneeId, dueAt: b.dueAt ? new Date(b.dueAt).toISOString() : undefined, stage: b.stage, required: b.required }, user.id);
  if (b.eventId) reconcileEvent(b.eventId);
  return c.json({ id }, 201);
});
