/**
 * End-to-end business flows through the real HTTP app on an in-memory database seeded with demo data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { openDb, get, all } from '../server/core/db.ts';
import { createApp } from '../server/app.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { reconcileEvent } from '../server/features/tasks/engine.ts';

const app = (() => { openDb(':memory:'); seedDemo(); return createApp(); })();
const cookies: Record<string, string> = {};

async function login(user: string) {
  const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@demo.local`, password: 'demo1234' }) });
  expect(r.status).toBe(200);
  cookies[user] = (r.headers.get('set-cookie') ?? '').split(';')[0];
}
async function call<T = unknown>(user: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await app.request(`/api${path}`, {
    method,
    headers: { cookie: cookies[user], 'x-mb': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, data: (text ? JSON.parse(text) : null) as T };
}
const eventId = (title: string) => get<{ id: number }>('SELECT id FROM events WHERE title = ?', title)!.id;
const openTasks = (eventId: number, type: string) => get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND type = ? AND status IN ('open','in_progress')", eventId, type)!.n;

beforeAll(async () => {
  for (const u of ['owner', 'sales1', 'sales2', 'chef', 'buyer', 'ops', 'em1', 'em2', 'acc', 'brand.eden']) await login(u);
});

describe('direct sale: inquiry → contract → tasting + deposit tasks', () => {
  let id = 0;
  it('creates an inquiry with a follow-up task, and refuses a duplicate client silently', async () => {
    const r = await call<{ id: number }>('sales1', 'POST', '/events', {
      venue: 'winery', eventType: 'conference', date: '2027-03-10', guests: 150, client: { name: 'חברת בדיקה', phone: '054-7777777' }, source: 'גוגל',
    });
    expect(r.status).toBe(201);
    id = r.data.id;
    expect(openTasks(id, 'lead_followup')).toBe(1);
    const dup = await call('sales1', 'POST', '/events', { venue: 'winery', eventType: 'conference', date: '2027-03-11', client: { name: 'אחר', phone: '0547777777' } });
    expect(dup.status).toBe(409);
  });
  it('logging a call closes the follow-up automatically', async () => {
    const clientId = get<{ client_id: number }>('SELECT client_id FROM events WHERE id = ?', id)!.client_id;
    await call('sales1', 'POST', `/clients/${clientId}/activities`, { kind: 'call', content: 'שוחחנו, מבקשים הצעה', eventId: id, nextAction: 'לשלוח הצעה', nextActionAt: '2027-01-05' });
    expect(openTasks(id, 'lead_followup')).toBe(0);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE client_id = ? AND type = 'scheduled_call' AND status = 'open'", clientId)!.n).toBe(1);
  });
  it('signing opens tasting (sales) and deposit (accounting) tasks; a deposit receipt closes its task', async () => {
    const ev = await call<{ event: { version: number } }>('sales1', 'GET', `/events/${id}`);
    const s = await call('sales1', 'POST', `/events/${id}/sign`, { signedAt: '2026-11-17', contractTotal: 4_500_000, deposit: 1_350_000, depositDue: '2026-11-25', finalDue: '2027-03-24', version: ev.data.event.version });
    expect(s.status).toBe(200);
    expect(openTasks(id, 'schedule_tasting')).toBe(1);
    expect(openTasks(id, 'track_deposit')).toBe(1);
    const pay = await call<{ lines: { id: number; kind: string; version: number }[] }>('acc', 'GET', `/finance/events/${id}/payments`);
    const dep = pay.data.lines.find((l) => l.kind === 'deposit')!;
    const rec = await call('acc', 'POST', `/finance/payments/${dep.id}/receive`, { amount: 1_350_000, receivedAt: '2026-11-18', reference: 'העברה 1', version: dep.version });
    expect(rec.status).toBe(200);
    expect(openTasks(id, 'track_deposit')).toBe(0);
  });
  it('sales cannot record payments; accountant cannot edit the menu', async () => {
    expect((await call('sales1', 'POST', `/finance/events/${id}/payments`, { kind: 'interim', amount: 100, dueDate: null })).status).toBe(403);
    expect((await call('acc', 'GET', `/events/${id}/menu`)).status).toBe(403);
  });
});

describe('hall wedding intake and late menu change', () => {
  it('brand manager intake → verify task; marking verified closes it', async () => {
    const r = await call<{ id: number }>('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date: '2027-02-01', guests: 300, client: { name: 'זוג בדיקה', phone: '052-8888888' } });
    expect(r.status).toBe(201);
    expect(openTasks(r.data.id, 'verify_intake')).toBe(1);
    await call('brand.eden', 'PATCH', `/events/${r.data.id}`, { changes: { intakeStatus: 'verified' }, base: { intakeStatus: 'received' } });
    expect(openTasks(r.data.id, 'verify_intake')).toBe(0);
  });
  it('changing an approved menu requires a reason, versions it, and asks kitchen + event manager to acknowledge', async () => {
    const id = eventId('חתונת ענבר ואיתי');
    const m = await call<{ lines: { dishId: number; audience: string; perGuest: number; qtyOverride: number | null; notes: string }[]; dietary: unknown[]; eventVersion: number }>('em2', 'GET', `/events/${id}/menu`);
    const body = { eventVersion: m.data.eventVersion, lines: m.data.lines.map((l) => ({ ...l, notes: l.dishId === m.data.lines[0].dishId ? 'ללא שומשום' : l.notes })), dietary: [{ kind: 'allergy', count: 1, description: 'שומשום' }] };
    expect((await call('em2', 'PUT', `/events/${id}/menu`, body)).status).toBe(422);
    const ok = await call<{ versioned: number }>('em2', 'PUT', `/events/${id}/menu`, { ...body, reason: 'אלרגיה חדשה' });
    expect(ok.data.versioned).toBe(2);
    expect(openTasks(id, 'menu_ack_kitchen')).toBe(1);
    expect(openTasks(id, 'menu_ack_field')).toBe(1);
    await call('chef', 'POST', `/events/${id}/menu/ack`, { role: 'kitchen' });
    await call('em2', 'POST', `/events/${id}/menu/ack`, { role: 'event_manager' });
    expect(openTasks(id, 'menu_ack_kitchen') + openTasks(id, 'menu_ack_field')).toBe(0);
    expect(get<{ menu_status: string }>('SELECT menu_status FROM events WHERE id = ?', id)!.menu_status).toBe('approved');
  });
  it('a stale menu save is refused instead of overwriting', async () => {
    const id = eventId('חתונת ענבר ואיתי');
    const r = await call('chef', 'PUT', `/events/${id}/menu`, { eventVersion: 1, lines: [], dietary: [], reason: 'x' });
    expect(r.status).toBe(422);
  });
});

describe('concurrency, dedupe and task queues', () => {
  it('field-level conflict: same field → 409, different fields merge', async () => {
    const id = eventId('חתונת רותם ועומר');
    const g = get<{ guests: number; notes: string }>('SELECT guests, notes FROM events WHERE id = ?', id)!;
    expect((await call('em2', 'PATCH', `/events/${id}`, { changes: { guests: g.guests + 5 }, base: { guests: g.guests } })).status).toBe(200);
    expect((await call('owner', 'PATCH', `/events/${id}`, { changes: { guests: g.guests + 9 }, base: { guests: g.guests } })).status).toBe(409);
    expect((await call('owner', 'PATCH', `/events/${id}`, { changes: { notes: 'הערה' }, base: { notes: g.notes } })).status).toBe(200);
  });
  it('reconciling the same state twice creates no duplicate tasks', () => {
    const id = eventId('חתונת נוי ואלון');
    const before = all('SELECT id FROM tasks WHERE event_id = ?', id).length;
    reconcileEvent(id); reconcileEvent(id);
    expect(all('SELECT id FROM tasks WHERE event_id = ?', id).length).toBe(before);
  });
  it('two reps claiming the same task: the second sees who took it', async () => {
    const t = get<{ id: number }>("SELECT id FROM tasks WHERE role = 'sales' AND assignee_id IS NULL AND status = 'open' LIMIT 1");
    if (!t) return;
    expect((await call('sales1', 'POST', `/tasks/${t.id}/claim`)).status).toBe(200);
    const second = await call<{ error: string }>('sales2', 'POST', `/tasks/${t.id}/claim`);
    expect(second.status).toBe(409);
    expect(second.data.error).toContain('נועה');
  });
});

describe('purchasing and logistics', () => {
  it('partial receipt updates stock immediately and leaves the gap open', async () => {
    const po = await call<{ id: number }>('buyer', 'POST', '/purchasing/orders', { supplierId: 1, warehouseId: 1, responsibleId: null, expectedDate: '2026-11-17', lines: [{ itemId: 1, qty: 20, eventId: null }] });
    const before = get<{ b: number }>('SELECT COALESCE(SUM(qty),0) AS b FROM stock_movements WHERE item_id = 1 AND warehouse_id = 1')!.b;
    const order = await call<{ lines: { id: number }[] }>('buyer', 'GET', `/purchasing/orders/${po.data.id}`);
    const r = await call<{ status: string; lines: { gap: number }[] }>('buyer', 'POST', `/purchasing/orders/${po.data.id}/receive`, { lines: [{ lineId: order.data.lines[0].id, qty: 12, note: 'חלקי' }] });
    expect(r.data.status).toBe('partial');
    expect(r.data.lines[0].gap).toBe(8);
    expect(get<{ b: number }>('SELECT COALESCE(SUM(qty),0) AS b FROM stock_movements WHERE item_id = 1 AND warehouse_id = 1')!.b).toBe(before + 12);
    expect(get<{ status: string }>("SELECT status FROM tasks WHERE type = 'verify_delivery' AND ref_id = ?", po.data.id)!.status).toBe('open');
  });
  it('farm unloading 18 of 20 boxes creates a gap with an owner and a task', async () => {
    const id = eventId('חתונת ענבר ואיתי');
    await call('ops', 'POST', `/events/${id}/equipment/generate`);
    const eq = await call<{ lines: { id: number; planned: number; label: string }[] }>('ops', 'GET', `/events/${id}/equipment`);
    const food = eq.data.lines.find((l) => l.label.startsWith('מזון'))!;
    await call('ops', 'PUT', `/events/${id}/equipment/counts`, { stage: 'loaded', counts: eq.data.lines.map((l) => ({ id: l.id, qty: l.planned })) });
    expect(openTasks(id, 'unload_check')).toBe(1);
    const r = await call<{ gaps: string[] }>('ops', 'PUT', `/events/${id}/equipment/counts`, { stage: 'unloaded', counts: eq.data.lines.map((l) => ({ id: l.id, qty: l.id === food.id ? l.planned - 2 : l.planned })) });
    expect(r.data.gaps).toHaveLength(1);
    expect(openTasks(id, 'unload_check')).toBe(0);
    expect(openTasks(id, 'report_handle')).toBeGreaterThan(0);
  });
  it('winery equipment counts are rejected for load checks (farm only)', async () => {
    const id = eventId('כנס מכירות שנתי – הפקות גפן');
    const r = await call('em1', 'PUT', `/events/${id}/equipment/counts`, { stage: 'loaded', counts: [{ id: 1, qty: 1 }] });
    expect(r.status).toBe(422);
  });
});

describe('work process: editable template, blockers, checkpoint, export', () => {
  it('committed events get template tasks with due times relative to the start', async () => {
    const id = eventId('כנס מכירות שנתי – הפקות גפן');
    const t = get<{ due_at: string; stage: string; required: number }>("SELECT due_at, stage, required FROM tasks WHERE event_id = ? AND title = 'תוכנית הכנות לפי ימים'", id);
    expect(t).toBeTruthy();
    expect(t!.stage).toBe('kitchen');
    const ev = get<{ date: string; start_time: string }>('SELECT date, start_time FROM events WHERE id = ?', id)!;
    const start = new Date(`${ev.date}T${ev.start_time}:00`).getTime();
    expect(new Date(t!.due_at).getTime()).toBe(start - 72 * 3_600_000);
  });
  it('a template task tied to data closes itself (menu approved → "אישור תפריט סופי" done)', () => {
    const id = eventId('כנס מכירות שנתי – הפקות גפן');
    expect(get<{ status: string }>("SELECT status FROM tasks WHERE event_id = ? AND title = 'אישור תפריט סופי עם הלקוח'", id)!.status).toBe('done');
  });
  it('adding a template reaches open events immediately; editing it updates open tasks; non-owners cannot edit', async () => {
    const r = await call<{ id: number }>('ops', 'POST', '/process/templates', { title: 'בדיקת גנרטור', stage: 'equipment_staff', role: 'logistics', venue: 'offsite', offsetHours: -48, required: true });
    expect(r.status).toBe(201);
    const off = eventId('אירוע הוקרה – עיריית מודיעין');
    expect(openTasks(off, 'template')).toBeGreaterThan(0);
    expect(get('SELECT 1 FROM tasks WHERE event_id = ? AND template_id = ?', off, r.data.id)).toBeTruthy();
    await call('ops', 'PUT', `/process/templates/${r.data.id}`, { title: 'בדיקת גנרטור וכבלים', stage: 'equipment_staff', role: 'logistics', venue: 'offsite', offsetHours: -48, required: true });
    expect(get<{ title: string }>('SELECT title FROM tasks WHERE template_id = ?', r.data.id)!.title).toBe('בדיקת גנרטור וכבלים');
    expect((await call('chef', 'POST', '/process/templates', { title: 'x', stage: 'kitchen', role: 'kitchen', offsetHours: -1 })).status).toBe(403);
  });
  it('blocking a task needs a reason, shows on the event and the dashboard, and can be released', async () => {
    const id = eventId('אירוע הוקרה – עיריית מודיעין');
    const t = get<{ id: number }>("SELECT id FROM tasks WHERE event_id = ? AND title = 'בדיקת גנרטור וכבלים'", id)!;
    expect((await call('ops', 'POST', `/tasks/${t.id}/block`, { reason: '' })).status).toBe(422);
    expect((await call('ops', 'POST', `/tasks/${t.id}/block`, { reason: 'אין גנרטור פנוי – צריך החלטה על שכירות' })).status).toBe(200);
    const ev = await call<{ progress: { blocked: number } }>('owner', 'GET', `/events/${id}`);
    expect(ev.data.progress.blocked).toBe(1);
    const dash = await call<{ kpis: Record<string, { value: number }> }>('owner', 'GET', '/dashboard');
    expect(dash.data.kpis.blocked.value).toBeGreaterThan(0);
    expect((await call('ops', 'POST', `/tasks/${t.id}/unblock`, {})).status).toBe(200);
    expect(get<{ status: string }>('SELECT status FROM tasks WHERE id = ?', t.id)!.status).not.toBe('blocked');
  });
  it('manual required task appears as its own checklist item; tasks replace the checks they cover', async () => {
    const id = eventId('אירוע הוקרה – עיריית מודיעין');
    type Items = { readiness: { pct: number; items: { key: string; taskId?: number; covers?: string; done: boolean }[] } };
    const before = (await call<Items>('owner', 'GET', `/events/${id}`)).data.readiness;
    const r = await call<{ id: number }>('em1', 'POST', '/tasks', { title: 'תיאום חניה לרכב קירור', role: 'logistics', eventId: id, stage: 'equipment_staff', required: true });
    expect(r.status).toBe(201);
    const after = (await call<Items>('owner', 'GET', `/events/${id}`)).data.readiness;
    const item = after.items.find((i) => i.taskId === r.data.id);
    expect(item?.done).toBe(false);
    expect(after.items.length).toBe(before.items.length + 1);
    // No check appears twice: a covered key exists only as task items.
    const covered = new Set(after.items.map((i) => i.covers).filter(Boolean));
    expect(after.items.filter((i) => !i.taskId && covered.has(i.key))).toEqual([]);
  });
  it('event detail exposes stage and the one-hour checkpoint', async () => {
    const id = eventId('אירוע הוקרה – עיריית מודיעין');
    const ev = await call<{ progress: { stage: string; checkpointAt: string; startAt: string } }>('owner', 'GET', `/events/${id}`);
    expect(new Date(ev.data.progress.startAt).getTime() - new Date(ev.data.progress.checkpointAt).getTime()).toBe(60 * 60_000);
    expect(ev.data.progress.stage).toBeTruthy();
  });
  it('exports CSV for Excel and respects permissions', async () => {
    const r = await app.request('/api/process/export/events', { headers: { cookie: cookies.owner } });
    expect(r.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM so Excel shows Hebrew correctly
    expect(new TextDecoder().decode(bytes)).toContain('שלב');
    const chef = await app.request('/api/process/export/receivables', { headers: { cookie: cookies.chef } });
    expect(chef.status).toBe(403);
  });
});

describe('hybrid: settings defaults + manual override per event/task', () => {
  it('a task can be re-timed and edited by hand, then removed from one event without coming back', async () => {
    const id = eventId('אירוע הוקרה – עיריית מודיעין');
    const t = get<{ id: number; version: number }>("SELECT id, version FROM tasks WHERE event_id = ? AND type = 'template' AND status = 'open' LIMIT 1", id)!;
    const due = '2027-01-10T08:30:00.000Z';
    const r = await call<{ dueAt: string; title: string; required: number }>('owner', 'PATCH', `/tasks/${t.id}`, { version: t.version, dueAt: due, title: 'משימה שנערכה ידנית', required: false });
    expect(r.status).toBe(200);
    expect(r.data.dueAt).toBe(due);
    expect(r.data.required).toBe(0);
    expect((await call('owner', 'PATCH', `/tasks/${t.id}`, { version: t.version, title: 'ישן' })).status).toBe(409);
    expect((await call('owner', 'DELETE', `/tasks/${t.id}?reason=`)).status).toBe(422);
    expect((await call('owner', 'DELETE', `/tasks/${t.id}?reason=${encodeURIComponent('לא רלוונטי')}`)).status).toBe(200);
    reconcileEvent(id);
    const tplId = get<{ template_id: number }>('SELECT template_id FROM tasks WHERE id = ?', t.id)!.template_id;
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND template_id = ? AND status != 'cancelled'", id, tplId)!.n).toBe(0);
  });
  it('kitchen staff cannot edit a sales task', async () => {
    const t = get<{ id: number; version: number }>("SELECT id, version FROM tasks WHERE role = 'sales' AND status = 'open' LIMIT 1")!;
    expect((await call('chef', 'PATCH', `/tasks/${t.id}`, { version: t.version, title: 'x x' })).status).toBe(404);
  });
  it('automatic task types can be switched off or re-routed in settings', async () => {
    const s = await call<Record<string, unknown>>('owner', 'GET', '/admin/settings');
    const next = { ...s.data, autoTasks: { lead_followup: { enabled: false }, schedule_tasting: { enabled: true, role: 'event_manager' } } };
    expect((await call('owner', 'PUT', '/admin/settings', next)).status).toBe(200);
    const lead = await call<{ id: number }>('sales1', 'POST', '/events', { venue: 'offsite', eventType: 'catering', date: '2027-04-01', client: { name: 'בדיקת הגדרות', phone: '054-6666666' } });
    expect(openTasks(lead.data.id, 'lead_followup')).toBe(0);
    await call('owner', 'PUT', '/admin/settings', { ...s.data, autoTasks: {} });
  });
  it('readiness: an item can be switched off in settings or marked not relevant for one event', async () => {
    const id = eventId('אירוע הוקרה – עיריית מודיעין');
    const before = (await call<{ readiness: { total: number } }>('owner', 'GET', `/events/${id}`)).data.readiness.total;
    await call('owner', 'PATCH', `/events/${id}`, { changes: { readinessSkip: ['site'] } });
    const ev = (await call<{ readiness: { total: number; items: { key: string; na?: string }[] } }>('owner', 'GET', `/events/${id}`)).data.readiness;
    expect(ev.total).toBe(before - 1);
    expect(ev.items.find((i) => i.key === 'site')!.na).toBe('event');
  });
  it('the checkpoint can differ per event', async () => {
    const id = eventId('אירוע הוקרה – עיריית מודיעין');
    await call('owner', 'PATCH', `/events/${id}`, { changes: { checkpointMinutes: 180 } });
    const p = (await call<{ progress: { checkpointAt: string; startAt: string } }>('owner', 'GET', `/events/${id}`)).data.progress;
    expect(new Date(p.startAt).getTime() - new Date(p.checkpointAt).getTime()).toBe(180 * 60_000);
  });
});

describe('everything editable: venues, event types, stages, words, permissions, timing anchors', () => {
  it('a new venue with its own rules is usable immediately', async () => {
    const r = await call('owner', 'POST', '/admin/venues', { code: 'garden', name: 'גן האירועים', track: 'hall', equipment: 'consumables', loadCheck: true, siteDetails: false, color: '#336699', sort: 5 });
    expect(r.status).toBe(201);
    const ev = await call<{ id: number }>('owner', 'POST', '/events', { venue: 'garden', eventType: 'wedding', date: '2027-05-01', guests: 200, client: { name: 'זוג גן', phone: '052-1231231' } });
    expect(ev.status).toBe(201);
    expect(openTasks(ev.data.id, 'verify_intake')).toBe(1); // hall track from the venue's own rules
    const d = await call<{ readiness: { items: { key: string }[] } }>('owner', 'GET', `/events/${ev.data.id}`);
    expect(d.data.readiness.items.map((i) => i.key)).toContain('loaded');
  });
  it('event types, stages and words are editable; types in use cannot be deleted', async () => {
    const cfg = await call<{ system: Record<string, unknown> }>('owner', 'GET', '/admin/config');
    const { defaultEventTypes, defaultStages } = await import('../shared/config.ts');
    const types = [...defaultEventTypes(), { key: 'brit', label: 'ברית', venues: ['offsite', 'garden'], style: 'reception', active: true }];
    const stages = [...defaultStages(), { key: 'marketing', label: 'שיווק לאחר אירוע', desc: 'תמונות וביקורות' }];
    const ok = await call('owner', 'PUT', '/admin/system', { ...cfg.data.system, eventTypes: types, workStages: stages, labels: { roles: { sales: 'מכירות ושירות לקוחות' } } });
    expect(ok.status).toBe(200);
    const { ROLES } = await import('../shared/permissions.ts');
    expect(ROLES.sales).toBe('מכירות ושירות לקוחות');
    const ev = await call('sales1', 'POST', '/events', { venue: 'offsite', eventType: 'brit', date: '2027-06-01', client: { name: 'משפחת ברית', phone: '052-9879879' } });
    expect(ev.status).toBe(201);
    expect((await call('owner', 'POST', '/process/templates', { title: 'בקשת ביקורת', stage: 'marketing', role: 'sales', offsetHours: 48, anchor: 'event_end' })).status).toBe(201);
    const without = types.filter((t) => t.key !== 'wedding');
    expect((await call('owner', 'PUT', '/admin/system', { ...cfg.data.system, eventTypes: without, workStages: stages })).status).toBe(422);
  });
  it('permissions are editable, but the owner can never be locked out', async () => {
    const cfg = await call<{ system: Record<string, unknown> }>('owner', 'GET', '/admin/config');
    const sys = cfg.data.system as { eventTypes: unknown; workStages: unknown };
    expect((await call('chef', 'GET', '/clients')).status).toBe(403);
    await call('owner', 'PUT', '/admin/system', { ...cfg.data.system, eventTypes: sys.eventTypes, workStages: sys.workStages, permissions: { kitchen: { clients: 1 }, owner: { admin: 0 } } });
    expect((await call('chef', 'GET', '/clients')).status).toBe(200);
    expect((await call('owner', 'GET', '/users')).status).toBe(200);
  });
  it('template timing can be measured from the contract signing', async () => {
    const r = await call<{ id: number }>('owner', 'POST', '/process/templates', { title: 'שליחת מכתב ברוכים הבאים', stage: 'menu_quote', role: 'sales', offsetHours: 24, anchor: 'contract_signed' });
    const id = eventId('כנס מכירות שנתי – הפקות גפן');
    reconcileEvent(id);
    const t = get<{ due_at: string }>('SELECT due_at FROM tasks WHERE event_id = ? AND template_id = ?', id, r.data.id)!;
    const signed = get<{ contract_signed_at: string }>('SELECT contract_signed_at FROM events WHERE id = ?', id)!.contract_signed_at;
    expect(new Date(t.due_at).getTime()).toBe(new Date(`${signed}T09:00:00`).getTime() + 24 * 3_600_000);
  });
});
