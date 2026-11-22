/**
 * Automatic task engine (spec §4).
 *
 * - Triggers create tasks with a dedupe key, so repeating the same update never creates a duplicate.
 * - Routing: role + venue, and the person assigned to that role on the event when defined.
 * - Auto-completion: open tasks are closed when the operational data proves the work was done
 *   (e.g. a deposit receipt is recorded) — evidence text is stored on the task.
 * - `reconcileEvent` is idempotent and runs after every mutation that touches an event, plus a periodic sweep.
 */
import { all, get, insert, run, tx } from '../../core/db.ts';
import { publish } from '../../core/realtime.ts';
import { getSettings } from '../../core/settings.ts';
import { autoTaskConfig } from '../../../shared/settings.ts';
import { addHours, nowISO, today, addDays } from '../../../shared/dates.ts';
import { TASK_TYPES, type TaskType } from '../../../shared/tasks.ts';
import { DONE_WHEN as DONE_WHEN_LABEL, PRE_SALE_STAGES, VENUE_RULES, type DoneWhen, type VenueCode, type WorkStage } from '../../../shared/domain.ts';
import { FACTS } from '../process/facts.ts';
import type { Role } from '../../../shared/permissions.ts';
import type { EventRecord } from '../../../shared/types.ts';
import { collectionFor, confirmationsFor, eventStartISO, loadEvent, pendingMenuAcks, uncoveredItemsFor } from '../events/service.ts';

export interface NewTask {
  type: TaskType;
  /** Unique business key; when omitted with `onePerEvent`, uniqueness is "one open task of this type per event". */
  key?: string;
  onePerEvent?: boolean;
  title?: string;
  action: string;
  role?: Role;
  venue?: VenueCode | null;
  eventId?: number | null;
  clientId?: number | null;
  refType?: string;
  refId?: number;
  assigneeId?: number | null;
  dueAt?: string | null;
  stage?: WorkStage;
  required?: boolean;
  templateId?: number;
  doneWhen?: DoneWhen | null;
}

function routeAssignee(role: Role, ev: EventRecord | null): number | null {
  if (!ev) return null;
  switch (role) {
    case 'sales': return ev.salesRepId;
    case 'event_manager': return ev.eventManagerId;
    case 'kitchen': return ev.kitchenManagerId;
    case 'brand': return ev.brandManagerId;
    default: return null;
  }
}

export function ensureTask(t: NewTask, actorId: number | null = null): number | null {
  const def = TASK_TYPES[t.type];
  // Automatic types can be switched off or re-routed in Settings (template and manual tasks always apply).
  const cfg = t.type === 'template' || t.type === 'manual' ? { enabled: true, role: def.role } : autoTaskConfig(getSettings(), t.type, def.role);
  if (!cfg.enabled) return null;
  const role = t.role ?? cfg.role;
  const ev = t.eventId ? loadEvent(t.eventId) : null;
  if (t.onePerEvent && t.eventId) {
    const open = get<{ id: number }>("SELECT id FROM tasks WHERE type = ? AND event_id = ? AND status IN ('open','in_progress','blocked')", t.type, t.eventId);
    if (open) return null;
  }
  const key = t.key ?? (t.onePerEvent ? `${t.type}:${t.eventId}:${Date.now()}` : null);
  if (key && get('SELECT id FROM tasks WHERE dedupe_key = ?', key)) return null;
  const now = nowISO();
  const hours = getSettings().taskDueHours[t.type];
  const id = insert('tasks', {
    dedupe_key: key,
    type: t.type,
    title: t.title ?? def.label,
    action: t.action,
    role,
    venue: t.venue ?? ev?.venue ?? null,
    event_id: t.eventId ?? null,
    client_id: t.clientId ?? ev?.clientId ?? null,
    ref_type: t.refType ?? null,
    ref_id: t.refId ?? null,
    assignee_id: t.assigneeId !== undefined ? t.assigneeId : routeAssignee(role, ev),
    status: 'open',
    due_at: t.dueAt !== undefined ? t.dueAt : hours !== undefined ? addHours(now, hours) : null,
    created_at: now,
    stage: t.stage ?? def.stage,
    required: t.required ?? ('required' in def ? def.required : false) ?? false,
    template_id: t.templateId ?? null,
    done_when: t.doneWhen ?? null,
  });
  insert('task_log', { task_id: id, user_id: actorId, action: 'created', note: TASK_TYPES[t.type].trigger, at: now });
  publish({ topic: 'task', id, eventId: t.eventId ?? null });
  return id;
}

/** Repeated triggers of the same kind update the open task instead of creating another one. */
export function upsertOpenTask(t: NewTask & { eventId: number }, actorId: number | null): number | null {
  const open = get<{ id: number }>("SELECT id FROM tasks WHERE type = ? AND event_id = ? AND status IN ('open','in_progress','blocked')", t.type, t.eventId);
  if (!open) return ensureTask({ ...t, key: t.key ?? `${t.type}:${t.eventId}:${Date.now()}` }, actorId);
  run('UPDATE tasks SET action = ?, version = version + 1 WHERE id = ?', t.action, open.id);
  insert('task_log', { task_id: open.id, user_id: actorId, action: 'note', note: `עודכן: ${t.action}`, at: nowISO() });
  publish({ topic: 'task', id: open.id, eventId: t.eventId });
  return open.id;
}

export function completeTask(id: number, evidence: string, userId: number | null): void {
  const t = get<{ status: string; event_id: number | null }>('SELECT status, event_id FROM tasks WHERE id = ?', id);
  if (!t || t.status === 'done' || t.status === 'cancelled') return;
  const now = nowISO();
  run("UPDATE tasks SET status = 'done', completed_at = ?, completed_by = ?, evidence = ?, version = version + 1 WHERE id = ?", now, userId, evidence, id);
  insert('task_log', { task_id: id, user_id: userId, action: userId ? 'completed' : 'auto_completed', note: evidence, at: now });
  publish({ topic: 'task', id, eventId: t.event_id });
}

export function cancelTasks(where: string, params: unknown[], reason: string): void {
  for (const t of all<{ id: number; event_id: number | null }>(`SELECT id, event_id FROM tasks WHERE status IN ('open','in_progress','blocked') AND ${where}`, ...params)) {
    run("UPDATE tasks SET status = 'cancelled', completed_at = ?, evidence = ?, version = version + 1 WHERE id = ?", nowISO(), reason, t.id);
    insert('task_log', { task_id: t.id, user_id: null, action: 'cancelled', note: reason, at: nowISO() });
    publish({ topic: 'task', id: t.id, eventId: t.event_id });
  }
}

/** Keep the event's person-assignment in sync with unclaimed open tasks of that role. */
export function rerouteEventTasks(ev: EventRecord): void {
  for (const role of ['sales', 'event_manager', 'kitchen', 'brand'] as Role[]) {
    const assignee = routeAssignee(role, ev);
    if (!assignee) continue;
    run(
      "UPDATE tasks SET assignee_id = ?, version = version + 1 WHERE event_id = ? AND role = ? AND status = 'open' AND assignee_id IS NULL",
      assignee, ev.id, role,
    );
  }
}

// ---------------------------------------------------------------- auto-completion checks

type Check = (task: { id: number; event_id: number | null; client_id: number | null; ref_id: number | null; created_at: string; dedupe_key: string | null }, ev: EventRecord | null) => string | null;

const CHECKS: Partial<Record<TaskType, Check>> = {
  lead_followup: (t, ev) => {
    // Moving the sale forward (quote, tour, contract) is itself proof the client was contacted.
    if (ev && ev.salesStatus !== 'lead' && ev.salesStatus !== 'lost') return `הפנייה התקדמה: ${ev.salesStatus === 'signed' ? 'חוזה נחתם' : ev.salesStatus === 'quoted' ? 'נשלחה הצעת מחיר' : 'תואם סיור'}`;
    const a = get<{ content: string; at: string }>(
      "SELECT content, at FROM activities WHERE client_id = ? AND kind IN ('call','whatsapp','email','meeting') AND at >= ? ORDER BY at LIMIT 1",
      t.client_id, t.created_at,
    );
    return a ? `תועדה פנייה ללקוח: ${a.content.slice(0, 80)}` : null;
  },
  scheduled_call: (t) => {
    const src = get<{ next_action_done: number }>('SELECT next_action_done FROM activities WHERE id = ?', t.ref_id);
    return src?.next_action_done ? 'השיחה בוצעה ותועדה' : null;
  },
  schedule_tasting: (_t, ev) => {
    const m = ev && get<{ date: string }>("SELECT date FROM meetings WHERE event_id = ? AND kind = 'tasting' AND status != 'cancelled' ORDER BY date LIMIT 1", ev.id);
    return m ? `טעימות נקבעו ל-${m.date}` : null;
  },
  track_deposit: (_t, ev) => {
    if (!ev) return null;
    const d = get<{ amount: number; received: number; received_at: string | null }>("SELECT amount, received, received_at FROM payments WHERE event_id = ? AND kind = 'deposit' ORDER BY id LIMIT 1", ev.id);
    return d && d.received >= d.amount && d.amount > 0 ? `מקדמה התקבלה ${d.received_at ?? ''}`.trim() : null;
  },
  verify_intake: (_t, ev) => (ev?.intakeStatus === 'verified' ? 'פרטי הקליטה אומתו' : ev?.intakeStatus === 'missing' ? 'נפתחה משימת השלמת פרטים' : null),
  complete_intake: (_t, ev) => (ev?.intakeStatus === 'verified' ? 'הפרטים הושלמו ואומתו' : null),
  menu_ack_kitchen: (t) => ackEvidence(t.ref_id, 'kitchen'),
  menu_ack_field: (t) => ackEvidence(t.ref_id, 'event_manager'),
  order_shortage: (_t, ev) => (ev && uncoveredItemsFor(ev.id).length === 0 ? 'החוסר מכוסה במלאי או בהזמנות פתוחות' : null),
  verify_delivery: (t) => {
    const open = get<{ n: number }>('SELECT COUNT(*) AS n FROM po_lines WHERE po_id = ? AND received < qty AND gap_resolved = 0', t.ref_id)!.n;
    return open === 0 ? 'האספקה נקלטה והפערים טופלו' : null;
  },
  unload_check: (_t, ev) => (ev && confirmationsFor(ev.id).includes('unloaded') ? 'הפריקה נספרה' : null),
  report_handle: (t) => {
    const r = get<{ resolved_at: string | null; decision: string }>('SELECT resolved_at, decision FROM field_reports WHERE id = ?', t.ref_id);
    return r?.resolved_at ? `טופל: ${r.decision}` : null;
  },
  readiness_check: (_t, ev) => (ev && confirmationsFor(ev.id).includes('field_ready') ? 'מנהל האירוע אישר מוכנות' : null),
  kitchen_readiness: (_t, ev) => (ev && confirmationsFor(ev.id).includes('kitchen_ready') ? 'מנהל המטבח אישר מוכנות' : null),
  return_rentals: (_t, ev) => (ev && confirmationsFor(ev.id).includes('rentals_returned') ? 'הכלים הוחזרו לספק' : null),
  collect_balance: (_t, ev) => (ev && collectionFor(ev).balance <= 0 ? 'היתרה נגבתה' : null),
  feedback_call: (t, ev) => {
    const a = ev && get<{ content: string }>("SELECT content FROM activities WHERE event_id = ? AND kind IN ('feedback','complaint') AND at >= ? LIMIT 1", ev.id, t.created_at);
    return a ? `משוב תועד: ${a.content.slice(0, 80)}` : null;
  },
};

function ackEvidence(versionId: number | null, role: Role): string | null {
  const a = get<{ acked_at: string | null; name: string | null }>(
    'SELECT a.acked_at, u.name FROM menu_acks a LEFT JOIN users u ON u.id = a.user_id WHERE a.menu_version_id = ? AND a.role = ?',
    versionId, role,
  );
  return a?.acked_at ? `אישור קבלה: ${a.name ?? ''}` : null;
}

function autoCompleteOpen(where: string, params: unknown[]): void {
  const open = all<{ id: number; type: TaskType; event_id: number | null; client_id: number | null; ref_id: number | null; created_at: string; dedupe_key: string | null; done_when: string | null }>(
    `SELECT id, type, event_id, client_id, ref_id, created_at, dedupe_key, done_when FROM tasks WHERE status IN ('open','in_progress','blocked') AND ${where}`,
    ...params,
  );
  for (const t of open) {
    if (t.done_when) {
      const ev = t.event_id ? safeEvent(t.event_id) : null;
      const fact = FACTS[t.done_when as DoneWhen];
      if (ev && fact && fact(ev)) completeTask(t.id, `הושלם לפי הנתונים: ${DONE_WHEN_LABEL[t.done_when as DoneWhen]}`, null);
      continue;
    }
    const check = CHECKS[t.type];
    if (!check) continue;
    const ev = t.event_id ? safeEvent(t.event_id) : null;
    const evidence = check(t, ev);
    if (evidence) completeTask(t.id, evidence, null);
  }
}

function safeEvent(id: number): EventRecord | null {
  try { return loadEvent(id); } catch { return null; }
}

// ---------------------------------------------------------------- state-based triggers

/** Create any tasks the event's current state calls for, then close any that are proven done. */
export function reconcileEvent(eventId: number): void {
  const ev = safeEvent(eventId);
  if (!ev) return;
  tx(() => {
    const rules = VENUE_RULES[ev.venue];
    const s = getSettings();
    const t0 = today();
    const active = ev.lifecycle === 'planning';

    if (ev.lifecycle === 'cancelled') {
      cancelTasks('event_id = ?', [ev.id], 'האירוע בוטל');
      return;
    }

    if (active && rules.track === 'direct' && ev.salesStatus === 'lead') {
      ensureTask({ type: 'lead_followup', key: `lead_followup:${ev.id}`, eventId: ev.id, action: `לחזור ל${ev.title} ולתעד תוצאה ופעולה הבאה` });
    }
    if (ev.salesStatus === 'lost') cancelTasks("event_id = ? AND type IN ('lead_followup')", [ev.id], 'הפנייה לא נסגרה');

    if (active && ev.salesStatus === 'signed') {
      if (ev.serviceKind === 'full') ensureTask({ type: 'schedule_tasting', key: `schedule_tasting:${ev.id}`, eventId: ev.id, action: 'לתאם פגישת טעימות עם הלקוח ולקבוע מנהל טעימות' });
      const dep = get<{ due_date: string | null; amount: number }>("SELECT due_date, amount FROM payments WHERE event_id = ? AND kind = 'deposit' ORDER BY id LIMIT 1", ev.id);
      if (dep && dep.amount > 0) {
        ensureTask({
          type: 'track_deposit', key: `track_deposit:${ev.id}`, eventId: ev.id,
          action: 'לוודא קבלת מקדמה לפי מועד החוזה ולתעד את התקבול',
          dueAt: dep.due_date ? `${dep.due_date}T17:00:00.000Z` : undefined,
        });
      }
    }

    if (active && rules.track === 'hall') {
      if (ev.intakeStatus === 'received') ensureTask({ type: 'verify_intake', key: `verify_intake:${ev.id}`, eventId: ev.id, action: 'לאמת פרטי חתונה שהתקבלה מהאולם: תאריך, שעות, אורחים ואיש קשר' });
      if (ev.intakeStatus === 'missing') ensureTask({ type: 'complete_intake', key: `complete_intake:${ev.id}:${ev.version}`, onePerEvent: true, eventId: ev.id, action: `להשלים: ${ev.intakeMissing || 'פרטים חסרים'}` });
    }

    if (ev.menuStatus === 'changed' && ev.menuVersion > 0) {
      const v = get<{ id: number }>('SELECT id FROM menu_versions WHERE event_id = ? AND version = ?', ev.id, ev.menuVersion);
      if (v) {
        const acks = all<{ role: Role; acked_at: string | null }>('SELECT role, acked_at FROM menu_acks WHERE menu_version_id = ?', v.id);
        for (const a of acks) {
          if (a.acked_at) continue;
          const type: TaskType = a.role === 'kitchen' ? 'menu_ack_kitchen' : 'menu_ack_field';
          ensureTask({ type, key: `${type}:${ev.id}:v${ev.menuVersion}`, eventId: ev.id, refType: 'menu_version', refId: v.id, action: `לבדוק את השינויים בגרסה ${ev.menuVersion} של התפריט ולאשר קבלה` });
        }
        // Earlier-version ack tasks are superseded by the newest version.
        cancelTasks("event_id = ? AND type IN ('menu_ack_kitchen','menu_ack_field') AND ref_id != ?", [ev.id, v.id], 'הוחלף בגרסת תפריט חדשה');
      }
      if (pendingMenuAcks(ev.id, ev.menuVersion) === 0) run("UPDATE events SET menu_status = 'approved' WHERE id = ? AND menu_status = 'changed'", ev.id);
    }

    if (active) {
      const uncovered = uncoveredItemsFor(ev.id);
      if (uncovered.length) {
        ensureTask({
          type: 'order_shortage', onePerEvent: true, eventId: ev.id,
          action: `להזמין חוסרים: ${uncovered.slice(0, 4).map((u) => `${u.name} (${u.short})`).join(', ')}${uncovered.length > 4 ? ' ועוד' : ''}`,
        });
      }
    }

    // Readiness window before the event.
    if (active && ev.date >= t0 && ev.date <= addDays(t0, s.readinessDays)) {
      // The control point: everything must be confirmed this long before the start (spec: one hour).
      const due = addHours(eventStartISO(ev), -(ev.checkpointMinutes ?? s.checkpointMinutes) / 60);
      ensureTask({ type: 'kitchen_readiness', key: `kitchen_readiness:${ev.id}`, eventId: ev.id, dueAt: due, action: 'לוודא שהמזון, ההכנות וצוות המטבח מוכנים ולאשר מוכנות' });
      if (ev.serviceKind === 'full') {
        ensureTask({ type: 'readiness_check', key: `readiness_check:${ev.id}`, eventId: ev.id, dueAt: due, action: 'לבדוק צוות, ציוד ושינויים אחרונים מול המטבח ולאשר מוכנות' });
      }
    }

    const conf = confirmationsFor(ev.id);
    if (rules.loadCheck && conf.includes('loaded') && !conf.includes('unloaded')) {
      ensureTask({ type: 'unload_check', key: `unload_check:${ev.id}`, eventId: ev.id, action: 'לספור אוכל וציוד לאחר הפריקה ולדווח על פערים' });
    }

    // After the event: closing work.
    const ended = conf.includes('executed') || ev.date < t0;
    if (ended && ev.lifecycle !== 'closed') {
      if (rules.equipment === 'rental') {
        const rentals = get<{ n: number }>('SELECT COUNT(*) AS n FROM event_equipment WHERE event_id = ? AND is_food = 0', ev.id)!.n;
        if (rentals > 0) ensureTask({ type: 'return_rentals', key: `return_rentals:${ev.id}`, eventId: ev.id, action: 'להחזיר את כלי ההגשה לספק ולתעד כמויות שהוחזרו' });
      }
      const col = collectionFor(ev);
      if (col.balance > 0) {
        ensureTask({
          type: 'collect_balance', key: `collect_balance:${ev.id}`, eventId: ev.id, action: 'לעקוב אחר תשלום היתרה ולתעד תקבול',
          dueAt: `${addDays(ev.date, s.finalDueDays)}T15:00:00.000Z`,
        });
      }
      if (ev.clientId && ev.salesStatus !== 'lost') {
        ensureTask({ type: 'feedback_call', key: `feedback_call:${ev.id}`, eventId: ev.id, action: 'להתקשר ללקוח, לתעד משוב או תלונה ולקבוע המשך טיפול' });
      }
      if (ev.lifecycle === 'planning' && conf.includes('executed')) {
        run("UPDATE events SET lifecycle = 'completed', updated_at = ? WHERE id = ?", nowISO(), ev.id);
      }
    }

    applyTemplates(ev);
    autoCompleteOpen('event_id = ?', [ev.id]);
  });
  publish({ topic: 'event', id: ev.id, eventId: ev.id });
}

export function reconcileClient(clientId: number): void {
  autoCompleteOpen("client_id = ? AND type IN ('lead_followup','scheduled_call')", [clientId]);
}

export function reconcilePurchaseOrder(poId: number): void {
  autoCompleteOpen("ref_type = 'po' AND ref_id = ?", [poId]);
}

/** Periodic sweep: time-based triggers (deliveries due, upcoming events, finished events). */
export function sweep(): void {
  const s = getSettings();
  const t0 = today();
  for (const p of all<{ id: number; responsible_id: number | null; venue: VenueCode | null; expected_date: string; name: string }>(
    `SELECT p.id, p.responsible_id, p.venue, p.expected_date, s.name FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.status IN ('ordered','partial') AND p.expected_date <= ?`,
    addDays(t0, s.deliveryReminderDays),
  )) {
    ensureTask({
      type: 'verify_delivery', key: `verify_delivery:${p.id}`, refType: 'po', refId: p.id, venue: p.venue,
      assigneeId: p.responsible_id, dueAt: `${p.expected_date}T18:00:00.000Z`,
      title: `אימות אספקה – ${p.name}`, action: `לאמת קבלת הזמנה #${p.id}: כמות בפועל, שעת קבלה וטיפול בפער`,
    });
  }
  autoCompleteOpen("ref_type = 'po'", []);
  // Every active event (≈300 a year): tasks stay right even for events nobody has touched lately.
  const events = all<{ id: number }>(
    "SELECT id FROM events WHERE lifecycle IN ('planning','completed') AND date >= ?",
    addDays(t0, -60),
  );
  for (const e of events) reconcileEvent(e.id);
}

// ---------------------------------------------------------------- work template

interface TemplateRow { id: number; title: string; action: string; stage: WorkStage; role: Role; offset_hours: number; required: number; done_when: DoneWhen | null; anchor: string }

/**
 * Give the event every active template task that matches its venue, type and service.
 * Pre-sale stages apply while a direct sale is open; the rest once the event is committed.
 * Idempotent (one task per template per event); templates added later reach open events on the next run.
 */
export function applyTemplates(ev: EventRecord): void {
  if (ev.lifecycle !== 'planning' && ev.lifecycle !== 'completed') return;
  if (ev.salesStatus === 'lost') return;
  const rules = VENUE_RULES[ev.venue];
  const committed = ev.salesStatus === 'signed' || ev.salesStatus === 'hall';
  const templates = all<TemplateRow>(
    `SELECT id, title, action, stage, role, offset_hours, required, done_when, anchor FROM task_templates
      WHERE active = 1 AND (venue IS NULL OR venue = ?) AND (event_type = '*' OR event_type = ?) AND (service_kind = '*' OR service_kind = ?)
      ORDER BY sort, id`,
    ev.venue, ev.eventType, ev.serviceKind,
  );
  const start = eventStartISO(ev);
  for (const t of templates) {
    const preSale = PRE_SALE_STAGES.includes(t.stage);
    if (rules.track === 'hall' && t.stage === 'inquiry') continue;
    if (!committed && !preSale) continue;
    if (ev.lifecycle === 'completed' && t.stage !== 'closing') continue;
    const key = `tpl:${t.id}:${ev.id}`;
    if (get('SELECT 1 FROM tasks WHERE dedupe_key = ?', key)) continue;
    // Timing is measured from the anchor the business chose for this template.
    let base: string | null = start;
    if (t.anchor === 'event_end') base = ev.endTime ? new Date(`${ev.date}T${ev.endTime}:00`).toISOString() : addHours(start, 5);
    else if (t.anchor === 'event_created') base = ev.createdAt;
    else if (t.anchor === 'contract_signed') {
      base = ev.contractSignedAt ? new Date(`${ev.contractSignedAt}T09:00:00`).toISOString() : ev.hallReceivedAt;
      if (!base) continue; // not signed yet – created once it is
    }
    let due = addHours(base!, t.offset_hours);
    // A timing that falls before the event even existed (late booking) becomes "within two days".
    if (t.anchor === 'event_start' && due < ev.createdAt) due = addHours(ev.createdAt, 48);
    ensureTask({
      type: 'template', key, eventId: ev.id, title: t.title, action: t.action || t.title, role: t.role, stage: t.stage,
      required: !!t.required, templateId: t.id, doneWhen: t.done_when, dueAt: due,
    });
  }
}
