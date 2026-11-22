/**
 * Profitability, supplier invoices, venue capacity, run of show, transport and resource conflicts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { openDb, get, run } from '../server/core/db.ts';
import { createApp } from '../server/app.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { addDays, today } from '../shared/dates.ts';
import { eventCosts, dishPortionCost, lineCost } from '../shared/costing.ts';
import { equipmentConflicts, shiftTime, vehicleConflicts } from '../shared/schedule.ts';

const app = (() => { openDb(':memory:'); seedDemo(); return createApp(); })();
const cookies: Record<string, string> = {};
type R<T = any> = { status: number; data: T }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function login(u: string) {
  const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: `${u}@demo.local`, password: 'demo1234' }) });
  cookies[u] = (r.headers.get('set-cookie') ?? '').split(';')[0];
}
async function call<T = any>(u: string, method: string, path: string, body?: unknown): Promise<R<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await app.request(`/api${path}`, { method, headers: { cookie: cookies[u], 'x-mb': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let data: unknown = t;
  try { data = t ? JSON.parse(t) : null; } catch { /* text */ }
  return { status: r.status, data: data as T };
}
const ev = (title: string) => get<{ id: number; version: number; venue: string; date: string }>('SELECT id, version, venue, date FROM events WHERE title = ?', title)!;
const fieldErr = (r: R) => (r.data?.details?.fields ?? {}) as Record<string, string>;

beforeAll(async () => { for (const u of ['em2', 'owner', 'ops', 'sales1', 'brand.eden', 'chef', 'buyer', 'em1', 'acc', 'logistics', 'crew', 'staff']) await login(u); });

describe('pure rules', () => {
  it('money stays in whole agorot', () => {
    expect(lineCost(333, 1.5)).toBe(500);
    expect(dishPortionCost(10, [{ qty: 1.2, unitCost: 4200 }, { qty: 0.3, unitCost: 450 }])).toBe(518);
    const k = eventCosts({ revenue: 100000, foodNeeds: [{ qty: 2, unitCost: 10000 }, { qty: 1, unitCost: 0 }], purchases: [], equipment: [{ planned: 10, unitCost: 350 }], staffing: [{ role: 'waiter', required: 2, arrived: null }], shiftCost: { waiter: 10000 }, manual: [{ category: 'transport', amount: 5000 }] });
    expect(k.estimate).toMatchObject({ food: 20000, rentals: 3500, staff: 20000, transport: 5000, total: 48500 });
    expect(k.profitEstimate).toBe(51500);
    expect(k.unpriced).toBe(1);
    expect(Number.isInteger(k.actual.total)).toBe(true);
  });
  it('run of show times and conflicts', () => {
    expect(shiftTime('19:00', -300)).toBe('14:00');
    expect(shiftTime('23:30', 60)).toBe('00:30');
    expect(shiftTime('', 10)).toBe('');
    const eq = equipmentConflicts([
      { date: 'd', itemId: 1, itemName: 'מחמם', owned: 12, eventId: 1, title: 'א', qty: 8 },
      { date: 'd', itemId: 1, itemName: 'מחמם', owned: 12, eventId: 2, title: 'ב', qty: 6 },
      { date: 'e', itemId: 1, itemName: 'מחמם', owned: 12, eventId: 3, title: 'ג', qty: 6 },
    ]);
    expect(eq).toHaveLength(1);
    expect(eq[0].short).toBe(2);
    expect(vehicleConflicts([
      { date: 'd', vehicleId: 1, vehicleName: 'משאית', eventId: 1, title: 'א', depart: '08:00', back: '12:00' },
      { date: 'd', vehicleId: 1, vehicleName: 'משאית', eventId: 2, title: 'ב', depart: '13:00', back: '18:00' },
    ])).toHaveLength(0);
    expect(vehicleConflicts([
      { date: 'd', vehicleId: 1, vehicleName: 'משאית', eventId: 1, title: 'א', depart: '08:00', back: '14:00' },
      { date: 'd', vehicleId: 1, vehicleName: 'משאית', eventId: 2, title: 'ב', depart: '13:00', back: '18:00' },
    ])).toHaveLength(1);
  });
});

describe('profitability', () => {
  it('owner and accountant see margins; sales and kitchen do not', async () => {
    const e = ev('חתונת ענבר ואיתי');
    const r = await call('owner', 'GET', `/finance/events/${e.id}/costs`);
    expect(r.status).toBe(200);
    expect(r.data.estimate.food).toBeGreaterThan(0);
    expect(Number.isInteger(r.data.estimate.total)).toBe(true);
    expect((await call('acc', 'GET', `/finance/events/${e.id}/costs`)).status).toBe(200);
    expect((await call('sales1', 'GET', '/finance/profitability')).status).toBe(403);
    expect((await call('chef', 'GET', `/finance/events/${e.id}/costs`)).status).toBe(403);
  });
  it('a manual cost changes the actual total and is audited; validation next to the field', async () => {
    const e = ev('חתונת ענבר ואיתי');
    const before = (await call('owner', 'GET', `/finance/events/${e.id}/costs`)).data.actual.total;
    const bad = await call('owner', 'POST', `/finance/events/${e.id}/costs`, { category: 'transport', label: '', amount: 0 });
    expect(bad.status).toBe(422);
    expect(Object.keys(fieldErr(bad))).toEqual(expect.arrayContaining(['label', 'amount']));
    const ok = await call('owner', 'POST', `/finance/events/${e.id}/costs`, { category: 'transport', label: 'משאית חלופית', amount: 120000 });
    expect(ok.status).toBe(201);
    const after = (await call('owner', 'GET', `/finance/events/${e.id}/costs`)).data;
    expect(after.actual.total).toBe(before + 120000);
    expect(get<{ action: string }>("SELECT action FROM audit_log WHERE entity = 'cost' ORDER BY id DESC LIMIT 1")!.action).toBe('created');
    expect((await call('owner', 'DELETE', `/finance/events/${e.id}/costs/${ok.data.id}`)).status).toBe(200);
  });
  it('a purchase price updates the item price used by estimates', async () => {
    const order = await call('buyer', 'POST', '/purchasing/orders', { supplierId: 1, warehouseId: 1, responsibleId: null, expectedDate: addDays(today(), 2), lines: [{ itemId: 1, qty: 5, eventId: null, unitPrice: 10500 }] });
    expect(order.status).toBe(201);
    const o = await call('buyer', 'GET', `/purchasing/orders/${order.data.id}`);
    expect(o.data.lines[0].unitPrice).toBe(10500);
    await call('buyer', 'POST', `/purchasing/orders/${order.data.id}/receive`, { lines: [{ lineId: o.data.lines[0].id, qty: 5 }] });
    expect(get<{ unit_cost: number }>('SELECT unit_cost FROM items WHERE id = 1')!.unit_cost).toBe(10500);
  });
  it('profitability list covers booked events', async () => {
    const r = await call('owner', 'GET', `/finance/profitability?from=${addDays(today(), -400)}&to=${addDays(today(), 400)}`);
    expect(r.status).toBe(200);
    expect(r.data.items.length).toBeGreaterThan(3);
    expect((await call('owner', 'GET', '/finance/dish-costs')).status).toBe(200);
  });
});

describe('supplier invoices', () => {
  it('create, refuse duplicates and overpayment, pay in parts', async () => {
    const bad = await call('acc', 'POST', '/finance/payables', { supplierId: 1, date: today(), dueDate: addDays(today(), -1), amount: 1000 });
    expect(bad.status).toBe(422);
    expect(fieldErr(bad).dueDate).toBeTruthy();
    const r = await call('acc', 'POST', '/finance/payables', { supplierId: 1, number: 'T-1', date: today(), dueDate: addDays(today(), 30), amount: 50000 });
    expect(r.status).toBe(201);
    expect((await call('acc', 'POST', '/finance/payables', { supplierId: 1, number: 'T-1', date: today(), dueDate: addDays(today(), 30), amount: 1 })).status).toBe(422);
    expect((await call('acc', 'POST', `/finance/payables/${r.data.id}/pay`, { amount: 60000 })).status).toBe(422);
    expect((await call('acc', 'POST', `/finance/payables/${r.data.id}/pay`, { amount: 20000 })).status).toBe(200);
    expect(get<{ status: string }>('SELECT status FROM supplier_invoices WHERE id = ?', r.data.id)!.status).toBe('partial');
    await call('acc', 'POST', `/finance/payables/${r.data.id}/pay`, { amount: 30000 });
    expect(get<{ status: string }>('SELECT status FROM supplier_invoices WHERE id = ?', r.data.id)!.status).toBe('paid');
    const list = await call('acc', 'GET', '/finance/payables');
    expect(list.data.totals.overdue).toBeGreaterThan(0);
    expect((await call('chef', 'GET', '/finance/payables')).status).toBe(403);
    // Edit with conflict detection.
    const p = await call('acc', 'PATCH', `/finance/payables/${r.data.id}`, { changes: { notes: 'שונה' }, base: { notes: 'אחר' } });
    expect(p.status).toBe(409);
  });
});

describe('venue capacity', () => {
  it('a hall cannot hand over a second event on a full day unless management overrides', async () => {
    const date = addDays(today(), 200);
    const first = await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date, guests: 200, client: { name: 'זוג אחד', phone: '052-1000001' } });
    expect(first.status).toBe(201);
    expect((await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date, guests: 200, client: { name: 'זוג שניים', phone: '052-1000002' } })).status).toBe(201);
    const third = await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date, guests: 200, client: { name: 'זוג שלוש', phone: '052-1000003' } });
    expect(third.status).toBe(422);
    expect(fieldErr(third).date).toBeTruthy();
    const a = await call('brand.eden', 'GET', `/events/availability?venue=eden&date=${date}`);
    expect(a.data).toMatchObject({ max: 2, booked: 2, full: true });
    // Only management may overbook.
    expect((await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date, guests: 200, allowOverbook: true, client: { name: 'זוג שלוש', phone: '052-1000003' } })).status).toBe(422);
    expect((await call('owner', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date, guests: 200, allowOverbook: true, client: { name: 'זוג שלוש', phone: '052-1000003' } })).status).toBe(201);
  });
  it('signing a winery contract on a booked day is refused; moving a booked event onto a full day too', async () => {
    const booked = get<{ id: number; date: string }>("SELECT id, date FROM events WHERE venue = 'winery' AND sales_status = 'signed' AND lifecycle = 'planning' ORDER BY date LIMIT 1")!;
    const lead = await call('sales1', 'POST', '/events', { venue: 'winery', eventType: 'conference', date: booked.date, guests: 80, client: { name: 'לקוח תאריך', phone: '054-7000001' } });
    expect(lead.status).toBe(201); // a lead does not hold the date
    const v = get<{ version: number }>('SELECT version FROM events WHERE id = ?', lead.data.id)!.version;
    const sign = await call('sales1', 'POST', `/events/${lead.data.id}/sign`, { signedAt: today(), contractTotal: 1000000, deposit: 0, depositDue: null, finalDue: null, version: v });
    expect(sign.status).toBe(422);
    expect(fieldErr(sign).allowOverbook).toBeTruthy();
    // Another signed winery event moved onto that day.
    const other = get<{ id: number; date: string; version: number }>("SELECT id, date, version FROM events WHERE venue = 'winery' AND sales_status = 'signed' AND date != ? AND lifecycle = 'planning' LIMIT 1", booked.date);
    if (other) {
      const mv = await call('owner', 'PATCH', `/events/${other.id}`, { changes: { date: booked.date }, base: { date: other.date } });
      expect(mv.status).toBe(422);
    }
  });
});

describe('run of show, transport, sheet, staffing by day', () => {
  it('default from settings shifted to the start time; edit; reset', async () => {
    const e = ev('חתונת ענבר ואיתי');
    run("UPDATE events SET start_time = '19:00' WHERE id = ?", e.id);
    const d = await call('em2', 'GET', `/events/${e.id}/run-of-show`);
    expect(d.data.isDefault).toBe(true);
    expect(d.data.rows[0].time).toBe('14:00');
    const bad = await call('em2', 'PUT', `/events/${e.id}/run-of-show`, { rows: [{ time: '', title: 'x' }] });
    expect(bad.status).toBe(422);
    const ok = await call('em2', 'PUT', `/events/${e.id}/run-of-show`, { rows: [{ time: '18:00', title: 'הגעת צוות', role: 'event_manager' }, { time: '19:00', title: 'קבלת פנים' }] });
    expect(ok.status).toBe(200);
    expect(ok.data.isDefault).toBe(false);
    expect((await call('staff', 'PUT', `/events/${e.id}/run-of-show`, { rows: [] })).status).toBe(403);
    expect((await call('em2', 'DELETE', `/events/${e.id}/run-of-show`)).data.isDefault).toBe(true);
  });
  it('transport: vehicle double-booked on overlapping times is reported', async () => {
    const a = ev('חתונת ענבר ואיתי');
    const truck = get<{ id: number }>("SELECT id FROM vehicles WHERE name = 'משאית קירור'")!.id;
    const other = get<{ id: number }>("SELECT id FROM events WHERE date = ? AND id != ? AND lifecycle = 'planning' LIMIT 1", a.date, a.id);
    const target = other?.id ?? (await call('owner', 'POST', '/events', { venue: 'offsite', eventType: 'corporate', date: a.date, guests: 50, client: { name: 'לקוח משאית', phone: '054-7000002' } })).data.id;
    const r = await call('owner', 'PUT', `/events/${target}/transport`, { lines: [{ vehicleId: truck, driver: 'דני', departTime: '15:00', returnTime: '20:00' }] });
    expect(r.status).toBe(200);
    expect(r.data.conflicts.length).toBe(1);
    const all = await call('logistics', 'GET', `/ops/conflicts?from=${a.date}&to=${a.date}`);
    expect(all.data.vehicles.length).toBe(1);
  });
  it('equipment overlap beyond owned quantity is reported on the event', async () => {
    const a = ev('חתונת ענבר ואיתי');
    const warmer = get<{ id: number }>("SELECT id FROM items WHERE name = 'מחממי מזון (בבעלות)'")!.id;
    const b = (await call('owner', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date: a.date, guests: 100, allowOverbook: true, client: { name: 'זוג מחממים', phone: '054-7000003' } })).data.id;
    run("UPDATE events SET sales_status = 'hall' WHERE id = ?", b);
    expect((await call('owner', 'POST', `/events/${a.id}/equipment`, { itemId: warmer, label: 'מחממים', planned: 8 })).status).toBe(201);
    run('INSERT INTO event_equipment (event_id, item_id, label, planned) VALUES (?, ?, ?, ?)', b, warmer, 'מחממים', 6);
    const eq = await call('owner', 'GET', `/events/${a.id}/equipment`);
    expect(eq.data.conflicts).toHaveLength(1);
    expect(eq.data.conflicts[0].short).toBe(2);
  });
  it('printable sheet respects contact rule; staffing by day groups events', async () => {
    const e = ev('חתונת ענבר ואיתי');
    const s = await call('owner', 'GET', `/events/${e.id}/sheet`);
    expect(s.status).toBe(200);
    expect(s.data.show.length).toBeGreaterThan(0);
    const crew = await call('crew', 'GET', `/events/${e.id}/sheet`);
    if (crew.status === 200 && crew.data.client) expect(crew.data.client.phone).toBe('');
    const st = await call('em1', 'GET', `/ops/staffing?from=${today()}&to=${addDays(today(), 30)}`);
    expect(st.status).toBe(200);
    expect(st.data.days.length).toBeGreaterThan(0);
    expect((await call('acc', 'GET', '/ops/staffing')).status).toBe(403);
  });
});

describe('venue defaults and form defaults', () => {
  it('a hall event takes the hall contact and payer from the venue unless the form sets them', async () => {
    const date = addDays(today(), 260);
    const r = await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date, guests: 150, client: { name: 'זוג ברירת מחדל', phone: '052-1000099' } });
    expect(r.status).toBe(201);
    const e = get<{ hall_contact_name: string; hall_contact_phone: string; payer: string }>('SELECT hall_contact_name, hall_contact_phone, payer FROM events WHERE id = ?', r.data.id)!;
    expect(e).toMatchObject({ hall_contact_name: 'מנהלת אירועים באולם', hall_contact_phone: '08-9000000', payer: 'האולם' });
    const own = await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date: addDays(date, 1), payer: 'הזוג', client: { name: 'זוג משלם', phone: '052-1000098' } });
    expect(get<{ payer: string }>('SELECT payer FROM events WHERE id = ?', own.data.id)!.payer).toBe('הזוג');
  });
  it('venue defaults and form defaults are editable', async () => {
    const venues = (await call('owner', 'GET', '/admin/config')).data.venues as { code: string; name: string; address: string; track: string; equipment: string; loadCheck: boolean; siteDetails: boolean; color: string; sort: number; active: number; maxPerDay: number | null; defaults: Record<string, unknown> }[];
    const farm = venues.find((v) => v.code === 'farm')!;
    expect(farm.defaults.payer).toBe('האולם');
    const put = await call('owner', 'PUT', '/admin/venues/farm', { ...farm, active: !!farm.active, defaults: { ...farm.defaults, startTime: '18:30', hallContactPhone: 'abc' } });
    expect(put.status).toBe(422);
    const ok = await call('owner', 'PUT', '/admin/venues/farm', { ...farm, active: !!farm.active, defaults: { ...farm.defaults, startTime: '18:30' } });
    expect(ok.status).toBe(200);
    expect(get<{ defaults: string }>("SELECT defaults FROM venues WHERE code = 'farm'")!.defaults).toContain('18:30');
    const s = (await call('owner', 'GET', '/admin/settings')).data;
    const saved = await call('owner', 'PUT', '/admin/settings', { ...s, formDefaults: { ...s.formDefaults, poTime: '07:30', quotePerGuest: { wedding: 32000 } } });
    expect(saved.status).toBe(200);
    expect(saved.data.formDefaults).toMatchObject({ poTime: '07:30', quotePerGuest: { wedding: 32000 } });
    expect(saved.data.runOfShow.length).toBeGreaterThan(0);
  });
  it('an empty date says it is required, a bad one says it is invalid', async () => {
    const a = await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date: '', client: { name: 'א ב', phone: '052-1000097' } });
    expect(fieldErr(a).date).toBe('נדרש תאריך');
    const b = await call('brand.eden', 'POST', '/events', { venue: 'eden', eventType: 'wedding', date: '19.11.2026', client: { name: 'א ב', phone: '052-1000097' } });
    expect(fieldErr(b).date).toBe('תאריך לא תקין');
  });
});
