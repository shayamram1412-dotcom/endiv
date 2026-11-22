/**
 * Venue isolation: a user limited to some venues must not see — or change — anything that belongs to another venue.
 *
 * For every demo user with venue-limited grants, every list / detail / export screen is called and the raw response
 * is searched for the names of other venues' events and clients. Anything found is a leak.
 * Then the write paths that take an id are called with another venue's ids and must be refused.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { all, get, insert, openDb, run } from '../server/core/db.ts';
import { createApp } from '../server/app.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { loadPrincipal } from '../server/core/auth.ts';
import { venueScope, type Principal } from '../shared/permissions.ts';
import { addDays, today } from '../shared/dates.ts';

const app = (() => { openDb(':memory:'); seedDemo(); return createApp(); })();

async function login(email: string) {
  const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }) });
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}
async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await app.request(`/api${path}`, { method, headers: { cookie, 'x-mb': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
}

const FROM = addDays(today(), -400);
const TO = addDays(today(), 400);

beforeAll(() => {
  // A vehicle and an owned item shared by a winery and a farm event on the same day, so clashes cross venues.
  const farm = get<{ id: number; date: string }>("SELECT id, date FROM events WHERE venue = 'farm' AND lifecycle = 'planning' AND sales_status = 'hall' ORDER BY date LIMIT 1")!;
  const winery = get<{ id: number }>("SELECT id FROM events WHERE venue = 'winery' AND lifecycle = 'planning' AND sales_status = 'signed' ORDER BY date LIMIT 1")!;
  run('UPDATE events SET date = ? WHERE id = ?', farm.date, winery.id);
  const truck = get<{ id: number }>("SELECT id FROM vehicles WHERE name = 'משאית קירור'")!.id;
  insert('event_transport', { event_id: winery.id, vehicle_id: truck, driver: 'א', depart_time: '14:00', return_time: '23:00' });
  const warmer = get<{ id: number }>("SELECT id FROM items WHERE name = 'מחממי מזון (בבעלות)'")!.id;
  insert('event_equipment', { event_id: farm.id, item_id: warmer, label: 'מחממים', planned: 8 });
  insert('event_equipment', { event_id: winery.id, item_id: warmer, label: 'מחממים', planned: 8 });
  // A client document on a winery-only client.
  const wineryClient = get<{ client_id: number }>('SELECT client_id FROM events WHERE id = ?', winery.id)!.client_id;
  insert('documents', { client_id: wineryClient, event_id: null, kind: 'other', name: 'חוזה-מסגרת.pdf', stored_name: 'x.pdf', mime: 'application/pdf', size: 1, uploaded_by: 1, at: new Date().toISOString() });
});

const scoped = all<{ id: number; email: string }>('SELECT id, email FROM users WHERE active = 1').filter((u) => venueScope(loadPrincipal(u.id) as Principal) !== null);

describe.each(scoped)('$email', (u) => {
  it('sees nothing of other venues and cannot change it', async () => {
    const cookie = await login(u.email);
    const scope = venueScope(loadPrincipal(u.id) as Principal)!;
    const inScope = (v: string | null) => v !== null && scope.includes(v as never);
    const ph = scope.map(() => '?').join(',');

    const foreignEvents = all<{ id: number; title: string; venue: string; date: string }>(`SELECT id, title, venue, date FROM events WHERE venue NOT IN (${ph})`, ...scope);
    const ownTitles = new Set(all<{ title: string }>(`SELECT title FROM events WHERE venue IN (${ph})`, ...scope).map((r) => r.title));
    const foreignClients = all<{ id: number; name: string; phone: string }>(
      `SELECT c.id, c.name, c.phone FROM clients c WHERE EXISTS (SELECT 1 FROM events e WHERE e.client_id = c.id) AND NOT EXISTS (SELECT 1 FROM events e WHERE e.client_id = c.id AND e.venue IN (${ph}))`, ...scope);
    // Names that may appear only if they belong to another venue (a title used in both is not evidence).
    const secrets = [
      ...foreignEvents.map((e) => e.title).filter((t) => !ownTitles.has(t)),
      ...foreignClients.map((c) => c.name),
      ...foreignClients.map((c) => c.phone),
    ].filter((s) => s.length >= 4);
    const problems: string[] = [];
    const scan = async (path: string) => {
      const r = await call(cookie, 'GET', path);
      if (r.status >= 500) problems.push(`${path} → ${r.status}`);
      if (r.status !== 200) return;
      for (const s of secrets) if (r.text.includes(`"${s}"`) || r.text.includes(`,${s},`) || r.text.includes(`,"${s}",`)) problems.push(`${path} shows "${s}"`);
    };

    const own = all<{ id: number }>(`SELECT id FROM events WHERE venue IN (${ph}) LIMIT 6`, ...scope);
    const paths = [
      `/events?from=${FROM}&to=${TO}&lifecycle=planning,completed,closed`, '/clients', `/calendar?from=${FROM}&to=${TO}`, '/dashboard',
      '/tasks?status=all', '/tasks?view=mine', '/search?q=%D7%97%D7%AA', '/search?q=%D7%94%D7%A4', '/search?q=052', '/search?q=054',
      '/purchasing/orders', '/purchasing/suggestions', '/inventory/warehouses', '/inventory/stock', '/inventory/shortages', '/inventory/movements',
      `/ops/conflicts?from=${FROM}&to=${TO}`, `/ops/staffing?from=${FROM}&to=${TO}`, `/ops/capacity?from=${FROM}&to=${TO}`,
      '/process/export/clients', '/process/export/events', '/process/export/tasks', '/process/export/receivables',
      '/sales/pipeline', '/sales/conversion', '/finance/receivables', '/kitchen/week', '/kitchen/prep', '/reports',
      ...foreignClients.slice(0, 5).map((c) => `/clients/lookup?phone=${encodeURIComponent(c.phone)}`),
      ...foreignClients.slice(0, 5).map((c) => `/documents?client=${c.id}`),
      ...foreignEvents.slice(0, 8).map((e) => `/events/availability?venue=${e.venue}&date=${e.date}`),
      ...own.flatMap((e) => [`/events/${e.id}`, `/kitchen/events/${e.id}`, `/events/${e.id}/equipment`, `/events/${e.id}/transport`, `/events/${e.id}/sheet`, `/events/${e.id}/field`]),
    ];
    for (const p of paths) await scan(p);

    // Direct access to another venue's records is refused.
    for (const e of foreignEvents.slice(0, 5)) {
      const r = await call(cookie, 'GET', `/events/${e.id}`);
      if (r.status === 200) problems.push(`/events/${e.id} (other venue) → 200`);
    }
    for (const cl of foreignClients.slice(0, 5)) {
      if ((await call(cookie, 'GET', `/clients/${cl.id}`)).status === 200) problems.push(`/clients/${cl.id} (other venue) → 200`);
    }
    const foreignDoc = get<{ id: number; client_id: number }>("SELECT id, client_id FROM documents WHERE name = 'חוזה-מסגרת.pdf'");
    if (foreignDoc && foreignClients.some((c) => c.id === foreignDoc.client_id) && (await call(cookie, 'GET', `/documents/${foreignDoc.id}/download`)).status === 200) problems.push('client document of another venue downloaded');

    // Writes on another venue's records.
    const meeting = get<{ id: number; status: string }>(`SELECT m.id, m.status FROM meetings m JOIN events e ON e.id = m.event_id WHERE e.venue NOT IN (${ph}) AND m.status = 'scheduled' LIMIT 1`, ...scope);
    if (meeting) {
      const r = await call(cookie, 'PATCH', `/meetings/${meeting.id}`, { status: 'cancelled' });
      if (r.status === 200) problems.push(`meeting ${meeting.id} of another venue changed`);
      expect(get<{ status: string }>('SELECT status FROM meetings WHERE id = ?', meeting.id)!.status).toBe('scheduled');
    }
    const centralPo = get<{ id: number }>('SELECT p.id FROM purchase_orders p JOIN warehouses w ON w.id = p.warehouse_id WHERE w.venue IS NULL LIMIT 1');
    if (centralPo) {
      if ((await call(cookie, 'GET', `/purchasing/orders/${centralPo.id}`)).status === 200) problems.push('central purchase order visible');
      if ((await call(cookie, 'POST', `/purchasing/orders/${centralPo.id}/cancel`, { reason: 'בדיקה' })).status === 200) problems.push('central purchase order cancelled');
    }
    const central = get<{ id: number }>('SELECT id FROM warehouses WHERE venue IS NULL')!.id;
    const flour = get<{ id: number }>("SELECT id FROM items WHERE name = 'קמח'")!.id;
    if ((await call(cookie, 'POST', '/inventory/movements', { kind: 'count', itemId: flour, warehouseId: central, counted: 1 })).status === 201) problems.push('central stock changed');
    if ((await call(cookie, 'POST', '/catalog/items', { name: 'פריט בדיקה', kind: 'food', unit: 'ק״ג' })).status === 201) problems.push('business-wide catalog changed');
    if ((await call(cookie, 'POST', '/purchasing/suppliers', { name: 'ספק בדיקה' })).status === 201) problems.push('supplier created');

    // Business-wide settings and prices.
    if ((await call(cookie, 'GET', '/admin/venues')).status === 200) problems.push('/admin/venues readable');
    const settings = JSON.parse((await call(cookie, 'GET', '/admin/settings')).text);
    if (Object.values(settings.staffShiftCost ?? {}).some((v) => Number(v) > 0)) problems.push('staff shift costs visible');
    const items = await call(cookie, 'GET', '/catalog/items');
    const caps = loadPrincipal(u.id) as Principal;
    const buyer = caps.grants.some((g) => ['purchasing', 'kitchen', 'ops', 'owner'].includes(g.role));
    if (items.status === 200 && !buyer && (JSON.parse(items.text) as { unitCost: number }[]).some((i) => i.unitCost > 0)) problems.push('purchase prices visible');

    // Every scoped list only lists its venues.
    const evs = JSON.parse((await call(cookie, 'GET', `/events?from=${FROM}&to=${TO}&lifecycle=planning,completed,closed`)).text) as { venue: string }[];
    if (Array.isArray(evs)) for (const e of evs) if (!inScope(e.venue)) problems.push(`event list includes ${e.venue}`);

    expect(problems).toEqual([]);
  }, 60_000);
});
