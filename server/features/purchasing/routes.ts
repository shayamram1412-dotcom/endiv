/**
 * Purchasing: orders per supplier with a responsible person, partial receipts that update stock,
 * gap handling, and order suggestions from uncovered shortages.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camel, camelAll, forbidden, intParam, invalid, notFound, requireAny, requireAt, requireGlobal, type Ctx, zDate, zId, zPhone, zText, zTime, type AppEnv } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { nowISO, today } from '../../../shared/dates.ts';
import { q } from '../../../shared/kitchen.ts';
import { receiptGap } from '../../../shared/inventory.ts';
import { can } from '../../../shared/permissions.ts';
import { seesMargins, seesPrices } from '../../../shared/costing.ts';
import { warehouseScope, warehouseVenue } from '../../core/scope.ts';
import { canAt, type Level } from '../../../shared/permissions.ts';
import type { PurchaseOrderRecord, PoLineRecord, SupplierRecord } from '../../../shared/types.ts';
import { allocationFor, eventFor } from '../events/service.ts';
import { reconcileEvent, reconcilePurchaseOrder, sweep } from '../tasks/engine.ts';

export const purchasingRoutes = new Hono<AppEnv>();

/** An order belongs to its destination warehouse's venue (central warehouse → business-wide grants only). */
function orderFor(c: Ctx, id: number, level: Level): PurchaseOrderRecord {
  requireAny(c, 'purchasing', level);
  const po = loadOrder(id);
  const venue = po.warehouseId ? warehouseVenue(po.warehouseId)?.venue ?? null : null;
  const user = c.get('user');
  if (!canAt(user, 'purchasing', 1, venue)) throw notFound('ההזמנה');
  requireAt(c, 'purchasing', level, venue);
  // Prices only for those who buy or see margins.
  return seesPrices(user) ? po : { ...po, lines: po.lines.map((l) => ({ ...l, unitPrice: null })) };
}

function loadOrder(id: number): PurchaseOrderRecord {
  const row = get(
    `SELECT p.*, s.name AS supplier_name, w.name AS warehouse_name, u.name AS responsible_name
       FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN warehouses w ON w.id = p.warehouse_id LEFT JOIN users u ON u.id = p.responsible_id WHERE p.id = ?`, id,
  );
  if (!row) throw notFound('ההזמנה');
  const lines = all(
    `SELECT l.*, i.name AS item_name, i.unit, e.title AS event_title FROM po_lines l JOIN items i ON i.id = l.item_id
       LEFT JOIN events e ON e.id = l.event_id WHERE l.po_id = ? ORDER BY l.id`, id,
  ).map((r) => {
    const l = camel<PoLineRecord>(r);
    return { ...l, gap: receiptGap(l.qty, l.received).gap };
  });
  return { ...camel<PurchaseOrderRecord>(row), lines };
}

purchasingRoutes.get('/orders', (c) => {
  const user = requireAny(c, 'purchasing', 1);
  const status = c.req.query('status');
  const where = status === 'open' ? "p.status IN ('ordered','partial','draft')" : status ? 'p.status = ?' : '1 = 1';
  const ws = warehouseScope(user, 'w');
  const ids = all<{ id: number }>(`SELECT p.id FROM purchase_orders p JOIN warehouses w ON w.id = p.warehouse_id WHERE ${where} AND ${ws.sql} ORDER BY p.expected_date DESC, p.id DESC LIMIT 200`,
    ...(status && status !== 'open' ? [status] : []), ...ws.params);
  return c.json(ids.map((r) => orderFor(c, r.id, 1)));
});

purchasingRoutes.get('/orders/:id', (c) => c.json(orderFor(c, intParam(c), 1)));

const orderSchema = z.object({
  supplierId: zId,
  warehouseId: zId,
  responsibleId: zId.nullable(),
  expectedDate: zDate,
  expectedTime: zTime.default(''),
  notes: zText(2000).default(''),
  lines: z.array(z.object({ itemId: zId, qty: z.number().positive('כמות חייבת להיות חיובית'), eventId: zId.nullable().default(null), unitPrice: z.number().int().min(0).nullable().default(null) })).min(1, 'נדרשת לפחות שורה אחת'),
});

purchasingRoutes.post('/orders', async (c) => {
  const b = await body(c, orderSchema);
  if (!get('SELECT 1 FROM suppliers WHERE id = ? AND active = 1', b.supplierId)) throw invalid('ספק לא פעיל');
  const wh = get<{ venue: string | null }>('SELECT venue FROM warehouses WHERE id = ?', b.warehouseId);
  if (!wh) throw invalid('מחסן לא קיים');
  const user = requireAt(c, 'purchasing', 2, wh.venue);
  for (const l of b.lines) if (l.eventId) eventFor(user, l.eventId, 'events', 1);
  const id = tx(() => {
    const id = insert('purchase_orders', {
      supplier_id: b.supplierId, venue: wh.venue, warehouse_id: b.warehouseId, responsible_id: b.responsibleId ?? user.id,
      status: 'ordered', expected_date: b.expectedDate, expected_time: b.expectedTime, notes: b.notes, created_by: user.id, created_at: nowISO(),
    });
    // A line without a price takes the item's current price, so the order always has a value.
    for (const l of b.lines) {
      const price = l.unitPrice ?? get<{ unit_cost: number }>('SELECT unit_cost FROM items WHERE id = ?', l.itemId)?.unit_cost ?? null;
      insert('po_lines', { po_id: id, item_id: l.itemId, event_id: l.eventId, qty: l.qty, unit_price: price || null });
    }
    audit({ entity: 'po', entityId: id, userId: user.id, action: 'created', summary: `הזמנת רכש #${id} (${b.lines.length} שורות)` });
    return id;
  });
  if (b.expectedDate <= today()) sweep();
  for (const e of new Set(b.lines.map((l) => l.eventId).filter(Boolean))) reconcileEvent(e!);
  publish({ topic: 'purchasing' }, { topic: 'inventory' }, { topic: 'calendar' });
  return c.json({ id }, 201);
});

purchasingRoutes.post('/orders/:id/cancel', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const po = orderFor(c, id, 3);
  if (po.lines.some((l) => l.received > 0)) throw invalid('לא ניתן לבטל הזמנה שהתקבלה חלקית. סגור את הפער במקום.');
  const b = await body(c, z.object({ reason: zText(500).min(2, 'נדרשת סיבה') }));
  run("UPDATE purchase_orders SET status = 'cancelled', version = version + 1 WHERE id = ?", id);
  run("UPDATE tasks SET status = 'cancelled', evidence = ? WHERE ref_type = 'po' AND ref_id = ? AND status IN ('open','in_progress','blocked')", 'ההזמנה בוטלה', id);
  audit({ entity: 'po', entityId: id, userId: user.id, action: 'cancelled', summary: b.reason });
  for (const e of new Set(po.lines.map((l) => l.eventId).filter(Boolean))) reconcileEvent(e!);
  publish({ topic: 'purchasing' }, { topic: 'inventory' });
  return c.json({ ok: true });
});

/** Receive goods (fully or partially). Each received quantity enters stock immediately. */
purchasingRoutes.post('/orders/:id/receive', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const b = await body(c, z.object({
    lines: z.array(z.object({ lineId: zId, qty: z.number().min(0), note: zText(500).default('') })).min(1),
    receivedAt: z.string().optional(),
  }));
  const po = { ...orderFor(c, id, 2), lines: loadOrder(id).lines };
  if (po.status === 'cancelled' || po.status === 'received') throw invalid('ההזמנה אינה פתוחה לקבלה');
  if (!po.warehouseId) throw invalid('להזמנה לא הוגדר מחסן יעד');
  const at = b.receivedAt ? new Date(b.receivedAt).toISOString() : nowISO();
  tx(() => {
    for (const r of b.lines) {
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line) throw invalid('שורה לא שייכת להזמנה');
      if (r.qty <= 0) continue;
      insert('receipts', { po_line_id: line.id, qty: r.qty, received_by: user.id, at, note: r.note });
      run('UPDATE po_lines SET received = received + ? WHERE id = ?', r.qty, line.id);
      // The last price paid becomes the item's price for future estimates.
      if (line.unitPrice) run('UPDATE items SET unit_cost = ? WHERE id = ?', line.unitPrice, line.itemId);
      insert('stock_movements', { item_id: line.itemId, warehouse_id: po.warehouseId, qty: r.qty, kind: 'receipt', event_id: line.eventId, po_line_id: line.id, user_id: user.id, at, note: `הזמנה #${id}` });
      if (r.note) run('UPDATE po_lines SET gap_note = ? WHERE id = ?', r.note, line.id);
    }
    const lines = all<{ qty: number; received: number; gap_resolved: number }>('SELECT qty, received, gap_resolved FROM po_lines WHERE po_id = ?', id);
    const complete = lines.every((l) => l.received >= l.qty || l.gap_resolved);
    run('UPDATE purchase_orders SET status = ?, version = version + 1 WHERE id = ?', complete ? 'received' : 'partial', id);
    const got = b.lines.filter((l) => l.qty > 0).length;
    audit({ entity: 'po', entityId: id, userId: user.id, action: 'received', summary: `התקבלו ${got} שורות${complete ? ' – ההזמנה הושלמה' : ' – נותרו פערים'}` });
  });
  reconcilePurchaseOrder(id);
  for (const e of new Set(po.lines.map((l) => l.eventId).filter(Boolean))) reconcileEvent(e!);
  publish({ topic: 'purchasing' }, { topic: 'inventory' });
  return c.json(loadOrder(id));
});

/** Close the remaining gap of a line: supplier will not deliver / replaced elsewhere. The shortage stays visible in inventory. */
purchasingRoutes.post('/lines/:id/resolve', async (c) => {
  const user = c.get('user');
  const lineId = intParam(c);
  const b = await body(c, z.object({ note: zText(500).min(2, 'נדרש הסבר לטיפול בפער') }));
  const line = get<{ po_id: number; event_id: number | null }>('SELECT po_id, event_id FROM po_lines WHERE id = ?', lineId);
  if (!line) throw notFound('השורה');
  orderFor(c, line.po_id, 2);
  tx(() => {
    run('UPDATE po_lines SET gap_resolved = 1, gap_note = ? WHERE id = ?', b.note, lineId);
    const lines = all<{ qty: number; received: number; gap_resolved: number }>('SELECT qty, received, gap_resolved FROM po_lines WHERE po_id = ?', line.po_id);
    if (lines.every((l) => l.received >= l.qty || l.gap_resolved)) run("UPDATE purchase_orders SET status = 'received', version = version + 1 WHERE id = ?", line.po_id);
    audit({ entity: 'po', entityId: line.po_id, userId: user.id, action: 'gap_resolved', summary: b.note });
  });
  reconcilePurchaseOrder(line.po_id);
  if (line.event_id) reconcileEvent(line.event_id);
  publish({ topic: 'purchasing' }, { topic: 'inventory' });
  return c.json({ ok: true });
});

/** Suggested orders: uncovered shortages grouped by default supplier. */
purchasingRoutes.get('/suggestions', (c) => {
  const user = requireAny(c, 'purchasing', 1);
  const eventFilter = c.req.query('event') ? Number(c.req.query('event')) : null;
  const ws = warehouseScope(user, 'w');
  const pairs = all<{ item_id: number; warehouse_id: number; name: string; unit: string; supplier_id: number | null; supplier_name: string | null }>(
    `SELECT DISTINCT r.item_id, r.warehouse_id, i.name, i.unit, i.supplier_id, s.name AS supplier_name
       FROM requirements r JOIN items i ON i.id = r.item_id JOIN events e ON e.id = r.event_id LEFT JOIN suppliers s ON s.id = i.supplier_id
       JOIN warehouses w ON w.id = r.warehouse_id
      WHERE r.approved_at IS NOT NULL AND r.consumed = 0 AND e.lifecycle = 'planning' AND ${ws.sql} ${eventFilter ? 'AND r.event_id = ?' : ''}`,
    ...ws.params, ...(eventFilter ? [eventFilter] : []),
  );
  const groups = new Map<string, { supplierId: number | null; supplierName: string; warehouseId: number; neededBy: string; lines: { itemId: number; itemName: string; unit: string; qty: number; eventId: number | null; neededBy: string }[] }>();
  for (const p of pairs) {
    const a = allocationFor(p.item_id, p.warehouse_id);
    if (a.uncovered <= 0) continue;
    const firstShort = a.rows.find((r) => r.short > 0);
    const key = `${p.supplier_id ?? 0}|${p.warehouse_id}`;
    const g = groups.get(key) ?? { supplierId: p.supplier_id, supplierName: p.supplier_name ?? 'ללא ספק ברירת מחדל', warehouseId: p.warehouse_id, neededBy: firstShort?.date ?? today(), lines: [] };
    g.lines.push({ itemId: p.item_id, itemName: p.name, unit: p.unit, qty: q(a.uncovered), eventId: a.rows.filter((r) => r.short > 0).length === 1 ? firstShort?.eventId ?? null : null, neededBy: firstShort?.date ?? today() });
    if (firstShort && firstShort.date < g.neededBy) g.neededBy = firstShort.date;
    groups.set(key, g);
  }
  return c.json([...groups.values()]);
});

// ---------------------------------------------------------------- suppliers

purchasingRoutes.get('/suppliers', (c) => {
  // The supplier list is also needed by the catalog and by the accountant (supplier invoices).
  const u = c.get('user');
  if (!(can(u, 'purchasing', 1) || can(u, 'catalog', 1) || seesMargins(u))) throw forbidden();
  return c.json(camelAll<SupplierRecord>(all('SELECT * FROM suppliers ORDER BY active DESC, name')));
});

const supplierSchema = z.object({
  name: zText(120).min(2, 'נדרש שם ספק'),
  contact: zText(120).default(''),
  phone: zPhone.default(''),
  email: z.union([z.literal(''), z.email('מייל לא תקין')]).default(''),
  categories: zText(300).default(''),
  notes: zText(2000).default(''),
  active: z.boolean().default(true),
});

purchasingRoutes.post('/suppliers', async (c) => {
  const user = requireGlobal(c, 'purchasing', 2);
  const b = await body(c, supplierSchema);
  const id = insert('suppliers', b);
  audit({ entity: 'supplier', entityId: id, userId: user.id, action: 'created', summary: b.name });
  publish({ topic: 'purchasing' });
  return c.json({ id }, 201);
});

purchasingRoutes.put('/suppliers/:id', async (c) => {
  const user = requireGlobal(c, 'purchasing', 2);
  const id = intParam(c);
  const b = await body(c, supplierSchema);
  run('UPDATE suppliers SET name = ?, contact = ?, phone = ?, email = ?, categories = ?, notes = ?, active = ? WHERE id = ?', b.name, b.contact, b.phone, b.email, b.categories, b.notes, b.active, id);
  audit({ entity: 'supplier', entityId: id, userId: user.id, action: 'updated', summary: b.name });
  publish({ topic: 'purchasing' });
  return c.json({ ok: true });
});
