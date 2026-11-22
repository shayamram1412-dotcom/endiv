/**
 * Profitability per event (estimate vs. actual) and supplier invoices (payables).
 * Margins are internal: only management and the accountant see them.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run } from '../../core/db.ts';
import { body, camel, camelAll, forbidden, intParam, invalid, notFound, requireAny, zAgorot, zDate, zId, zText, type AppEnv, type SessionUser } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { patchRow } from '../../core/patch.ts';
import { getSettings } from '../../core/settings.ts';
import { COST_CATEGORY, dishPortionCost, eventCosts, seesMargins, type CostBreakdown } from '../../../shared/costing.ts';
import { formatMoney } from '../../../shared/money.ts';
import { addDays, nowISO, today } from '../../../shared/dates.ts';
import type { EventRecord } from '../../../shared/types.ts';
import type { StaffRole } from '../../../shared/domain.ts';
import { effectivePortions, eventFor, recipesFor, venueFilter } from '../events/service.ts';
import { rawMaterials } from '../../../shared/kitchen.ts';

export const costsRoutes = new Hono<AppEnv>();

function marginsOnly(user: SessionUser) {
  if (!seesMargins(user)) throw forbidden('נתוני רווחיות זמינים להנהלה ולהנהלת החשבונות בלבד');
}

/** Revenue = signed contract, else the latest quote. */
function revenueOf(ev: EventRecord): number | null {
  if (ev.contractTotal) return ev.contractTotal;
  return get<{ total: number }>('SELECT total FROM quotes WHERE event_id = ? ORDER BY version DESC LIMIT 1', ev.id)?.total ?? null;
}

export function costsFor(ev: EventRecord): CostBreakdown & { food: { itemId: number; itemName: string; unit: string; qty: number; unitCost: number; cost: number }[] } {
  const portions = effectivePortions(ev);
  const { needs } = rawMaterials(portions, recipesFor(portions.map((p) => p.dishId)));
  const prices = new Map(needs.length
    ? all<{ id: number; unit_cost: number }>(`SELECT id, unit_cost FROM items WHERE id IN (${needs.map(() => '?').join(',')})`, ...needs.map((n) => n.itemId)).map((r) => [r.id, r.unit_cost])
    : []);
  const food = needs.map((n) => { const unitCost = prices.get(n.itemId) ?? 0; return { itemId: n.itemId, itemName: n.itemName, unit: n.unit, qty: n.qty, unitCost, cost: Math.round(unitCost * n.qty) }; });
  const breakdown = eventCosts({
    revenue: revenueOf(ev),
    foodNeeds: food.map((f) => ({ qty: f.qty, unitCost: f.unitCost })),
    purchases: all<{ received: number; unit_price: number | null; unit_cost: number }>(
      `SELECT l.received, l.unit_price, i.unit_cost FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id JOIN items i ON i.id = l.item_id
        WHERE l.event_id = ? AND p.status != 'cancelled' AND l.received > 0`, ev.id,
    ).map((p) => ({ received: p.received, unitPrice: p.unit_price, itemCost: p.unit_cost })),
    equipment: all<{ planned: number; unit_cost: number }>('SELECT planned, unit_cost FROM event_equipment WHERE event_id = ?', ev.id).map((e) => ({ planned: e.planned, unitCost: e.unit_cost })),
    staffing: all<{ role: StaffRole; required: number; arrived: number | null }>('SELECT role, required, arrived FROM staffing WHERE event_id = ?', ev.id),
    shiftCost: getSettings().staffShiftCost,
    manual: all<{ category: keyof typeof COST_CATEGORY; amount: number }>('SELECT category, amount FROM event_costs WHERE event_id = ?', ev.id),
  });
  return { ...breakdown, food };
}

costsRoutes.get('/events/:id/costs', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'finance', 1);
  marginsOnly(user);
  return c.json({
    ...costsFor(ev),
    manual: camelAll(all('SELECT x.*, u.name AS created_by_name FROM event_costs x LEFT JOIN users u ON u.id = x.created_by WHERE x.event_id = ? ORDER BY x.id', ev.id)),
    targetPct: getSettings().foodCostTargetPct,
  });
});

const costSchema = z.object({
  category: z.enum(Object.keys(COST_CATEGORY) as [keyof typeof COST_CATEGORY, ...(keyof typeof COST_CATEGORY)[]]),
  label: zText(120).min(2, 'נדרש תיאור'),
  amount: zAgorot.refine((v) => v > 0, 'נדרש סכום'),
  note: zText(500).default(''),
});

costsRoutes.post('/events/:id/costs', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'finance', 2);
  marginsOnly(user);
  const b = await body(c, costSchema);
  const id = insert('event_costs', { event_id: ev.id, category: b.category, label: b.label, amount: b.amount, note: b.note, created_by: user.id, created_at: nowISO() });
  audit({ entity: 'cost', entityId: id, eventId: ev.id, userId: user.id, action: 'created', summary: `${COST_CATEGORY[b.category]}: ${b.label} ${formatMoney(b.amount)}` });
  publish({ topic: 'finance', eventId: ev.id });
  return c.json({ id }, 201);
});

costsRoutes.delete('/events/:id/costs/:costId', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'finance', 2);
  marginsOnly(user);
  const row = get<{ label: string; amount: number }>('SELECT label, amount FROM event_costs WHERE id = ? AND event_id = ?', intParam(c, 'costId'), ev.id);
  if (!row) throw notFound('העלות');
  run('DELETE FROM event_costs WHERE id = ?', intParam(c, 'costId'));
  audit({ entity: 'cost', entityId: intParam(c, 'costId'), eventId: ev.id, userId: user.id, action: 'deleted', summary: `${row.label} ${formatMoney(row.amount)}` });
  publish({ topic: 'finance', eventId: ev.id });
  return c.json({ ok: true });
});

/** Profitability across events in a date range. */
costsRoutes.get('/profitability', (c) => {
  const user = requireAny(c, 'finance', 1);
  marginsOnly(user);
  const from = c.req.query('from') ?? addDays(today(), -60);
  const to = c.req.query('to') ?? addDays(today(), 60);
  const vf = venueFilter(user);
  const rows = all(`SELECT e.*, c.name AS client_name FROM events e LEFT JOIN clients c ON c.id = e.client_id
                     WHERE ${vf.sql} AND e.date BETWEEN ? AND ? AND e.lifecycle != 'cancelled' AND e.sales_status IN ('signed','hall') ORDER BY e.date`, ...vf.params, from, to);
  const target = getSettings().foodCostTargetPct;
  const items = rows.map((r) => {
    const ev = camel<EventRecord & { clientName: string | null }>(r);
    const k = costsFor(ev);
    return {
      eventId: ev.id, title: ev.title, clientName: ev.clientName, venue: ev.venue, date: ev.date, guests: ev.guests, lifecycle: ev.lifecycle,
      revenue: k.revenue, estimate: k.estimate.total, actual: k.actual.total, profitEstimate: k.profitEstimate, profitActual: k.profitActual,
      foodPct: k.foodPct, overTarget: k.foodPct !== null && k.foodPct > target, unpriced: k.unpriced,
    };
  });
  const totals = items.reduce((t, i) => ({ revenue: t.revenue + (i.revenue ?? 0), actual: t.actual + i.actual, profit: t.profit + (i.profitActual ?? 0) }), { revenue: 0, actual: 0, profit: 0 });
  return c.json({ from, to, target, items, totals });
});

/** Cost per portion for every dish (for pricing and menu engineering). */
costsRoutes.get('/dish-costs', (c) => {
  const user = requireAny(c, 'catalog', 1);
  marginsOnly(user);
  const lines = all<{ dish_id: number; qty: number; unit_cost: number }>('SELECT r.dish_id, r.qty, i.unit_cost FROM recipe_lines r JOIN items i ON i.id = r.item_id');
  const dishes = all<{ id: number; yield_portions: number }>('SELECT id, yield_portions FROM dishes');
  const out: Record<number, { perPortion: number; unpriced: number }> = {};
  for (const d of dishes) {
    const ls = lines.filter((l) => l.dish_id === d.id);
    out[d.id] = { perPortion: dishPortionCost(d.yield_portions, ls.map((l) => ({ qty: l.qty, unitCost: l.unit_cost }))), unpriced: ls.filter((l) => l.unit_cost <= 0).length };
  }
  return c.json(out);
});

// ---------------------------------------------------------------- supplier invoices (payables)

export const PAYABLE_STATUS = { open: 'פתוחה', partial: 'שולמה חלקית', paid: 'שולמה', cancelled: 'בוטלה' } as const;

const invoiceSql = `SELECT v.*, s.name AS supplier_name, u.name AS created_by_name FROM supplier_invoices v
  JOIN suppliers s ON s.id = v.supplier_id LEFT JOIN users u ON u.id = v.created_by`;

costsRoutes.get('/payables', (c) => {
  marginsOnly(requireAny(c, 'finance', 1));
  const status = c.req.query('status') ?? 'open';
  const where = status === 'open' ? "v.status IN ('open','partial')" : status === 'all' ? '1 = 1' : 'v.status = ?';
  const items = camelAll<{ amount: number; paid: number; dueDate: string; status: string }>(all(`${invoiceSql} WHERE ${where} ORDER BY v.due_date, v.id`, ...(status !== 'open' && status !== 'all' ? [status] : [])));
  const t = today();
  const open = items.filter((i) => i.status === 'open' || i.status === 'partial');
  return c.json({
    items: items.map((i) => ({ ...i, balance: i.amount - i.paid, overdue: (i.status === 'open' || i.status === 'partial') && i.dueDate < t })),
    totals: { balance: open.reduce((a, i) => a + i.amount - i.paid, 0), overdue: open.filter((i) => i.dueDate < t).reduce((a, i) => a + i.amount - i.paid, 0) },
  });
});

const invoiceSchema = z.object({
  supplierId: zId,
  poId: zId.nullable().default(null),
  number: zText(60).default(''),
  date: zDate,
  dueDate: zDate,
  amount: zAgorot.refine((v) => v > 0, 'נדרש סכום'),
  notes: zText(1000).default(''),
});

costsRoutes.post('/payables', async (c) => {
  const user = requireAny(c, 'finance', 2);
  marginsOnly(user);
  const b = await body(c, invoiceSchema);
  if (b.dueDate < b.date) throw invalid('תאריך התשלום לפני תאריך החשבונית', { fields: { dueDate: 'לפני תאריך החשבונית' } });
  if (!get('SELECT 1 FROM suppliers WHERE id = ?', b.supplierId)) throw invalid('ספק לא קיים', { fields: { supplierId: 'ספק לא קיים' } });
  if (b.poId && !get('SELECT 1 FROM purchase_orders WHERE id = ? AND supplier_id = ?', b.poId, b.supplierId)) throw invalid('ההזמנה לא שייכת לספק הזה', { fields: { poId: 'לא של הספק' } });
  if (b.number && get('SELECT 1 FROM supplier_invoices WHERE supplier_id = ? AND number = ? AND status != \'cancelled\'', b.supplierId, b.number)) {
    throw invalid('חשבונית עם מספר זה כבר נרשמה לספק', { fields: { number: 'כבר קיימת' } });
  }
  const id = insert('supplier_invoices', { supplier_id: b.supplierId, po_id: b.poId, number: b.number, date: b.date, due_date: b.dueDate, amount: b.amount, notes: b.notes, created_by: user.id, created_at: nowISO() });
  audit({ entity: 'payable', entityId: id, userId: user.id, action: 'created', summary: `חשבונית ספק ${b.number || `#${id}`} ${formatMoney(b.amount)}` });
  publish({ topic: 'finance' });
  return c.json({ id }, 201);
});

costsRoutes.patch('/payables/:id', async (c) => {
  const user = requireAny(c, 'finance', 2);
  marginsOnly(user);
  const id = intParam(c);
  const b = await body(c, z.object({
    changes: z.object({ number: zText(60), date: zDate, dueDate: zDate, amount: zAgorot.refine((v) => v > 0, 'נדרש סכום'), notes: zText(1000) }).partial(),
    base: z.record(z.string(), z.unknown()),
  }));
  const res = patchRow<Record<string, unknown>>('supplier_invoices', id, b, ['number', 'date', 'dueDate', 'amount', 'notes']);
  audit({ entity: 'payable', entityId: id, userId: user.id, action: 'updated', diff: b.changes as Record<string, unknown> });
  publish({ topic: 'finance' });
  return c.json({ changed: res.changed });
});

costsRoutes.post('/payables/:id/pay', async (c) => {
  const user = requireAny(c, 'finance', 2);
  marginsOnly(user);
  const id = intParam(c);
  const b = await body(c, z.object({ amount: zAgorot.refine((v) => v > 0, 'נדרש סכום'), date: zDate.optional() }));
  const inv = get<{ amount: number; paid: number; status: string }>('SELECT amount, paid, status FROM supplier_invoices WHERE id = ?', id);
  if (!inv) throw notFound('החשבונית');
  if (inv.status === 'paid' || inv.status === 'cancelled') throw invalid('החשבונית אינה פתוחה לתשלום');
  if (inv.paid + b.amount > inv.amount) throw invalid(`הסכום גבוה מהיתרה (${formatMoney(inv.amount - inv.paid)})`, { fields: { amount: 'גבוה מהיתרה' } });
  const paid = inv.paid + b.amount;
  run('UPDATE supplier_invoices SET paid = ?, status = ?, paid_at = ?, version = version + 1 WHERE id = ?', paid, paid >= inv.amount ? 'paid' : 'partial', b.date ?? today(), id);
  audit({ entity: 'payable', entityId: id, userId: user.id, action: 'paid', summary: `שולם ${formatMoney(b.amount)}` });
  publish({ topic: 'finance' });
  return c.json({ ok: true });
});

costsRoutes.post('/payables/:id/cancel', async (c) => {
  const user = requireAny(c, 'finance', 3);
  const id = intParam(c);
  const b = await body(c, z.object({ reason: zText(500).min(2, 'נדרשת סיבה') }));
  const r = run("UPDATE supplier_invoices SET status = 'cancelled', version = version + 1 WHERE id = ? AND paid = 0", id);
  if (!r.changes) throw invalid('לא ניתן לבטל חשבונית ששולמה (או שאינה קיימת)');
  audit({ entity: 'payable', entityId: id, userId: user.id, action: 'cancelled', summary: b.reason });
  publish({ topic: 'finance' });
  return c.json({ ok: true });
});
