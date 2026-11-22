import { maskAllocation } from '../../core/scope.ts';
/**
 * Kitchen planning: per-event portions & raw materials, chef overrides with reasons,
 * requirement approval (feeds inventory allocation), weekly load, and the daily prep board (KDS).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, intParam, invalid, requireAny, zDate, zId, zQty, zText, type AppEnv, type SessionUser } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { addDays, nowISO, today, weekStart } from '../../../shared/dates.ts';
import { weeklyLoad } from '../../../shared/kitchen.ts';
import type { EventRecord, KitchenView } from '../../../shared/types.ts';
import { defaultWarehouse, effectivePortions, eventFor, eventRaw, loadEvent, menuLines, venueFilter } from '../events/service.ts';
import { reconcileEvent } from '../tasks/engine.ts';
import { camel } from '../../core/http.ts';
import type { ItemKind } from '../../../shared/domain.ts';

export const kitchenRoutes = new Hono<AppEnv>();

function kitchenView(ev: EventRecord, user?: SessionUser): KitchenView {
  const lines = menuLines(ev);
  const plan = new Map(all<{ dish_id: number; prep_date: string; portions_override: number | null; reason: string; status: string }>(
    'SELECT dish_id, prep_date, portions_override, reason, status FROM prep_plan WHERE event_id = ?', ev.id,
  ).map((p) => [p.dish_id, p]));
  const { raw, missingRecipes } = eventRaw(ev);
  return {
    lines: lines.map((l) => {
      const p = plan.get(l.dishId);
      return { ...l, prepDate: p?.prep_date ?? null, portionsOverride: p?.portions_override ?? null, reason: p?.reason ?? '', prepStatus: p?.status ?? 'unplanned' };
    }),
    // Other events sharing the same stock keep their quantities but not their names when outside the user's venues.
    raw: user ? raw.map((r) => (r.allocation ? { ...r, allocation: maskAllocation(user, r.allocation) } : r)) : raw,
    missingRecipes,
  };
}

kitchenRoutes.get('/events/:id', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'kitchen', 1);
  return c.json(kitchenView(ev, c.get('user')));
});

/** Chef plans a dish: prep day and (optionally) a different portion count — with a reason. */
kitchenRoutes.put('/events/:id/prep/:dishId', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'kitchen', 2);
  const dishId = intParam(c, 'dishId');
  const b = await body(c, z.object({
    prepDate: zDate,
    portionsOverride: z.number().int().min(0).max(100000).nullable(),
    reason: zText(500).default(''),
  }));
  if (!menuLines(ev).some((l) => l.dishId === dishId)) throw invalid('המנה אינה בתפריט האירוע');
  if (b.prepDate > ev.date) throw invalid('יום ההכנה אחרי מועד האירוע', { fields: { prepDate: 'אחרי האירוע' } });
  if (b.portionsOverride !== null && !b.reason) throw invalid('שינוי כמות מחייב תיעוד סיבה', { fields: { reason: 'נדרשת סיבה' } });
  tx(() => {
    run(
      `INSERT INTO prep_plan (event_id, dish_id, prep_date, portions_override, reason) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_id, dish_id) DO UPDATE SET prep_date = excluded.prep_date, portions_override = excluded.portions_override, reason = excluded.reason`,
      ev.id, dishId, b.prepDate, b.portionsOverride, b.reason,
    );
    audit({ entity: 'prep', entityId: dishId, eventId: ev.id, userId: user.id, action: 'prep_planned', summary: `תכנון הכנה ל-${b.prepDate}${b.portionsOverride !== null ? `, ${b.portionsOverride} מנות (${b.reason})` : ''}` });
  });
  publish({ topic: 'event', id: ev.id, eventId: ev.id });
  return c.json(kitchenView(loadEvent(ev.id), c.get('user')));
});

/** KDS: mark a prep item status (optimistic on the client). */
kitchenRoutes.post('/events/:id/prep/:dishId/status', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'kitchen', 2);
  const dishId = intParam(c, 'dishId');
  const b = await body(c, z.object({ status: z.enum(['planned', 'in_progress', 'done']) }));
  const r = run('UPDATE prep_plan SET status = ?, done_by = ?, done_at = ? WHERE event_id = ? AND dish_id = ?',
    b.status, b.status === 'done' ? user.id : null, b.status === 'done' ? nowISO() : null, ev.id, dishId);
  if (!r.changes) throw invalid('יש לתכנן יום הכנה למנה לפני סימון סטטוס');
  publish({ topic: 'event', id: ev.id, eventId: ev.id });
  return c.json({ ok: true });
});

/**
 * Approve the event's demand. Items default to the computed quantity; the kitchen can adjust.
 * Approved requirements reserve stock (allocation by event date) and open shortage tasks.
 */
kitchenRoutes.post('/events/:id/requirements', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'kitchen', 3);
  const b = await body(c, z.object({
    items: z.array(z.object({ itemId: zId, qty: zQty, warehouseId: zId.nullable().optional(), source: z.enum(['menu', 'manual']).default('menu') })).min(1),
  }));
  tx(() => {
    for (const it of b.items) {
      const item = get<{ kind: ItemKind }>('SELECT kind FROM items WHERE id = ?', it.itemId);
      if (!item) throw invalid('פריט לא קיים');
      const wh = it.warehouseId ?? defaultWarehouse(item.kind, ev.venue);
      if (it.qty === 0) { run('DELETE FROM requirements WHERE event_id = ? AND item_id = ? AND consumed = 0', ev.id, it.itemId); continue; }
      run(
        `INSERT INTO requirements (event_id, item_id, qty, source, warehouse_id, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id, item_id) DO UPDATE SET qty = excluded.qty, warehouse_id = excluded.warehouse_id, approved_by = excluded.approved_by, approved_at = excluded.approved_at`,
        ev.id, it.itemId, it.qty, it.source, wh, user.id, nowISO(),
      );
    }
    audit({ entity: 'requirements', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'requirements_approved', summary: `אושרה דרישה ל-${b.items.length} פריטים` });
  });
  reconcileEvent(ev.id);
  publish({ topic: 'inventory' }, { topic: 'event', id: ev.id, eventId: ev.id });
  return c.json(kitchenView(loadEvent(ev.id), c.get('user')));
});

/** Record consumption of approved requirements (day of the event): writes stock movements. */
kitchenRoutes.post('/events/:id/consume', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'inventory', 2);
  const b = await body(c, z.object({ items: z.array(z.object({ itemId: zId, qty: zQty })).min(1) }));
  tx(() => {
    for (const it of b.items) {
      const r = get<{ id: number; warehouse_id: number }>('SELECT id, warehouse_id FROM requirements WHERE event_id = ? AND item_id = ? AND consumed = 0', ev.id, it.itemId);
      if (!r) throw invalid('הפריט אינו בדרישה פתוחה של האירוע');
      if (it.qty > 0) insert('stock_movements', { item_id: it.itemId, warehouse_id: r.warehouse_id, qty: -it.qty, kind: 'consumption', event_id: ev.id, user_id: user.id, at: nowISO(), note: 'צריכה לאירוע' });
      run('UPDATE requirements SET consumed = 1 WHERE id = ?', r.id);
    }
    audit({ entity: 'requirements', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'consumed', summary: `נרשמה צריכה של ${b.items.length} פריטים` });
  });
  reconcileEvent(ev.id);
  publish({ topic: 'inventory' });
  return c.json({ ok: true });
});

/** Weekly load: total portions per dish + per-event breakdown, events per day. */
kitchenRoutes.get('/week', (c) => {
  const user = requireAny(c, 'kitchen', 1);
  const start = weekStart(c.req.query('start') ?? today());
  const end = addDays(start, 6);
  const vf = venueFilter(user);
  const events = all(`SELECT e.* FROM events e WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle != 'cancelled' AND e.sales_status != 'lost' ORDER BY e.date, e.start_time`, ...vf.params, start, end)
    .map((r) => camel<EventRecord>(r));
  const inputs = events.map((ev) => ({ eventId: ev.id, title: ev.title, date: ev.date, lines: effectivePortions(ev) }));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const evs = events.filter((e) => e.date === date);
    const prep = all<{ event_id: number; dish_id: number; name: string; status: string; title: string }>(
      `SELECT p.event_id, p.dish_id, d.name, p.status, e.title FROM prep_plan p JOIN dishes d ON d.id = p.dish_id JOIN events e ON e.id = p.event_id
        WHERE p.prep_date = ? AND e.lifecycle != 'cancelled'`, date,
    );
    return {
      date,
      events: evs.map((e) => ({ id: e.id, title: e.title, venue: e.venue, guests: e.guests, startTime: e.startTime, menuStatus: e.menuStatus })),
      guests: evs.reduce((s, e) => s + e.guests, 0),
      portions: inputs.filter((i) => i.date === date).reduce((s, i) => s + i.lines.reduce((a, l) => a + l.portions, 0), 0),
      prepItems: prep.length,
      prepDone: prep.filter((p) => p.status === 'done').length,
    };
  });
  return c.json({ start, end, days, dishes: weeklyLoad(inputs) });
});

/** Daily prep board (KDS): everything planned for a prep day, plus dishes of that day's events not yet planned. */
kitchenRoutes.get('/prep', (c) => {
  const user = requireAny(c, 'kitchen', 1);
  const date = c.req.query('date') ?? today();
  const vf = venueFilter(user);
  const planned = all<{ event_id: number; dish_id: number; status: string }>(
    `SELECT p.event_id, p.dish_id, p.status FROM prep_plan p JOIN events e ON e.id = p.event_id
      WHERE p.prep_date = ? AND ${vf.sql} AND e.lifecycle != 'cancelled'`, date, ...vf.params,
  );
  const eventIds = new Set(planned.map((p) => p.event_id));
  for (const e of all<{ id: number }>(`SELECT e.id FROM events e WHERE e.date = ? AND ${vf.sql} AND e.lifecycle = 'planning'`, date, ...vf.params)) eventIds.add(e.id);
  const cards = [...eventIds].map((id) => {
    const ev = loadEvent(id);
    const lines = menuLines(ev);
    const plan = new Map(all<{ dish_id: number; prep_date: string; portions_override: number | null; status: string; reason: string }>(
      'SELECT dish_id, prep_date, portions_override, status, reason FROM prep_plan WHERE event_id = ?', id,
    ).map((p) => [p.dish_id, p]));
    const portions = new Map(effectivePortions(ev, lines).map((p) => [p.dishId, p.portions]));
    const dietary = all<{ kind: string; count: number; description: string }>('SELECT kind, count, description FROM dietary WHERE event_id = ?', id);
    const dishes = [...new Map(lines.map((l) => [l.dishId, l])).values()]
      .filter((l) => (plan.get(l.dishId)?.prep_date ?? ev.date) === date)
      .map((l) => ({
        dishId: l.dishId, dishName: l.dishName, category: l.category, allergens: l.allergens,
        portions: portions.get(l.dishId) ?? l.portions, notes: lines.filter((x) => x.dishId === l.dishId).map((x) => x.notes).filter(Boolean).join(' · '),
        status: plan.get(l.dishId)?.status ?? 'unplanned', planned: plan.has(l.dishId), reason: plan.get(l.dishId)?.reason ?? '',
      }));
    return { eventId: id, title: ev.title, venue: ev.venue, date: ev.date, startTime: ev.startTime, guests: ev.guests, menuStatus: ev.menuStatus, menuVersion: ev.menuVersion, dietary, dishes };
  }).filter((c) => c.dishes.length).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return c.json({ date, cards });
});
