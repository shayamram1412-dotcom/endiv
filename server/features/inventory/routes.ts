/**
 * Inventory: balances per warehouse (movement ledger), reservations from approved requirements,
 * shortages, and manual movements (adjustment, count, transfer).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, tx } from '../../core/db.ts';
import { body, camelAll, intParam, invalid, notFound, requireAny, requireAt, zId, zText, type AppEnv, type Ctx } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { nowISO } from '../../../shared/dates.ts';
import { q } from '../../../shared/kitchen.ts';
import type { MovementRecord, StockRow } from '../../../shared/types.ts';
import { allocationFor, balance, eventFor } from '../events/service.ts';
import { maskAllocation, warehouseScope, warehouseVenue } from '../../core/scope.ts';
import { canAt, type Level } from '../../../shared/permissions.ts';
import { reconcileEvent } from '../tasks/engine.ts';

export const inventoryRoutes = new Hono<AppEnv>();

// A user limited to some venues sees those venues' warehouses only; the central warehouse needs an all-venue grant.

inventoryRoutes.get('/warehouses', (c) => {
  const user = requireAny(c, 'inventory', 1);
  const ws = warehouseScope(user, 'w');
  return c.json(camelAll(all(`SELECT w.*, v.name AS venue_name FROM warehouses w LEFT JOIN venues v ON v.code = w.venue WHERE ${ws.sql} ORDER BY w.venue IS NOT NULL, w.id`, ...ws.params)));
});

function warehouseAt(c: Ctx, id: number, level: Level) {
  requireAny(c, 'inventory', level);
  const w = warehouseVenue(id);
  if (!w) throw notFound('המחסן');
  if (!canAt(c.get('user'), 'inventory', 1, w.venue)) throw notFound('המחסן');
  return requireAt(c, 'inventory', level, w.venue);
}

inventoryRoutes.get('/stock', (c) => {
  const user = requireAny(c, 'inventory', 1);
  const qp = c.req.query();
  const ws = warehouseScope(user, 'w');
  const where: string[] = ['i.active = 1', ws.sql];
  const params: unknown[] = [...ws.params];
  if (qp.warehouse) { where.push('w.id = ?'); params.push(Number(qp.warehouse)); }
  if (qp.kind) { where.push('i.kind = ?'); params.push(qp.kind); }
  if (qp.q) { where.push('i.name LIKE ?'); params.push(`%${qp.q}%`); }
  // Item × warehouse pairs that have any movement, reservation or open order.
  const rows = all<{ item_id: number; name: string; unit: string; kind: never; category: string; min_stock: number; warehouse_id: number; warehouse_name: string }>(
    `SELECT DISTINCT i.id AS item_id, i.name, i.unit, i.kind, i.category, i.min_stock, w.id AS warehouse_id, w.name AS warehouse_name
       FROM items i CROSS JOIN warehouses w
      WHERE ${where.join(' AND ')} AND (
        EXISTS (SELECT 1 FROM stock_movements m WHERE m.item_id = i.id AND m.warehouse_id = w.id)
        OR EXISTS (SELECT 1 FROM requirements r WHERE r.item_id = i.id AND r.warehouse_id = w.id AND r.consumed = 0)
        OR EXISTS (SELECT 1 FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id WHERE l.item_id = i.id AND p.warehouse_id = w.id AND p.status IN ('ordered','partial')))
      ORDER BY i.name, w.id`,
    ...params,
  );
  const out: StockRow[] = rows.map((r) => {
    const a = allocationFor(r.item_id, r.warehouse_id);
    return {
      itemId: r.item_id, itemName: r.name, unit: r.unit, kind: r.kind, category: r.category,
      warehouseId: r.warehouse_id, warehouseName: r.warehouse_name,
      balance: a.balance, reserved: a.totalNeed, incoming: a.incoming, available: q(a.balance - a.totalNeed), minStock: r.min_stock,
    };
  });
  return c.json(qp.short === '1' ? out.filter((r) => r.available < 0) : out);
});

/** Items whose approved demand exceeds the physical balance, with per-event allocation. */
inventoryRoutes.get('/shortages', (c) => {
  const user = requireAny(c, 'inventory', 1);
  const ws = warehouseScope(user, 'w');
  const pairs = all<{ item_id: number; warehouse_id: number; name: string; unit: string; supplier_id: number | null; supplier_name: string | null; warehouse_name: string }>(
    `SELECT DISTINCT r.item_id, r.warehouse_id, i.name, i.unit, i.supplier_id, s.name AS supplier_name, w.name AS warehouse_name
       FROM requirements r JOIN items i ON i.id = r.item_id JOIN events e ON e.id = r.event_id JOIN warehouses w ON w.id = r.warehouse_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE r.approved_at IS NOT NULL AND r.consumed = 0 AND e.lifecycle = 'planning' AND ${ws.sql}`, ...ws.params,
  );
  const out = pairs.map((p) => ({
    itemId: p.item_id, itemName: p.name, unit: p.unit, warehouseId: p.warehouse_id, warehouseName: p.warehouse_name,
    supplierId: p.supplier_id, supplierName: p.supplier_name, allocation: maskAllocation(user, allocationFor(p.item_id, p.warehouse_id)),
  })).filter((x) => x.allocation.shortage > 0)
    .sort((a, b) => (a.allocation.rows.find((r) => r.short > 0)?.date ?? '').localeCompare(b.allocation.rows.find((r) => r.short > 0)?.date ?? ''));
  return c.json(out);
});

inventoryRoutes.get('/items/:id/allocation', (c) => {
  const wh = Number(c.req.query('warehouse'));
  if (!wh) throw invalid('נדרש מחסן');
  const user = warehouseAt(c, wh, 1);
  return c.json(maskAllocation(user, allocationFor(intParam(c), wh)));
});

inventoryRoutes.get('/movements', (c) => {
  const user = requireAny(c, 'inventory', 1);
  const qp = c.req.query();
  const ws = warehouseScope(user, 'w');
  const where: string[] = [ws.sql];
  const params: unknown[] = [...ws.params];
  if (qp.item) { where.push('m.item_id = ?'); params.push(Number(qp.item)); }
  if (qp.warehouse) { where.push('m.warehouse_id = ?'); params.push(Number(qp.warehouse)); }
  if (qp.event) { where.push('m.event_id = ?'); params.push(Number(qp.event)); }
  const rows = all(
    `SELECT m.*, i.name AS item_name, i.unit, w.name AS warehouse_name, e.title AS event_title, u.name AS user_name
       FROM stock_movements m JOIN items i ON i.id = m.item_id JOIN warehouses w ON w.id = m.warehouse_id
       LEFT JOIN events e ON e.id = m.event_id LEFT JOIN users u ON u.id = m.user_id
      WHERE ${where.join(' AND ')} ORDER BY m.at DESC, m.id DESC LIMIT 300`,
    ...params,
  );
  return c.json(camelAll<MovementRecord>(rows));
});

const movementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('adjustment'), itemId: zId, warehouseId: zId, qty: z.number().finite().refine((v) => v !== 0, 'כמות לא יכולה להיות 0'), note: zText(500).min(2, 'נדרשת סיבה') }),
  z.object({ kind: z.literal('count'), itemId: zId, warehouseId: zId, counted: z.number().finite().min(0), note: zText(500).default('ספירת מלאי') }),
  z.object({ kind: z.literal('transfer'), itemId: zId, warehouseId: zId, toWarehouseId: zId, qty: z.number().positive('כמות חייבת להיות חיובית'), note: zText(500).default('') }),
  z.object({ kind: z.literal('consumption'), itemId: zId, warehouseId: zId, qty: z.number().positive(), eventId: zId.nullable().default(null), note: zText(500).default('') }),
]);

inventoryRoutes.post('/movements', async (c) => {
  const b = await body(c, movementSchema);
  const user = warehouseAt(c, b.warehouseId, 2);
  if (b.kind === 'transfer') warehouseAt(c, b.toWarehouseId, 2);
  if (b.kind === 'consumption' && b.eventId) eventFor(user, b.eventId, 'inventory', 2);
  const at = nowISO();
  const affectedEvents = new Set<number>();
  tx(() => {
    const base = { item_id: b.itemId, user_id: user.id, at };
    if (b.kind === 'adjustment') {
      insert('stock_movements', { ...base, warehouse_id: b.warehouseId, qty: b.qty, kind: 'adjustment', note: b.note });
    } else if (b.kind === 'count') {
      const delta = q(b.counted - balance(b.itemId, b.warehouseId));
      if (delta !== 0) insert('stock_movements', { ...base, warehouse_id: b.warehouseId, qty: delta, kind: 'count', note: `${b.note} (נספר ${b.counted})` });
    } else if (b.kind === 'transfer') {
      if (b.toWarehouseId === b.warehouseId) throw invalid('מחסן היעד זהה למקור');
      const bal = balance(b.itemId, b.warehouseId);
      if (bal < b.qty) throw invalid(`אין מספיק מלאי להעברה (יתרה ${bal})`, { fields: { qty: `יתרה ${bal}` } });
      insert('stock_movements', { ...base, warehouse_id: b.warehouseId, qty: -b.qty, kind: 'transfer_out', note: b.note });
      insert('stock_movements', { ...base, warehouse_id: b.toWarehouseId, qty: b.qty, kind: 'transfer_in', note: b.note });
    } else {
      insert('stock_movements', { ...base, warehouse_id: b.warehouseId, qty: -b.qty, kind: 'consumption', event_id: b.eventId, note: b.note });
    }
    const item = get<{ name: string }>('SELECT name FROM items WHERE id = ?', b.itemId);
    audit({ entity: 'stock', entityId: b.itemId, userId: user.id, action: `movement:${b.kind}`, summary: `${item?.name ?? ''}: ${b.kind}` });
    for (const r of all<{ event_id: number }>('SELECT DISTINCT event_id FROM requirements WHERE item_id = ? AND consumed = 0', b.itemId)) affectedEvents.add(r.event_id);
  });
  for (const id of affectedEvents) reconcileEvent(id);
  publish({ topic: 'inventory' });
  return c.json({ ok: true }, 201);
});
