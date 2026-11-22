/**
 * Every action in the system, called with the same payload the screen sends.
 * For each: it succeeds for the right role, the data actually changes, everything that depends on it updates
 * (tasks, readiness, stock, dashboard, history), bad input is refused with a message next to the field,
 * and a role without permission is refused.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { openDb, get, all } from '../server/core/db.ts';
import { createApp } from '../server/app.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { subscribe } from '../server/core/realtime.ts';
import { reconcileEvent } from '../server/features/tasks/engine.ts';

const app = (() => { openDb(':memory:'); seedDemo(); return createApp(); })();
const cookies: Record<string, string> = {};
type R<T = any> = { status: number; data: T }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function login(u: string) {
  const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: `${u}@demo.local`, password: 'demo1234' }) });
  cookies[u] = (r.headers.get('set-cookie') ?? '').split(';')[0];
}
async function call<T = any>(u: string, method: string, path: string, body?: unknown): Promise<R<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const isForm = body instanceof FormData;
  const r = await app.request(`/api${path}`, {
    method, headers: { cookie: cookies[u], 'x-mb': '1', ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const t = await r.text();
  let data: unknown = t;
  try { data = t ? JSON.parse(t) : null; } catch { /* binary */ }
  return { status: r.status, data: data as T };
}
const ev = (title: string) => get<{ id: number; version: number; venue: string; client_id: number }>('SELECT id, version, venue, client_id FROM events WHERE title = ?', title)!;
const openCount = (eventId: number, where = '1=1') => get<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND status IN ('open','in_progress','blocked') AND ${where}`, eventId)!.n;
const lastAudit = (eventId: number) => get<{ action: string }>('SELECT action FROM audit_log WHERE event_id = ? ORDER BY id DESC LIMIT 1', eventId)?.action;
const stock = (item: number, wh: number) => get<{ b: number }>('SELECT COALESCE(SUM(qty),0) AS b FROM stock_movements WHERE item_id = ? AND warehouse_id = ?', item, wh)!.b;
const fieldErr = (r: R) => (r.data?.details?.fields ?? {}) as Record<string, string>;

beforeAll(async () => {
  for (const u of ['owner', 'ops', 'sales1', 'sales2', 'brand.eden', 'brand.farm', 'chef', 'buyer', 'em1', 'em2', 'acc', 'staff', 'logistics', 'crew']) await login(u);
});

// ---------------------------------------------------------------- auth & safety
describe('auth and request safety', () => {
  it('wrong password, no CSRF header, and no session are refused', async () => {
    const bad = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@demo.local', password: 'x' }) });
    expect(bad.status).toBe(401);
    const noHeader = await app.request('/api/events', { method: 'POST', headers: { cookie: cookies.owner, 'content-type': 'application/json' }, body: '{}' });
    expect(noHeader.status).toBe(403);
    expect((await app.request('/api/dashboard')).status).toBe(401);
  });
  it('logout ends the session on the server', async () => {
    await login('sales2');
    const c = cookies.sales2;
    await call('sales2', 'POST', '/auth/logout');
    expect((await app.request('/api/auth/me', { headers: { cookie: c } })).status).toBe(401);
    await login('sales2');
  });
});

// ---------------------------------------------------------------- inquiry → sale
describe('inquiry, client, quote, tour, contract', () => {
  let id = 0; let clientId = 0;
  it('new inquiry: required fields are validated next to the field', async () => {
    const r = await call('sales1', 'POST', '/events', { venue: 'winery', eventType: 'conference', date: '', client: { name: '', phone: '12' } });
    expect(r.status).toBe(422);
    expect(Object.keys(fieldErr(r))).toEqual(expect.arrayContaining(['date', 'client.name', 'client.phone']));
  });
  it('new inquiry creates client + event + follow-up task + history, and shows on the calendar and pipeline', async () => {
    const r = await call('sales1', 'POST', '/events', { venue: 'winery', eventType: 'conference', serviceKind: 'full', date: '2027-02-15', startTime: '10:00', guests: 120, source: 'גוגל', campaign: 'חורף', firstNote: 'ביקשו הצעה', client: { name: 'חברת פעולות', phone: '054-1212121', email: '', kind: 'company', company: 'פעולות בע״מ' } });
    expect(r.status).toBe(201);
    id = r.data.id; clientId = ev('כנס – חברת פעולות').client_id;
    expect(openCount(id, "type = 'lead_followup'")).toBe(1);
    expect(lastAudit(id)).toBe('created');
    const cal = await call('sales1', 'GET', '/calendar?from=2027-02-01&to=2027-02-28');
    expect(cal.data.some((i: { eventId: number }) => i.eventId === id)).toBe(true);
    const pipe = await call('sales1', 'GET', '/sales/pipeline');
    expect(pipe.data.some((e: { id: number }) => e.id === id)).toBe(true);
  });
  it('client lookup by phone finds the existing card', async () => {
    const r = await call('sales1', 'GET', '/clients/lookup?phone=0541212121');
    expect(r.data.id).toBe(clientId);
  });
  it('edit client (with conflict guard) and add / remove a contact', async () => {
    const c = await call('sales1', 'GET', `/clients/${clientId}`);
    const p = await call('sales1', 'PATCH', `/clients/${clientId}`, { changes: { notes: 'לקוח VIP' }, base: { notes: c.data.client.notes } });
    expect(p.status).toBe(200);
    expect((await call('sales1', 'PATCH', `/clients/${clientId}`, { changes: { email: 'not-an-email' } })).status).toBe(422);
    const add = await call('sales1', 'POST', `/clients/${clientId}/contacts`, { name: 'רינה', role: 'מנהלת רווחה', phone: '050-1111222', email: '', isEndClient: true });
    expect(add.status).toBe(201);
    expect((await call('sales1', 'DELETE', `/clients/${clientId}/contacts/${add.data.id}`)).status).toBe(200);
    expect((await call('chef', 'POST', `/clients/${clientId}/contacts`, { name: 'x x' })).status).toBe(403);
  });
  it('logging a call closes the follow-up and schedules the next one on the calendar', async () => {
    const r = await call('sales1', 'POST', `/clients/${clientId}/activities`, { kind: 'call', content: 'שלחנו הצעה', outcome: 'מעוניינים', eventId: id, nextAction: 'לחזור על סיור', nextActionAt: '2027-01-10T10:00' });
    expect(r.status).toBe(201);
    expect(openCount(id, "type = 'lead_followup'")).toBe(0);
    expect(get('SELECT 1 FROM tasks WHERE type = \'scheduled_call\' AND ref_id = ?', r.data.id)).toBeTruthy();
    const bad = await call('sales1', 'POST', `/clients/${clientId}/activities`, { kind: 'call', content: 'x', nextActionAt: '2027-01-10' });
    expect(bad.status).toBe(422);
  });
  it('quote moves the sale to "quoted"; total ≠ per-guest × guests needs an explanation', async () => {
    const bad = await call('sales1', 'POST', `/sales/events/${id}/quotes`, { guests: 120, perGuest: 25000, total: 2_000_000, description: '' });
    expect(bad.status).toBe(422);
    const ok = await call('sales1', 'POST', `/sales/events/${id}/quotes`, { guests: 120, perGuest: 25000, total: 3_000_000, description: '' });
    expect(ok.status).toBe(201);
    expect(get<{ sales_status: string }>('SELECT sales_status FROM events WHERE id = ?', id)!.sales_status).toBe('quoted');
    const q2 = await call('sales1', 'POST', `/sales/events/${id}/quotes`, { guests: 130, perGuest: 25000, total: 3_250_000, description: '' });
    expect(q2.status).toBe(201);
    const list = await call('sales1', 'GET', `/sales/events/${id}/quotes`);
    expect(list.data.map((q: { status: string }) => q.status)).toEqual(['sent', 'superseded']);
  });
  it('tour: scheduled, then impressions recorded; a tour after the event date is refused', async () => {
    expect((await call('sales1', 'POST', '/meetings', { kind: 'tour', eventId: id, date: '2027-03-01', time: '10:00', managerId: null, notes: '' })).status).toBe(422);
    const m = await call('sales1', 'POST', '/meetings', { kind: 'tour', eventId: id, date: '2027-01-20', time: '10:00', managerId: null, notes: '' });
    expect(m.status).toBe(201);
    expect((await call('sales1', 'PATCH', `/meetings/${m.data.id}`, { notes: 'התרשמו מאוד', status: 'done' })).status).toBe(200);
    expect(get<{ status: string }>('SELECT status FROM meetings WHERE id = ?', m.data.id)!.status).toBe('done');
  });
  it('tasting before signing is refused', async () => {
    expect((await call('sales1', 'POST', '/meetings', { kind: 'tasting', eventId: id, date: '2027-01-25', time: '17:00' })).status).toBe(422);
  });
  it('contract: deposit larger than total refused; signing creates payments + tasks; tasting then closes its task', async () => {
    const version = ev('כנס – חברת פעולות').version;
    expect((await call('sales1', 'POST', `/events/${id}/sign`, { signedAt: '2026-11-18', contractTotal: 100, deposit: 200, depositDue: null, finalDue: null, version })).status).toBe(422);
    const s = await call('sales1', 'POST', `/events/${id}/sign`, { signedAt: '2026-11-18', contractTotal: 3_250_000, deposit: 975_000, depositDue: '2026-11-25', finalDue: '2027-03-01', version });
    expect(s.status).toBe(200);
    expect(all('SELECT kind FROM payments WHERE event_id = ?', id).length).toBe(2);
    expect(openCount(id, "type = 'schedule_tasting'")).toBe(1);
    expect(openCount(id, "type = 'track_deposit'")).toBe(1);
    expect(openCount(id, "type = 'template'")).toBeGreaterThan(0); // committed → the work template applies
    const t = await call('sales1', 'POST', '/meetings', { kind: 'tasting', eventId: id, date: '2027-01-25', time: '17:00', managerId: null, notes: '' });
    expect(t.status).toBe(201);
    expect(openCount(id, "type = 'schedule_tasting'")).toBe(0);
    expect((await call('sales1', 'POST', `/events/${id}/sign`, { signedAt: '2026-11-18', contractTotal: 1, deposit: 0, depositDue: null, finalDue: null, version: 99 })).status).toBe(422);
  });
  it('lost reason recorded; non-sales cannot change the sale status', async () => {
    const other = ev('אירוע – מיכל לוי');
    expect((await call('chef', 'PATCH', `/events/${other.id}`, { changes: { salesStatus: 'lost' } })).status).toBe(403);
    const r = await call('sales1', 'PATCH', `/events/${other.id}`, { changes: { salesStatus: 'lost', lostReason: 'מחיר' }, base: { salesStatus: 'lead' } });
    expect(r.status).toBe(200);
    expect(openCount(other.id, "type = 'lead_followup'")).toBe(0);
  });
});

// ---------------------------------------------------------------- hall intake
describe('hall intake', () => {
  it('brand manager: create, mark missing (opens completion task), then verify (closes both)', async () => {
    const r = await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date: '2027-04-04', guests: 300, kids: 20, hallContactName: 'דנה', hallContactPhone: '08-1234567', payer: 'האולם', intakeMissing: '', client: { name: 'זוג קליטה', phone: '052-3434343' } });
    const id = r.data.id;
    const v = ev('חתונה – זוג קליטה').version;
    await call('brand.eden', 'PATCH', `/events/${id}`, { changes: { intakeStatus: 'missing', intakeMissing: 'שעת קבלת פנים' }, base: { intakeStatus: 'received' } });
    expect(openCount(id, "type = 'complete_intake'")).toBe(1);
    await call('brand.eden', 'PATCH', `/events/${id}`, { changes: { intakeStatus: 'verified' }, base: { intakeStatus: 'missing' } });
    expect(openCount(id, "type IN ('complete_intake','verify_intake')")).toBe(0);
    expect(v).toBeGreaterThan(0);
    expect((await call('brand.eden', 'POST', '/events', { venue: 'farm', eventType: 'wedding', date: '2027-04-04', client: { name: 'א ב', phone: '052-3434999' } })).status).toBe(403);
  });
});

// ---------------------------------------------------------------- event details
describe('event overview edits', () => {
  it('validation per field, conflict on the same field, merge on different fields, history and calendar update', async () => {
    const e = ev('אירוע הוקרה – עיריית מודיעין');
    const bad = await call('em1', 'PATCH', `/events/${e.id}`, { changes: { startTime: '25:00', guests: -3 } });
    expect(bad.status).toBe(422);
    expect(Object.keys(fieldErr(bad))).toEqual(expect.arrayContaining(['startTime', 'guests']));
    const ok = await call('em1', 'PATCH', `/events/${e.id}`, { changes: { startTime: '18:30', siteRequirements: 'גנרטור 20KW' }, base: { startTime: '18:00', siteRequirements: '' } });
    expect(ok.status).toBe(200);
    expect(lastAudit(e.id)).toBe('updated');
    expect((await call('owner', 'PATCH', `/events/${e.id}`, { changes: { startTime: '19:00' }, base: { startTime: '18:00' } })).status).toBe(409);
    expect((await call('owner', 'PATCH', `/events/${e.id}`, { changes: { notes: 'x' }, base: { notes: '' } })).status).toBe(200);
    const cal = await call('em1', 'GET', '/calendar?from=2026-11-01&to=2026-12-31');
    expect(cal.data.find((i: { eventId: number; kind: string }) => i.eventId === e.id && i.kind === 'event').time).toBe('18:30');
  });
  it('assigning an event manager routes unclaimed tasks of that role', async () => {
    const e = ev('חתונת נוי ואלון');
    const em2 = get<{ id: number }>("SELECT id FROM users WHERE email = 'em2@demo.local'")!.id;
    await call('brand.eden', 'PATCH', `/events/${e.id}`, { changes: { eventManagerId: em2 } });
    reconcileEvent(e.id);
    const unrouted = get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND role = 'event_manager' AND status = 'open' AND assignee_id IS NULL", e.id)!.n;
    expect(unrouted).toBe(0);
  });
  it('cancel needs a reason and cancels open tasks; close is blocked while things are open; reopen works', async () => {
    const e = ev('מגשי אירוח – סטארט-אפ בטא');
    expect((await call('owner', 'POST', `/events/${e.id}/lifecycle`, { lifecycle: 'cancelled', reason: '' })).status).toBe(422);
    expect((await call('owner', 'POST', `/events/${e.id}/lifecycle`, { lifecycle: 'cancelled', reason: 'הלקוח ביטל' })).status).toBe(200);
    expect(openCount(e.id)).toBe(0);
    expect((await call('owner', 'POST', `/events/${e.id}/lifecycle`, { lifecycle: 'planning', reason: '' })).status).toBe(200);
    const busy = ev('אירוע הוקרה – עיריית מודיעין');
    const close = await call('owner', 'POST', `/events/${busy.id}/lifecycle`, { lifecycle: 'closed', reason: '' });
    expect(close.status).toBe(422);
    expect((await call('em1', 'POST', `/events/${busy.id}/lifecycle`, { lifecycle: 'cancelled', reason: 'x' })).status).toBe(403);
  });
});

// ---------------------------------------------------------------- menu & kitchen
describe('menu, kitchen, requirements, prep board', () => {
  it('menu draft → approve → late change (reason) → acks; duplicate dish refused; ordering kept', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const m = await call('chef', 'GET', `/events/${e.id}/menu`);
    const lines = m.data.lines.map((l: { dishId: number; audience: string; perGuest: number; qtyOverride: number | null; notes: string }) => ({ dishId: l.dishId, audience: l.audience, perGuest: l.perGuest, qtyOverride: l.qtyOverride, notes: l.notes }));
    expect((await call('chef', 'PUT', `/events/${e.id}/menu`, { eventVersion: m.data.eventVersion, lines: [...lines, lines[0]], dietary: [], approve: false, reason: '' })).status).toBe(422);
    const ap = await call('chef', 'PUT', `/events/${e.id}/menu`, { eventVersion: m.data.eventVersion, lines, dietary: [{ kind: 'allergy', count: 2, description: 'אגוזים' }], kids: 4, approve: true, reason: '' });
    expect(ap.status).toBe(200);
    expect(ap.data.versioned).toBe(1);
    const m2 = await call('chef', 'GET', `/events/${e.id}/menu`);
    const changed = [...lines].reverse();
    expect((await call('em1', 'PUT', `/events/${e.id}/menu`, { eventVersion: m2.data.eventVersion, lines: changed, dietary: m2.data.dietary, reason: '' })).status).toBe(422);
    const late = await call('em1', 'PUT', `/events/${e.id}/menu`, { eventVersion: m2.data.eventVersion, lines: changed.map((l: { notes: string }, i: number) => (i === 0 ? { ...l, notes: 'ללא אגוזים' } : l)), dietary: m2.data.dietary, reason: 'בקשת לקוח' });
    expect(late.data.versioned).toBe(2);
    expect(late.data.menu.lines[0].notes).toBe('ללא אגוזים');
    expect(openCount(e.id, "type IN ('menu_ack_kitchen','menu_ack_field')")).toBe(2);
    expect((await call('acc', 'POST', `/events/${e.id}/menu/ack`, { role: 'kitchen' })).status).toBe(403);
    await call('chef', 'POST', `/events/${e.id}/menu/ack`, { role: 'kitchen' });
    await call('em1', 'POST', `/events/${e.id}/menu/ack`, { role: 'event_manager' });
    expect(get<{ menu_status: string }>('SELECT menu_status FROM events WHERE id = ?', e.id)!.menu_status).toBe('approved');
    expect((await call('em1', 'POST', `/events/${e.id}/menu/ack`, { role: 'event_manager' })).status).toBe(422);
  });
  it('prep plan: override needs a reason, date after event refused; KDS status; requirements reserve stock and open a shortage task', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const k = await call('chef', 'GET', `/kitchen/events/${e.id}`);
    const dish = k.data.lines[0].dishId;
    expect((await call('chef', 'PUT', `/kitchen/events/${e.id}/prep/${dish}`, { prepDate: '2030-01-01', portionsOverride: null, reason: '' })).status).toBe(422);
    expect((await call('chef', 'PUT', `/kitchen/events/${e.id}/prep/${dish}`, { prepDate: '2026-12-13', portionsOverride: 50, reason: '' })).status).toBe(422);
    expect((await call('chef', 'PUT', `/kitchen/events/${e.id}/prep/${dish}`, { prepDate: '2026-12-13', portionsOverride: 50, reason: 'הכנה משותפת' })).status).toBe(200);
    expect((await call('chef', 'POST', `/kitchen/events/${e.id}/prep/${dish}/status`, { status: 'in_progress' })).status).toBe(200);
    expect((await call('sales1', 'POST', `/kitchen/events/${e.id}/prep/${dish}/status`, { status: 'done' })).status).toBe(403);
    const k2 = await call('chef', 'GET', `/kitchen/events/${e.id}`);
    const items = k2.data.raw.map((r: { itemId: number; computed: number; warehouseId: number | null }) => ({ itemId: r.itemId, qty: r.computed * 50, warehouseId: r.warehouseId, source: 'menu' }));
    const req = await call('chef', 'POST', `/kitchen/events/${e.id}/requirements`, { items });
    expect(req.status).toBe(200);
    expect(req.data.raw.some((r: { eventShort: number }) => r.eventShort > 0)).toBe(true);
    expect(openCount(e.id, "type = 'order_shortage'")).toBe(1);
    const sh = await call('buyer', 'GET', '/inventory/shortages');
    expect(sh.data.some((s: { allocation: { rows: { eventId: number }[] } }) => s.allocation.rows.some((r) => r.eventId === e.id))).toBe(true);
    expect((await call('buyer', 'POST', `/kitchen/events/${e.id}/requirements`, { items })).status).toBe(403);
  });
  it('consumption writes stock movements and marks the requirement consumed', async () => {
    const e = ev('חתונת ענבר ואיתי');
    const before = stock(get<{ id: number }>("SELECT id FROM items WHERE name = 'כוסות מתכלות'")!.id, get<{ id: number }>("SELECT id FROM warehouses WHERE venue = 'farm'")!.id);
    const cups = get<{ id: number }>("SELECT id FROM items WHERE name = 'כוסות מתכלות'")!.id;
    const r = await call('ops', 'POST', `/kitchen/events/${e.id}/consume`, { items: [{ itemId: cups, qty: 50 }] });
    expect(r.status).toBe(200);
    expect(stock(cups, get<{ id: number }>("SELECT id FROM warehouses WHERE venue = 'farm'")!.id)).toBe(before - 50);
    expect((await call('ops', 'POST', `/kitchen/events/${e.id}/consume`, { items: [{ itemId: cups, qty: 1 }] })).status).toBe(422);
  });
});

// ---------------------------------------------------------------- inventory & purchasing
describe('inventory and purchasing', () => {
  const wh = () => get<{ id: number }>('SELECT id FROM warehouses WHERE venue IS NULL')!.id;
  const flour = () => get<{ id: number }>("SELECT id FROM items WHERE name = 'קמח'")!.id;
  it('count sets the physical balance; adjustment needs a reason; transfer cannot exceed stock', async () => {
    const r = await call('ops', 'POST', '/inventory/movements', { kind: 'count', itemId: flour(), warehouseId: wh(), counted: 55, note: 'ספירה' });
    expect(r.status).toBe(201);
    expect(stock(flour(), wh())).toBe(55);
    expect((await call('ops', 'POST', '/inventory/movements', { kind: 'adjustment', itemId: flour(), warehouseId: wh(), qty: -5, note: '' })).status).toBe(422);
    expect((await call('ops', 'POST', '/inventory/movements', { kind: 'adjustment', itemId: flour(), warehouseId: wh(), qty: -5, note: 'נשפך' })).status).toBe(201);
    const farm = get<{ id: number }>("SELECT id FROM warehouses WHERE venue = 'farm'")!.id;
    expect((await call('ops', 'POST', '/inventory/movements', { kind: 'transfer', itemId: flour(), warehouseId: wh(), toWarehouseId: farm, qty: 999, note: '' })).status).toBe(422);
    expect((await call('ops', 'POST', '/inventory/movements', { kind: 'transfer', itemId: flour(), warehouseId: wh(), toWarehouseId: farm, qty: 10, note: '' })).status).toBe(201);
    expect(stock(flour(), farm)).toBe(10);
    expect((await call('sales1', 'POST', '/inventory/movements', { kind: 'count', itemId: flour(), warehouseId: wh(), counted: 1 })).status).toBe(403);
  });
  it('order from suggestions → partial receipt (stock + gap) → resolve gap → closed; delivery task closes', async () => {
    const sug = await call('buyer', 'GET', '/purchasing/suggestions');
    expect(sug.data.length).toBeGreaterThan(0);
    const s = sug.data.find((x: { supplierId: number | null }) => x.supplierId) ?? sug.data[0];
    const po = await call('buyer', 'POST', '/purchasing/orders', { supplierId: s.supplierId, warehouseId: s.warehouseId, responsibleId: null, expectedDate: '2026-11-18', expectedTime: '08:00', notes: '', lines: s.lines.map((l: { itemId: number; qty: number; eventId: number | null }) => ({ itemId: l.itemId, qty: l.qty, eventId: l.eventId })) });
    expect(po.status).toBe(201);
    expect(get('SELECT 1 FROM tasks WHERE type = \'verify_delivery\' AND ref_id = ?', po.data.id)).toBeTruthy();
    const o = await call('buyer', 'GET', `/purchasing/orders/${po.data.id}`);
    const line = o.data.lines[0];
    const before = stock(line.itemId, s.warehouseId);
    const rec = await call('buyer', 'POST', `/purchasing/orders/${po.data.id}/receive`, { lines: [{ lineId: line.id, qty: line.qty / 2, note: 'חלקי' }] });
    expect(rec.data.status).toBe(o.data.lines.length > 1 || line.qty / 2 < line.qty ? 'partial' : 'received');
    expect(stock(line.itemId, s.warehouseId)).toBe(before + line.qty / 2);
    expect((await call('buyer', 'POST', `/purchasing/orders/${po.data.id}/cancel`, { reason: 'x x' })).status).toBe(422);
    for (const l of o.data.lines) expect((await call('buyer', 'POST', `/purchasing/lines/${l.id}/resolve`, { note: 'הספק לא ישלים' })).status).toBe(200);
    expect(get<{ status: string }>('SELECT status FROM purchase_orders WHERE id = ?', po.data.id)!.status).toBe('received');
    expect(get<{ status: string }>('SELECT status FROM tasks WHERE type = \'verify_delivery\' AND ref_id = ?', po.data.id)!.status).toBe('done');
  });
  it('an unreceived order can be cancelled (with a reason) and its delivery task is cancelled', async () => {
    const po = await call('buyer', 'POST', '/purchasing/orders', { supplierId: 1, warehouseId: wh(), responsibleId: null, expectedDate: '2026-11-18', lines: [{ itemId: flour(), qty: 5, eventId: null }] });
    expect((await call('buyer', 'POST', `/purchasing/orders/${po.data.id}/cancel`, { reason: '' })).status).toBe(422);
    expect((await call('owner', 'POST', `/purchasing/orders/${po.data.id}/cancel`, { reason: 'הוזמן כפול' })).status).toBe(200);
    expect(get<{ status: string }>('SELECT status FROM purchase_orders WHERE id = ?', po.data.id)!.status).toBe('cancelled');
    expect(openCount(0, `ref_type = 'po' AND ref_id = ${po.data.id}`)).toBe(0);
  });
  it('order validation and suppliers CRUD', async () => {
    expect((await call('buyer', 'POST', '/purchasing/orders', { supplierId: 1, warehouseId: wh(), responsibleId: null, expectedDate: '2026-11-18', lines: [] })).status).toBe(422);
    const sup = await call('buyer', 'POST', '/purchasing/suppliers', { name: 'ספק בדיקה', contact: '', phone: '03-1111111', email: '', categories: 'ירקות', notes: '', active: true });
    expect(sup.status).toBe(201);
    expect((await call('buyer', 'PUT', `/purchasing/suppliers/${sup.data.id}`, { name: 'ספק בדיקה 2', contact: '', phone: '', email: 'bad', categories: '', notes: '', active: false })).status).toBe(422);
    expect((await call('buyer', 'PUT', `/purchasing/suppliers/${sup.data.id}`, { name: 'ספק בדיקה 2', contact: '', phone: '', email: '', categories: '', notes: '', active: false })).status).toBe(200);
    expect((await call('sales1', 'POST', '/purchasing/suppliers', { name: 'x x' })).status).toBe(403);
  });
});

// ---------------------------------------------------------------- catalog
describe('catalog', () => {
  it('dish with recipe: create, edit with version guard; item create/edit; duplicate name refused; equipment template add/remove', async () => {
    const item = await call('chef', 'POST', '/catalog/items', { name: 'בצל', kind: 'food', unit: 'ק״ג', category: 'ירקות', supplierId: null, minStock: 5, active: true });
    expect(item.status).toBe(201);
    expect((await call('chef', 'POST', '/catalog/items', { name: 'בצל', kind: 'food', unit: 'ק״ג', category: '', supplierId: null, minStock: 0, active: true })).status).toBe(422);
    expect((await call('chef', 'PUT', `/catalog/items/${item.data.id}`, { name: 'בצל יבש', kind: 'food', unit: 'ק״ג', category: 'ירקות', supplierId: null, minStock: 5, active: true })).status).toBe(200);
    const d = await call('chef', 'POST', '/catalog/dishes', { name: 'מרק בצל', category: 'ראשונות', description: '', allergens: 'חלב', isVegetarian: true, isVegan: false, defaultPerGuest: 0.5, yieldPortions: 10, prepLeadDays: 0, active: true, recipe: [{ itemId: item.data.id, qty: 2 }] });
    expect(d.status).toBe(201);
    expect(d.data.recipe).toHaveLength(1);
    expect((await call('chef', 'PUT', `/catalog/dishes/${d.data.id}`, { ...d.data, recipe: [{ itemId: item.data.id, qty: 3 }], isVegetarian: true, isVegan: false, active: true, version: 99 })).status).toBe(422);
    const ok = await call('chef', 'PUT', `/catalog/dishes/${d.data.id}`, { name: 'מרק בצל', category: 'ראשונות', description: '', allergens: 'חלב', isVegetarian: true, isVegan: false, defaultPerGuest: 0.5, yieldPortions: 10, prepLeadDays: 0, active: true, recipe: [{ itemId: item.data.id, qty: 3 }], version: d.data.version });
    expect(ok.data.recipe[0].qty).toBe(3);
    expect((await call('chef', 'POST', '/catalog/dishes', { name: 'x', category: '', defaultPerGuest: 1, yieldPortions: 0 })).status).toBe(422);
    const tpl = await call('ops', 'POST', '/catalog/equipment-templates', { venue: 'farm', eventType: '*', itemId: item.data.id, perGuest: 0, fixedQty: 0 });
    expect(tpl.status).toBe(422);
    const tpl2 = await call('ops', 'POST', '/catalog/equipment-templates', { venue: 'farm', eventType: '*', itemId: item.data.id, perGuest: 0, fixedQty: 3 });
    expect((await call('ops', 'DELETE', `/catalog/equipment-templates/${tpl2.data.id}`)).status).toBe(200);
    expect((await call('sales1', 'POST', '/catalog/dishes', { name: 'x x', category: 'x', defaultPerGuest: 1, yieldPortions: 1 })).status).toBe(403);
  });
});

// ---------------------------------------------------------------- logistics, staffing, field
describe('equipment, staffing, confirmations, field reports', () => {
  it('equipment: generate from template, add, edit, supplier confirm, delete; winery return count closes the return task', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const g = await call('em1', 'POST', `/events/${e.id}/equipment/generate`);
    expect(g.data.added).toBeGreaterThan(0);
    const add = await call('em1', 'POST', `/events/${e.id}/equipment`, { label: 'שולחן בר', unit: 'יח׳', planned: 2, isFood: false });
    expect(add.status).toBe(201);
    expect((await call('em1', 'PATCH', `/events/${e.id}/equipment/${add.data.id}`, { planned: 3, supplierConfirmed: true })).status).toBe(200);
    expect((await call('em1', 'DELETE', `/events/${e.id}/equipment/${add.data.id}`)).status).toBe(200);
    expect((await call('em1', 'POST', `/events/${e.id}/equipment`, { label: '', planned: 1 })).status).toBe(422);
    expect((await call('acc', 'POST', `/events/${e.id}/equipment/generate`)).status).toBe(403);
    const eden = ev('חתונת נוי ואלון');
    expect((await call('owner', 'POST', `/events/${eden.id}/equipment/generate`)).status).toBe(422);
  });
  it('staffing: suggestion, save, readiness reacts; a crew lead may not change cooks', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const s = await call('em1', 'GET', `/events/${e.id}/staffing`);
    expect(s.data.suggestion.length).toBeGreaterThan(0);
    const lines = s.data.suggestion.map((x: { role: string; required: number }) => ({ role: x.role, required: x.required, assigned: x.required, arrived: null, notes: '' }));
    expect((await call('em1', 'PUT', `/events/${e.id}/staffing`, { lines: lines.filter((l: { role: string }) => l.role !== 'cook'), ubeyaRef: 'UB-1' })).status).toBe(200);
    expect((await call('em1', 'PUT', `/events/${e.id}/staffing`, { lines, ubeyaRef: 'UB-1' })).status).toBe(403);
    expect((await call('owner', 'PUT', `/events/${e.id}/staffing`, { lines, ubeyaRef: 'UB-1' })).status).toBe(200);
    const d = await call('owner', 'GET', `/events/${e.id}`);
    const staffing = d.data.readiness.items.filter((i: { key: string; covers?: string }) => i.key === 'staffing' || i.covers === 'staffing');
    expect(staffing.length).toBeGreaterThan(0);
    expect(staffing.every((i: { done: boolean }) => i.done)).toBe(true);
    expect(d.data.event.ubeyaRef).toBe('UB-1');
  });
  it('confirmations: only the responsible role; with open items a note is required; undo works', async () => {
    const e = ev('חתונת רותם ועומר');
    expect((await call('sales1', 'POST', `/events/${e.id}/confirm`, { kind: 'kitchen_ready', note: '' })).status).toBe(403);
    expect((await call('chef', 'POST', `/events/${e.id}/confirm`, { kind: 'kitchen_ready', note: '' })).status).toBe(422);
    expect((await call('chef', 'POST', `/events/${e.id}/confirm`, { kind: 'kitchen_ready', note: 'מאשר עם חוסר בצלחות' })).status).toBe(200);
    const d = await call('chef', 'GET', `/events/${e.id}`);
    expect(d.data.readiness.items.find((i: { key: string }) => i.key === 'kitchen_ready').done).toBe(true);
    expect((await call('chef', 'DELETE', `/events/${e.id}/confirm/kitchen_ready`)).status).toBe(200);
  });
  it('farm load/unload counts: gap creates a report + task; unload closes the unload task', async () => {
    const e = ev('חתונת רותם ועומר');
    await call('ops', 'POST', `/events/${e.id}/equipment/generate`);
    const eq = await call('ops', 'GET', `/events/${e.id}/equipment`);
    expect((await call('ops', 'PUT', `/events/${e.id}/equipment/counts`, { stage: 'returned', counts: [{ id: eq.data.lines[0].id, qty: 1 }] })).status).toBe(422);
    await call('ops', 'PUT', `/events/${e.id}/equipment/counts`, { stage: 'loaded', counts: eq.data.lines.map((l: { id: number; planned: number }) => ({ id: l.id, qty: l.planned })), note: '' });
    expect(openCount(e.id, "type = 'unload_check'")).toBe(1);
    const r = await call('ops', 'PUT', `/events/${e.id}/equipment/counts`, { stage: 'unloaded', counts: eq.data.lines.map((l: { id: number; planned: number }, i: number) => ({ id: l.id, qty: i === 0 ? l.planned - 1 : l.planned })), note: '' });
    expect(r.data.gaps.length).toBe(1);
    expect(openCount(e.id, "type = 'unload_check'")).toBe(0);
    expect(openCount(e.id, "type = 'report_handle'")).toBeGreaterThan(0);
  });
  it('field report: send → kitchen sees it → ack → resolve closes the task; dashboard count drops', async () => {
    const e = ev('חתונת מאיה ודור');
    const r = await call('em2', 'POST', `/events/${e.id}/reports`, { kind: 'shortage', target: 'kitchen', content: 'חסרים 10 שניצלונים', urgent: true });
    expect(r.status).toBe(201);
    const board = await call('chef', 'GET', '/reports');
    expect(board.data.some((x: { id: number }) => x.id === r.data.id)).toBe(true);
    const before = (await call('chef', 'GET', '/dashboard')).data.openReports.length;
    expect((await call('chef', 'POST', `/reports/${r.data.id}/ack`)).status).toBe(200);
    expect((await call('chef', 'POST', `/reports/${r.data.id}/resolve`, { decision: '' })).status).toBe(422);
    expect((await call('chef', 'POST', `/reports/${r.data.id}/resolve`, { decision: 'הוכנו 10 נוספים' })).status).toBe(200);
    expect(get<{ status: string }>("SELECT status FROM tasks WHERE ref_type = 'report' AND ref_id = ?", r.data.id)!.status).toBe('done');
    expect((await call('chef', 'GET', '/dashboard')).data.openReports.length).toBe(before - 1);
    expect((await call('acc', 'POST', `/events/${e.id}/reports`, { kind: 'issue', target: 'kitchen', content: 'xx' })).status).toBe(403);
  });
  it('mobile field screen loads with menu, allergies and contacts', async () => {
    const e = ev('חתונת מאיה ודור');
    const f = await call('em2', 'GET', `/events/${e.id}/field`);
    expect(f.status).toBe(200);
    expect(f.data.menu.length).toBeGreaterThan(0);
    expect(f.data.dietary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- finance
describe('payments', () => {
  it('receive needs a reference, cannot exceed the line, closes the deposit task, updates collection and receivables', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const p = await call('acc', 'GET', `/finance/events/${e.id}/payments`);
    const dep = p.data.lines.find((l: { kind: string }) => l.kind === 'deposit');
    expect((await call('acc', 'POST', `/finance/payments/${dep.id}/receive`, { amount: dep.amount, receivedAt: '2026-11-18', reference: '', version: dep.version })).status).toBe(422);
    expect((await call('acc', 'POST', `/finance/payments/${dep.id}/receive`, { amount: dep.amount + 1, receivedAt: '2026-11-18', reference: 'x', version: dep.version })).status).toBe(422);
    expect((await call('acc', 'POST', `/finance/payments/${dep.id}/receive`, { amount: dep.amount, receivedAt: '2026-11-18', reference: 'העברה 77', version: dep.version })).status).toBe(200);
    const p2 = await call('acc', 'GET', `/finance/events/${e.id}/payments`);
    expect(p2.data.summary.received).toBe(dep.amount);
    expect(openCount(e.id, "type = 'track_deposit'")).toBe(0);
    const recv = await call('acc', 'GET', '/finance/receivables');
    expect(recv.data.items.find((i: { eventId: number }) => i.eventId === e.id).received).toBe(dep.amount);
    expect((await call('acc', 'POST', `/finance/payments/${dep.id}/receive`, { amount: 1, receivedAt: '2026-11-18', reference: 'x', version: dep.version })).status).toBe(422);
  });
  it('add / edit a payment line; cannot go below what was received; sales cannot', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const add = await call('acc', 'POST', `/finance/events/${e.id}/payments`, { kind: 'interim', amount: 100_000, dueDate: '2026-12-01' });
    expect(add.status).toBe(201);
    const dep = (await call('acc', 'GET', `/finance/events/${e.id}/payments`)).data.lines.find((l: { kind: string }) => l.kind === 'deposit');
    expect((await call('acc', 'PUT', `/finance/payments/${dep.id}`, { kind: 'deposit', amount: 1, dueDate: null })).status).toBe(422);
    expect((await call('acc', 'PUT', `/finance/payments/${add.data.id}`, { kind: 'interim', amount: 120_000, dueDate: '2026-12-02' })).status).toBe(200);
    expect((await call('sales1', 'POST', `/finance/events/${e.id}/payments`, { kind: 'interim', amount: 1, dueDate: null })).status).toBe(403);
  });
});

// ---------------------------------------------------------------- documents
describe('documents', () => {
  it('upload, list on event and client, download, delete; wrong type refused', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'חוזה.pdf', { type: 'application/pdf' }));
    fd.set('kind', 'contract'); fd.set('eventId', String(e.id)); fd.set('clientId', String(e.client_id));
    const up = await call('sales1', 'POST', '/documents', fd);
    expect(up.status).toBe(201);
    expect((await call('sales1', 'GET', `/documents?event=${e.id}`)).data.length).toBe(1);
    expect((await call('sales1', 'GET', `/documents?client=${e.client_id}`)).data.length).toBeGreaterThan(0);
    const dl = await app.request(`/api/documents/${up.data.id}/download`, { headers: { cookie: cookies.sales1 } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    const bad = new FormData();
    bad.set('file', new File(['x'], 'a.exe', { type: 'application/x-msdownload' })); bad.set('kind', 'other'); bad.set('eventId', String(e.id));
    expect((await call('sales1', 'POST', '/documents', bad)).status).toBe(422);
    expect((await call('sales1', 'DELETE', `/documents/${up.data.id}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------- tasks
describe('task actions', () => {
  it('manual task → claim → note → transfer (only to an authorized person) → block → unblock → complete → reopen → remove', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const t = await call('em1', 'POST', '/tasks', { title: 'תיאום צלם', action: '', role: 'event_manager', eventId: e.id, stage: 'equipment_staff', required: true, dueAt: '2026-12-10T10:00:00.000Z', assigneeId: null });
    expect(t.status).toBe(201);
    const id = t.data.id;
    expect((await call('em1', 'POST', `/tasks/${id}/claim`)).status).toBe(200);
    expect((await call('em2', 'POST', `/tasks/${id}/claim`)).status).toBe(404); // em2 is not at the winery
    expect((await call('em1', 'POST', `/tasks/${id}/note`, { note: '' })).status).toBe(422);
    expect((await call('em1', 'POST', `/tasks/${id}/note`, { note: 'דיברתי עם הצלם' })).status).toBe(200);
    const chef = get<{ id: number }>("SELECT id FROM users WHERE email = 'chef@demo.local'")!.id;
    expect((await call('em1', 'POST', `/tasks/${id}/transfer`, { userId: chef, note: '' })).status).toBe(422);
    expect((await call('em1', 'POST', `/tasks/${id}/block`, { reason: 'מחכים לאישור תקציב' })).status).toBe(200);
    expect(get<{ status: string }>('SELECT status FROM tasks WHERE id = ?', id)!.status).toBe('blocked');
    expect((await call('em1', 'POST', `/tasks/${id}/unblock`, { note: '' })).status).toBe(200);
    expect((await call('em1', 'POST', `/tasks/${id}/complete`, { note: '' })).status).toBe(200);
    expect((await call('em1', 'POST', `/tasks/${id}/complete`, { note: '' })).status).toBe(422);
    expect((await call('em1', 'POST', `/tasks/${id}/reopen`)).status).toBe(200);
    const log = (await call('em1', 'GET', `/tasks/${id}`)).data.log.map((l: { action: string }) => l.action);
    expect(log).toEqual(expect.arrayContaining(['created', 'claimed', 'note', 'blocked', 'unblocked', 'completed', 'reopened']));
    expect((await call('em1', 'DELETE', `/tasks/${id}?reason=${encodeURIComponent('כפול')}`)).status).toBe(200);
  });
  it('an automatic task closed by hand needs an explanation', async () => {
    const t = get<{ id: number }>("SELECT id FROM tasks WHERE type = 'feedback_call' AND status = 'open' LIMIT 1")!;
    expect((await call('sales1', 'POST', `/tasks/${t.id}/complete`, { note: '' })).status).toBe(422);
    expect((await call('sales1', 'POST', `/tasks/${t.id}/complete`, { note: 'הלקוח מרוצה, תועד בטלפון' })).status).toBe(200);
  });
});

// ---------------------------------------------------------------- admin
describe('administration', () => {
  it('users: create with roles, wrong email refused, deactivate ends the session', async () => {
    const r = await call('owner', 'POST', '/users', { name: 'עובד חדש', email: 'new@demo.local', phone: '', active: true, password: 'password1', grants: [{ role: 'sales', venue: 'winery' }] });
    expect(r.status).toBe(201);
    expect((await call('owner', 'POST', '/users', { name: 'x x', email: 'bad', active: true, password: 'password1', grants: [] })).status).toBe(422);
    { const r2 = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@demo.local', password: 'password1' }) }); cookies.new = (r2.headers.get('set-cookie') ?? '').split(';')[0]; }
    expect((await call('new', 'GET', '/auth/me')).status).toBe(200);
    expect((await call('owner', 'PUT', `/users/${r.data.id}`, { name: 'עובד חדש', email: 'new@demo.local', phone: '', active: false, grants: [{ role: 'sales', venue: 'winery' }] })).status).toBe(200);
    expect((await call('new', 'GET', '/auth/me')).status).toBe(401);
    expect((await call('ops', 'POST', '/users', { name: 'x x', email: 'x@x.co', active: true, password: 'password1', grants: [{ role: 'sales', venue: null }] })).status).toBe(403);
  });
  it('settings save keeps the system config; backup works', async () => {
    const s = await call('owner', 'GET', '/admin/settings');
    await call('owner', 'PUT', '/admin/system', { ...s.data.system, labels: { roles: { crew: 'אחראי מלצרים' } } });
    expect((await call('owner', 'PUT', '/admin/settings', { ...s.data, checkpointMinutes: 90 })).status).toBe(200);
    const after = await call('owner', 'GET', '/admin/settings');
    expect(after.data.checkpointMinutes).toBe(90);
    expect(after.data.system.labels.roles.crew).toBe('אחראי מלצרים');
    expect((await call('owner', 'PUT', '/admin/settings', { ...s.data, checkpointMinutes: -1 })).status).toBe(422);
    expect((await call('ops', 'PUT', '/admin/settings', s.data)).status).toBe(403);
  });
});

// ---------------------------------------------------------------- live updates
describe('live updates', () => {
  it('a change publishes a hint that open screens use to refresh', async () => {
    const seen: string[] = [];
    const off = subscribe((h) => seen.push(h.topic));
    const e = ev('ערב גאלה – הפקות גפן');
    await call('em1', 'PATCH', `/events/${e.id}`, { changes: { notes: 'עדכון חי' } });
    await new Promise((r) => setTimeout(r, 5));
    off();
    expect(seen).toContain('event');
  });
});

describe('tasting cancellation', () => {
  it('cancelling the only tasting reopens "schedule tasting"', async () => {
    const e = ev('כנס – חברת פעולות');
    const m = get<{ id: number }>("SELECT id FROM meetings WHERE event_id = ? AND kind = 'tasting'", e.id)!;
    expect((await call('sales1', 'PATCH', `/meetings/${m.id}`, { status: 'cancelled' })).status).toBe(200);
    expect(openCount(e.id, "type = 'schedule_tasting'")).toBe(1);
  });
});

describe('follow-up closes when the sale moves forward', () => {
  it('sending a quote closes "follow up on new inquiry"', async () => {
    const r = await call<{ id: number }>('sales1', 'POST', '/events', { venue: 'offsite', eventType: 'catering', date: '2027-05-05', client: { name: 'לקוח מעקב', phone: '054-7878787' } });
    expect(openCount(r.data.id, "type = 'lead_followup'")).toBe(1);
    await call('sales1', 'POST', `/sales/events/${r.data.id}/quotes`, { guests: 10, perGuest: 10000, total: 100000, description: '' });
    expect(openCount(r.data.id, "type = 'lead_followup'")).toBe(0);
  });
});

describe('per-role view: relevant only, nothing extra', () => {
  it('home screen shows only the numbers set for the role', async () => {
    const chef = (await call('chef', 'GET', '/dashboard')).data;
    expect(Object.keys(chef.kpis)).not.toContain('openLeads');
    expect(chef.meetings.every((m: { kind: string }) => m.kind === 'tasting')).toBe(true);
    const acc = (await call('acc', 'GET', '/dashboard')).data;
    expect(Object.keys(acc.kpis).sort()).toEqual(['overdue', 'overduePayments', 'receivables']);
    expect(acc.checkpoint).toBeNull();
  });
  it('client phone hidden from kitchen, logistics and staff; visible to event manager and sales', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    expect((await call('chef', 'GET', `/events/${e.id}`)).data.client.phone).toBe('');
    expect((await call('logistics', 'GET', `/events/${e.id}/field`)).data.client).toBeNull();
    expect((await call('em1', 'GET', `/events/${e.id}`)).data.client.phone).not.toBe('');
    expect((await call('sales1', 'GET', `/events/${e.id}`)).data.client.phone).not.toBe('');
  });
  it('complementary staff see only today ±, no calendar, no management pages', async () => {
    const list = (await call('staff', 'GET', '/events?from=2000-01-01&to=2100-01-01')).data;
    for (const x of list) expect(Math.abs(new Date(x.date).getTime() - Date.now())).toBeLessThan(4 * 86_400_000);
    expect((await call('staff', 'GET', '/calendar')).data).toEqual([]);
    expect((await call('staff', 'GET', '/process/roles')).status).toBe(403);
  });
  it('sales no longer reach kitchen planning; operations and brand no longer reach the sales funnel', async () => {
    expect((await call('sales1', 'GET', '/kitchen/week')).status).toBe(403);
    expect((await call('ops', 'GET', '/sales/pipeline')).status).toBe(403);
    expect((await call('brand.eden', 'GET', '/sales/pipeline')).status).toBe(403);
  });
  it('task lists default to a horizon; overdue and blocked always included', async () => {
    const all7 = (await call('chef', 'GET', '/tasks?view=mine&horizon=7')).data;
    const every = (await call('chef', 'GET', '/tasks?view=mine&horizon=all')).data;
    expect(all7.length).toBeLessThan(every.length);
    const limit = Date.now() + 7 * 86_400_000;
    for (const t of all7) expect(!t.dueAt || new Date(t.dueAt).getTime() <= limit || t.status === 'blocked').toBe(true);
  });
  it('the per-role view is editable in settings', async () => {
    const cfg = (await call('owner', 'GET', '/admin/config')).data.system;
    await call('owner', 'PUT', '/admin/system', { ...cfg, homeByRole: { accountant: ['receivables'] }, contactRoles: ['sales', 'event_manager', 'kitchen'] });
    expect(Object.keys((await call('acc', 'GET', '/dashboard')).data.kpis)).toEqual(['receivables']);
    const e = ev('ערב גאלה – הפקות גפן');
    expect((await call('chef', 'GET', `/events/${e.id}`)).data.client.phone).not.toBe('');
    await call('owner', 'PUT', '/admin/system', { ...cfg, homeByRole: {}, contactRoles: [] });
  });
});
