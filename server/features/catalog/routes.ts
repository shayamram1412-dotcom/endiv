/** Catalog: dishes with recipes (yield → raw materials), stock items, equipment templates per venue. */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camel, camelAll, intParam, invalid, notFound, requireAny, requireAt, requireGlobal, zId, zText, zVenueCode, type AppEnv } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { seesPrices } from '../../../shared/costing.ts';
import { venueFilter } from '../events/service.ts';
import { publish } from '../../core/realtime.ts';
import { ITEM_KIND, VENUE_CODES } from '../../../shared/domain.ts';
import type { DishRecord, ItemRecord } from '../../../shared/types.ts';

export const catalogRoutes = new Hono<AppEnv>();

function dishWithRecipe(id: number): DishRecord {
  const d = get('SELECT * FROM dishes WHERE id = ?', id);
  if (!d) throw notFound('המנה');
  const recipe = all<{ item_id: number; name: string; unit: string; qty: number }>(
    'SELECT r.item_id, i.name, i.unit, r.qty FROM recipe_lines r JOIN items i ON i.id = r.item_id WHERE r.dish_id = ? ORDER BY i.name', id,
  ).map((r) => ({ itemId: r.item_id, itemName: r.name, unit: r.unit, qty: r.qty }));
  return { ...camel<DishRecord>(d), recipe };
}

catalogRoutes.get('/dishes', (c) => {
  requireAny(c, 'catalog', 1);
  const rows = all(
    `SELECT d.*, (SELECT COUNT(*) FROM recipe_lines r WHERE r.dish_id = d.id) AS recipe_lines FROM dishes d
      ORDER BY d.active DESC, d.category, d.name`,
  );
  return c.json(camelAll<DishRecord & { recipeLines: number }>(rows));
});

catalogRoutes.get('/dishes/:id', (c) => {
  requireAny(c, 'catalog', 1);
  return c.json(dishWithRecipe(intParam(c)));
});

const dishSchema = z.object({
  name: zText(120).min(2, 'נדרש שם מנה'),
  category: zText(60).min(1, 'נדרשת קטגוריה'),
  description: zText(1000).default(''),
  allergens: zText(300).default(''),
  isVegetarian: z.boolean().default(false),
  isVegan: z.boolean().default(false),
  defaultPerGuest: z.number().min(0).max(20),
  yieldPortions: z.number().positive('תפוקה חייבת להיות חיובית').max(10000),
  prepLeadDays: z.number().int().min(0).max(14).default(0),
  active: z.boolean().default(true),
  recipe: z.array(z.object({ itemId: zId, qty: z.number().positive('כמות חייבת להיות חיובית') })).default([]),
});

function saveRecipe(dishId: number, recipe: { itemId: number; qty: number }[]) {
  const ids = new Set<number>();
  for (const r of recipe) {
    if (ids.has(r.itemId)) throw invalid('פריט מופיע פעמיים במתכון');
    ids.add(r.itemId);
  }
  run('DELETE FROM recipe_lines WHERE dish_id = ?', dishId);
  for (const r of recipe) insert('recipe_lines', { dish_id: dishId, item_id: r.itemId, qty: r.qty });
}

catalogRoutes.post('/dishes', async (c) => {
  const user = requireGlobal(c, 'catalog', 2);
  const b = await body(c, dishSchema);
  const id = tx(() => {
    const id = insert('dishes', {
      name: b.name, category: b.category, description: b.description, allergens: b.allergens, is_vegetarian: b.isVegetarian, is_vegan: b.isVegan,
      default_per_guest: b.defaultPerGuest, yield_portions: b.yieldPortions, prep_lead_days: b.prepLeadDays, active: b.active,
    });
    saveRecipe(id, b.recipe);
    audit({ entity: 'dish', entityId: id, userId: user.id, action: 'created', summary: b.name });
    return id;
  });
  publish({ topic: 'catalog' });
  return c.json(dishWithRecipe(id), 201);
});

catalogRoutes.put('/dishes/:id', async (c) => {
  const user = requireGlobal(c, 'catalog', 2);
  const id = intParam(c);
  const b = await body(c, dishSchema.extend({ version: z.number().int() }));
  tx(() => {
    const r = run(
      `UPDATE dishes SET name = ?, category = ?, description = ?, allergens = ?, is_vegetarian = ?, is_vegan = ?, default_per_guest = ?,
         yield_portions = ?, prep_lead_days = ?, active = ?, version = version + 1 WHERE id = ? AND version = ?`,
      b.name, b.category, b.description, b.allergens, b.isVegetarian, b.isVegan, b.defaultPerGuest, b.yieldPortions, b.prepLeadDays, b.active, id, b.version,
    );
    if (!r.changes) throw invalid('המנה עודכנה בינתיים על ידי משתמש אחר. רענן ונסה שוב.');
    saveRecipe(id, b.recipe);
    audit({ entity: 'dish', entityId: id, userId: user.id, action: 'updated', summary: b.name });
  });
  publish({ topic: 'catalog' });
  return c.json(dishWithRecipe(id));
});

// ---------------------------------------------------------------- items

catalogRoutes.get('/items', (c) => {
  const user = requireAny(c, 'events', 1);
  const rows = all('SELECT i.*, s.name AS supplier_name FROM items i LEFT JOIN suppliers s ON s.id = i.supplier_id ORDER BY i.active DESC, i.kind, i.name');
  // Purchase prices only for buyers, the kitchen and management.
  const items = camelAll<ItemRecord>(rows);
  return c.json(seesPrices(user) ? items : items.map((i) => ({ ...i, unitCost: 0 })));
});

const itemSchema = z.object({
  name: zText(120).min(2, 'נדרש שם פריט'),
  kind: z.enum(Object.keys(ITEM_KIND) as [keyof typeof ITEM_KIND, ...(keyof typeof ITEM_KIND)[]]),
  unit: zText(20).min(1, 'נדרשת יחידה'),
  category: zText(60).default(''),
  supplierId: zId.nullable().default(null),
  minStock: z.number().min(0).default(0),
  unitCost: z.number().int('מחיר באגורות').min(0).max(100_000_000).default(0),
  ownedQty: z.number().min(0).default(0),
  active: z.boolean().default(true),
});

catalogRoutes.post('/items', async (c) => {
  const user = requireGlobal(c, 'catalog', 2);
  const b = await body(c, itemSchema);
  if (get('SELECT 1 FROM items WHERE name = ? AND kind = ?', b.name, b.kind)) throw invalid('פריט בשם זה כבר קיים', { fields: { name: 'כבר קיים' } });
  const id = insert('items', { name: b.name, kind: b.kind, unit: b.unit, category: b.category, supplier_id: b.supplierId, min_stock: b.minStock, unit_cost: b.unitCost, owned_qty: b.ownedQty, active: b.active });
  audit({ entity: 'item', entityId: id, userId: user.id, action: 'created', summary: b.name });
  publish({ topic: 'catalog' });
  return c.json({ id }, 201);
});

catalogRoutes.put('/items/:id', async (c) => {
  const user = requireGlobal(c, 'catalog', 2);
  const id = intParam(c);
  const b = await body(c, itemSchema);
  run('UPDATE items SET name = ?, kind = ?, unit = ?, category = ?, supplier_id = ?, min_stock = ?, unit_cost = ?, owned_qty = ?, active = ? WHERE id = ?', b.name, b.kind, b.unit, b.category, b.supplierId, b.minStock, b.unitCost, b.ownedQty, b.active, id);
  audit({ entity: 'item', entityId: id, userId: user.id, action: 'updated', summary: b.name });
  publish({ topic: 'catalog' }, { topic: 'inventory' });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- equipment templates

catalogRoutes.get('/equipment-templates', (c) => {
  const user = requireAny(c, 'equipment', 1);
  const vf = venueFilter(user, 't.venue');
  return c.json(camelAll(all(
    `SELECT t.*, i.name AS item_name, i.unit, i.kind FROM equipment_templates t JOIN items i ON i.id = t.item_id WHERE ${vf.sql} ORDER BY t.venue, t.event_type, i.name`, ...vf.params,
  )));
});

catalogRoutes.post('/equipment-templates', async (c) => {
  const b = await body(c, z.object({
    venue: zVenueCode,
    eventType: zText(30).default('*'),
    itemId: zId,
    perGuest: z.number().min(0).default(0),
    fixedQty: z.number().min(0).default(0),
  }).refine((v) => v.perGuest > 0 || v.fixedQty > 0, { message: 'נדרשת כמות לאורח או כמות קבועה', path: ['perGuest'] }));
  const user = requireAt(c, 'equipment', 3, b.venue);
  const id = insert('equipment_templates', { venue: b.venue, event_type: b.eventType, item_id: b.itemId, per_guest: b.perGuest, fixed_qty: b.fixedQty });
  audit({ entity: 'equipment_template', entityId: id, userId: user.id, action: 'created' });
  return c.json({ id }, 201);
});

catalogRoutes.delete('/equipment-templates/:id', (c) => {
  const t = get<{ venue: string }>('SELECT venue FROM equipment_templates WHERE id = ?', intParam(c));
  if (!t) throw notFound('השורה');
  requireAt(c, 'equipment', 3, t.venue);
  run('DELETE FROM equipment_templates WHERE id = ?', intParam(c));
  return c.json({ ok: true });
});
