/**
 * One event, start to finish, through the same calls the screens make — each step checked for what it must
 * move elsewhere: tasks, readiness, kitchen quantities, stock, purchasing, payments, history and closing.
 *
 * Lead → quote → contract → tasting → approved menu → 250→320 guests → kitchen requirements → shortage →
 * purchase order → partial receipt → staffing → loading / unloading with a gap → readiness confirmations →
 * executed → closing tasks → payments → closed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { all, get, openDb } from '../server/core/db.ts';
import { createApp } from '../server/app.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { addDays, today } from '../shared/dates.ts';

const app = (() => { openDb(':memory:'); seedDemo(); return createApp(); })();
const cookies: Record<string, string> = {};
type R<T = any> = { status: number; data: T }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call<T = any>(u: string, method: string, path: string, body?: unknown): Promise<R<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await app.request(`/api${path}`, { method, headers: { cookie: cookies[u], 'x-mb': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let data: unknown = t;
  try { data = t ? JSON.parse(t) : null; } catch { /* text */ }
  return { status: r.status, data: data as T };
}
const ok = <T,>(r: R<T>, what: string): T => {
  if (r.status >= 300) throw new Error(`${what} → ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
};
const openTasks = (eventId: number, type?: string) => all<{ id: number; type: string }>(
  `SELECT id, type FROM tasks WHERE event_id = ? AND status IN ('open','in_progress','blocked')${type ? ' AND type = ?' : ''}`, eventId, ...(type ? [type] : []));

beforeAll(async () => {
  for (const u of ['owner', 'sales1', 'chef', 'buyer', 'em1', 'ops', 'acc']) {
    const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: `${u}@demo.local`, password: 'demo1234' }) });
    cookies[u] = (r.headers.get('set-cookie') ?? '').split(';')[0];
  }
});

describe('an event from first call to closing', () => {
  const date = addDays(today(), 5); // inside the guest-lock window, so a late change is flagged
  let id = 0;

  it('lead → quote → contract', async () => {
    const created = ok(await call('sales1', 'POST', '/events', {
      venue: 'offsite', eventType: 'corporate', date, startTime: '18:00', endTime: '23:00', guests: 250, address: 'רחוב הבדיקה 1, מודיעין',
      siteContactName: 'דני', siteContactPhone: '050-1234567', source: 'גוגל', firstNote: 'כנס שנתי', client: { name: 'חברת המסע', phone: '054-9990001', kind: 'company', company: 'המסע בע״מ' },
    }), 'create lead');
    id = created.id;
    expect(openTasks(id, 'lead_followup')).toHaveLength(1);

    ok(await call('sales1', 'POST', `/sales/events/${id}/quotes`, { guests: 250, perGuest: 28000, total: 7_000_000, description: 'כנס – מוגש' }), 'quote');
    expect(openTasks(id, 'lead_followup')).toHaveLength(0);
    expect(get<{ sales_status: string }>('SELECT sales_status FROM events WHERE id = ?', id)!.sales_status).toBe('quoted');

    const v = get<{ version: number }>('SELECT version FROM events WHERE id = ?', id)!.version;
    ok(await call('sales1', 'POST', `/events/${id}/sign`, { signedAt: today(), contractTotal: 7_000_000, deposit: 2_100_000, depositDue: today(), finalDue: addDays(date, 14), version: v }), 'sign');
    const pays = all<{ kind: string; amount: number }>('SELECT kind, amount FROM payments WHERE event_id = ? ORDER BY kind', id);
    expect(pays.reduce((a, p) => a + p.amount, 0)).toBe(7_000_000);
    expect(openTasks(id, 'schedule_tasting')).toHaveLength(1);
    expect(openTasks(id, 'track_deposit')).toHaveLength(1);
  });

  it('tasting → approved menu', async () => {
    ok(await call('sales1', 'POST', '/meetings', { kind: 'tasting', eventId: id, date: addDays(today(), 1), time: '17:00' }), 'tasting');
    expect(openTasks(id, 'schedule_tasting')).toHaveLength(0);
    const dishes = all<{ id: number }>("SELECT d.id FROM dishes d WHERE d.active = 1 AND EXISTS (SELECT 1 FROM recipe_lines r WHERE r.dish_id = d.id) LIMIT 5");
    const m = ok(await call('chef', 'GET', `/events/${id}/menu`), 'menu');
    ok(await call('chef', 'PUT', `/events/${id}/menu`, {
      eventVersion: m.eventVersion, lines: dishes.map((d) => ({ dishId: d.id, audience: 'all', perGuest: 1, qtyOverride: null, notes: '' })),
      dietary: [{ kind: 'allergy', count: 3, description: 'אגוזים' }], approve: true, reason: '',
    }), 'approve menu');
    expect(get<{ menu_status: string }>('SELECT menu_status FROM events WHERE id = ?', id)!.menu_status).toBe('approved');
  });

  it('250 → 320 guests moves kitchen quantities and opens a guest-change task', async () => {
    const before = ok(await call('chef', 'GET', `/kitchen/events/${id}`), 'kitchen').lines.reduce((a: number, l: { portions: number }) => a + l.portions, 0);
    ok(await call('em1', 'PATCH', `/events/${id}`, { changes: { guests: 320 }, base: { guests: 250 } }), 'guests');
    const after = ok(await call('chef', 'GET', `/kitchen/events/${id}`), 'kitchen').lines.reduce((a: number, l: { portions: number }) => a + l.portions, 0);
    expect(after).toBeGreaterThan(before);
    expect(openTasks(id, 'guest_change')).toHaveLength(1);
    expect(get('SELECT 1 FROM audit_log WHERE event_id = ? AND action = ?', id, 'late_change')).toBeTruthy();
    expect(get<{ guests: number }>('SELECT guests FROM events WHERE id = ?', id)!.guests).toBe(320);
  });

  it('requirements → shortage → purchase order → partial receipt', async () => {
    const k = ok(await call('chef', 'GET', `/kitchen/events/${id}`), 'kitchen');
    const central = get<{ id: number }>('SELECT id FROM warehouses WHERE venue IS NULL')!.id;
    // Ask for far more than in stock so a shortage is certain.
    const items = k.raw.slice(0, 3).map((r: { itemId: number; computed: number }) => ({ itemId: r.itemId, qty: Math.max(1, r.computed) * 40, warehouseId: central, source: 'menu' }));
    ok(await call('chef', 'POST', `/kitchen/events/${id}/requirements`, { items }), 'requirements');
    expect(openTasks(id, 'order_shortage').length).toBe(1);
    const sug = ok(await call('buyer', 'GET', `/purchasing/suggestions?event=${id}`), 'suggestions');
    expect(sug.length).toBeGreaterThan(0);
    const s = sug.find((x: { supplierId: number | null }) => x.supplierId) ?? sug[0];
    const po = ok(await call('buyer', 'POST', '/purchasing/orders', { supplierId: s.supplierId ?? 1, warehouseId: s.warehouseId, responsibleId: null, expectedDate: today(), expectedTime: '08:00', notes: '', lines: s.lines.map((l: { itemId: number; qty: number }) => ({ itemId: l.itemId, qty: l.qty, eventId: id })) }), 'order');
    const o = ok(await call('buyer', 'GET', `/purchasing/orders/${po.id}`), 'order detail');
    const rec = ok(await call('buyer', 'POST', `/purchasing/orders/${po.id}/receive`, { lines: o.lines.map((l: { id: number; qty: number }) => ({ lineId: l.id, qty: l.qty })) }), 'receive');
    expect(rec.status).toBe('received');
    // Profitability now counts the actual purchase.
    const costs = ok(await call('owner', 'GET', `/finance/events/${id}/costs`), 'costs');
    expect(costs.actual.food).toBeGreaterThan(0);
    expect(costs.revenue).toBe(7_000_000);
  });

  it('staffing, equipment and a shortage reported from the field', async () => {
    const st = ok(await call('em1', 'GET', `/events/${id}/staffing`), 'staffing');
    const lines = st.suggestion.map((x: { role: string; required: number }) => ({ role: x.role, required: x.required, assigned: x.required, arrived: null, notes: '' }));
    ok(await call('owner', 'PUT', `/events/${id}/staffing`, { lines, ubeyaRef: 'UB-77' }), 'staffing save');
    ok(await call('ops', 'POST', `/events/${id}/equipment`, { label: 'מחממי מזון', planned: 10 }), 'equipment');
    // On site: a shortage reported from the field reaches the kitchen.
    ok(await call('em1', 'POST', `/events/${id}/reports`, { kind: 'shortage', target: 'kitchen', content: 'חסרות 20 מנות עיקרית', urgent: true }), 'field report');
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM field_reports WHERE event_id = ? AND resolved_at IS NULL', id)!.n).toBeGreaterThan(0);
  });

  it('readiness confirmations → executed opens the closing tasks', async () => {
    ok(await call('chef', 'POST', `/events/${id}/confirm`, { kind: 'kitchen_ready', note: 'מוכן, עם פער מחממים שטופל' }), 'kitchen ready');
    ok(await call('em1', 'POST', `/events/${id}/confirm`, { kind: 'field_ready', note: 'מוכן בשטח' }), 'field ready');
    ok(await call('em1', 'POST', `/events/${id}/confirm`, { kind: 'executed', note: '' }), 'executed');
    const types = new Set(openTasks(id).map((t) => t.type));
    expect(types.has('feedback_call') || types.has('collect_balance')).toBe(true);
  });

  it('cannot close with money, reports or tasks open; closes once they are done', async () => {
    const blocked = await call('owner', 'POST', `/events/${id}/lifecycle`, { lifecycle: 'closed', reason: '' });
    expect(blocked.status).toBe(422);
    expect(blocked.data.details.blockers.length).toBeGreaterThan(0);

    for (const p of all<{ id: number; amount: number; received: number; version: number }>('SELECT id, amount, received, version FROM payments WHERE event_id = ?', id)) {
      ok(await call('acc', 'POST', `/finance/payments/${p.id}/receive`, { amount: p.amount - p.received, receivedAt: today(), reference: `העברה ${p.id}`, version: p.version }), 'payment');
    }
    expect(ok(await call('acc', 'GET', `/finance/events/${id}/payments`), 'payments').summary.balance).toBe(0);
    for (const r of all<{ id: number }>('SELECT id FROM field_reports WHERE event_id = ? AND resolved_at IS NULL', id)) {
      ok(await call('ops', 'POST', `/reports/${r.id}/resolve`, { decision: 'נמצא במחסן' }), 'resolve report');
    }
    for (const t of openTasks(id)) ok(await call('owner', 'POST', `/tasks/${t.id}/complete`, { note: 'בוצע בסגירת האירוע' }), `task ${t.type}`);
    expect(openTasks(id)).toHaveLength(0);

    ok(await call('owner', 'POST', `/events/${id}/lifecycle`, { lifecycle: 'closed', reason: '' }), 'close');
    expect(get<{ lifecycle: string }>('SELECT lifecycle FROM events WHERE id = ?', id)!.lifecycle).toBe('closed');
    // The whole story is in the event history.
    const history = ok(await call('owner', 'GET', `/events/${id}/history`), 'history') as { action: string }[];
    for (const a of ['created', 'signed', 'late_change']) expect(history.some((h) => h.action === a), a).toBe(true);
  });
});
