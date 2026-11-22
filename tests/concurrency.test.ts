/**
 * Two people at the same moment. Requests are fired together (Promise.all), so they interleave exactly where the
 * server awaits — reading the body — which is where a "read, then write" race would slip through.
 * Each case: nobody's work is silently lost, and nothing is counted twice.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { all, get, openDb } from '../server/core/db.ts';
import { createApp } from '../server/app.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { today } from '../shared/dates.ts';

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
const ev = (title: string) => get<{ id: number; guests: number; notes: string; version: number }>('SELECT id, guests, notes, version FROM events WHERE title = ?', title)!;

beforeAll(async () => {
  for (const u of ['owner', 'vp', 'sales1', 'sales2', 'chef', 'em1', 'em2', 'acc', 'ops', 'buyer']) {
    const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: `${u}@demo.local`, password: 'demo1234' }) });
    cookies[u] = (r.headers.get('set-cookie') ?? '').split(';')[0];
  }
});

describe('two users at once', () => {
  it('same field on an event: one saves, the other gets a conflict with both values — nothing overwritten', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const [a, b] = await Promise.all([
      call('sales1', 'PATCH', `/events/${e.id}`, { changes: { guests: e.guests + 10 }, base: { guests: e.guests } }),
      call('owner', 'PATCH', `/events/${e.id}`, { changes: { guests: e.guests + 20 }, base: { guests: e.guests } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.data.details.conflicts[0]).toMatchObject({ field: 'guests' });
    expect([e.guests + 10, e.guests + 20]).toContain(ev('ערב גאלה – הפקות גפן').guests);
  });

  it('different fields on the same event: both changes are kept', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const [a, b] = await Promise.all([
      call('sales1', 'PATCH', `/events/${e.id}`, { changes: { notes: 'חניה בצד מערב' }, base: { notes: e.notes } }),
      call('owner', 'PATCH', `/events/${e.id}`, { changes: { guests: e.guests + 5 }, base: { guests: e.guests } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const now = ev('ערב גאלה – הפקות גפן');
    expect(now.notes).toBe('חניה בצד מערב');
    expect(now.guests).toBe(e.guests + 5);
  });

  it('the menu: two saves from the same starting point — the second is refused, the first is kept', async () => {
    const e = ev('ערב גאלה – הפקות גפן');
    const m = (await call('chef', 'GET', `/events/${e.id}/menu`)).data;
    const lines = m.lines.map((l: { dishId: number; audience: string; perGuest: number; qtyOverride: number | null; notes: string }) => ({ dishId: l.dishId, audience: l.audience, perGuest: l.perGuest, qtyOverride: l.qtyOverride, notes: l.notes }));
    const mine = lines.map((l: { notes: string }, i: number) => (i === 0 ? { ...l, notes: 'של השף' } : l));
    const theirs = lines.map((l: { notes: string }, i: number) => (i === 0 ? { ...l, notes: 'של המכירות' } : l));
    const reason = m.status === 'approved' || m.status === 'changed' ? 'בקשת הלקוח' : '';
    const [a, b] = await Promise.all([
      call('chef', 'PUT', `/events/${e.id}/menu`, { eventVersion: m.eventVersion, lines: mine, dietary: m.dietary, reason }),
      call('sales1', 'PUT', `/events/${e.id}/menu`, { eventVersion: m.eventVersion, lines: theirs, dietary: m.dietary, reason }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const after = (await call('chef', 'GET', `/events/${e.id}/menu`)).data.lines[0].notes;
    expect(after).toBe(a.status === 200 ? 'של השף' : 'של המכירות');
  });

  it('a task claimed by two people at once goes to exactly one', async () => {
    const t = get<{ id: number; role: string }>("SELECT id, role FROM tasks WHERE assignee_id IS NULL AND status = 'open' AND role = 'sales' LIMIT 1")!;
    const [a, b] = await Promise.all([call('sales1', 'POST', `/tasks/${t.id}/claim`), call('sales2', 'POST', `/tasks/${t.id}/claim`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.data.error).toContain('כבר לקח');
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM task_log WHERE task_id = ? AND action = 'claimed'", t.id)!.n).toBe(1);
  });

  it('a task completed by two people at once is completed once', async () => {
    const t = get<{ id: number }>("SELECT id FROM tasks WHERE status = 'open' AND type = 'manual' LIMIT 1")
      ?? { id: (await call('owner', 'POST', '/tasks', { title: 'משימה לבדיקה', role: 'ops' })).data.id };
    const [a, b] = await Promise.all([
      call('owner', 'POST', `/tasks/${t.id}/complete`, { note: 'בוצע' }),
      call('vp', 'POST', `/tasks/${t.id}/complete`, { note: 'בוצע' }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM task_log WHERE task_id = ? AND action = 'completed'", t.id)!.n).toBe(1);
  });

  it('a payment recorded twice at once is counted once', async () => {
    const p = get<{ id: number; amount: number; received: number; version: number }>('SELECT id, amount, received, version FROM payments WHERE received < amount LIMIT 1')!;
    const body = { amount: p.amount - p.received, receivedAt: today(), reference: 'העברה 1', version: p.version };
    const [a, b] = await Promise.all([call('acc', 'POST', `/finance/payments/${p.id}/receive`, body), call('owner', 'POST', `/finance/payments/${p.id}/receive`, body)]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(get<{ received: number }>('SELECT received FROM payments WHERE id = ?', p.id)!.received).toBe(p.amount);
  });

  it('a contract signed twice at once creates one payment schedule', async () => {
    const lead = (await call('sales1', 'POST', '/events', { venue: 'offsite', eventType: 'corporate', date: '2027-06-01', guests: 100, client: { name: 'לקוח מקבילי', phone: '054-8080808' } })).data.id;
    const v = get<{ version: number }>('SELECT version FROM events WHERE id = ?', lead)!.version;
    const body = { signedAt: today(), contractTotal: 1_000_000, deposit: 300_000, depositDue: null, finalDue: null, version: v };
    const [a, b] = await Promise.all([call('sales1', 'POST', `/events/${lead}/sign`, body), call('sales2', 'POST', `/events/${lead}/sign`, body)]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM payments WHERE event_id = ?', lead)!.n).toBe(2);
  });

  it('two stock counts of the same item at once leave the balance at a counted value, not their sum', async () => {
    const central = get<{ id: number }>('SELECT id FROM warehouses WHERE venue IS NULL')!.id;
    const flour = get<{ id: number }>("SELECT id FROM items WHERE name = 'קמח'")!.id;
    const [a, b] = await Promise.all([
      call('ops', 'POST', '/inventory/movements', { kind: 'count', itemId: flour, warehouseId: central, counted: 40 }),
      call('buyer', 'POST', '/inventory/movements', { kind: 'count', itemId: flour, warehouseId: central, counted: 42 }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const bal = get<{ b: number }>('SELECT COALESCE(SUM(qty), 0) AS b FROM stock_movements WHERE item_id = ? AND warehouse_id = ?', flour, central)!.b;
    expect([40, 42]).toContain(bal);
  });

  it('receiving the same delivery twice at once does not double the stock', async () => {
    const central = get<{ id: number }>('SELECT id FROM warehouses WHERE venue IS NULL')!.id;
    const po = (await call('buyer', 'POST', '/purchasing/orders', { supplierId: 1, warehouseId: central, responsibleId: null, expectedDate: today(), lines: [{ itemId: 1, qty: 10, eventId: null }] })).data.id;
    const line = all<{ id: number }>('SELECT id FROM po_lines WHERE po_id = ?', po)[0].id;
    const before = get<{ b: number }>('SELECT COALESCE(SUM(qty), 0) AS b FROM stock_movements WHERE item_id = 1 AND warehouse_id = ?', central)!.b;
    const body = { lines: [{ lineId: line, qty: 10 }] };
    const [a, b] = await Promise.all([call('buyer', 'POST', `/purchasing/orders/${po}/receive`, body), call('ops', 'POST', `/purchasing/orders/${po}/receive`, body)]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const after = get<{ b: number }>('SELECT COALESCE(SUM(qty), 0) AS b FROM stock_movements WHERE item_id = 1 AND warehouse_id = ?', central)!.b;
    expect(after - before).toBe(10);
  });
});
