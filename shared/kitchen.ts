/**
 * Kitchen calculation engine: guests → portions → raw materials, weekly load, and the
 * impact of a guest-count change. Pure functions, no I/O.
 */
import type { Audience, EventType } from './domain.ts';

/** Round a quantity to 3 decimals to avoid float noise (quantities, not money). */
export const q = (n: number): number => Math.round(n * 1000) / 1000;

export interface GuestCounts {
  guests: number;
  kids: number;
  vegetarian: number;
  vegan: number;
}

export interface KitchenFactors {
  /** Safety buffer in percent added to computed portions. */
  bufferPct: number;
  /** Multiplier per event type (e.g. a conference eats less than a wedding). */
  typeFactor: Partial<Record<EventType, number>>;
}

export const DEFAULT_FACTORS: KitchenFactors = {
  bufferPct: 5,
  typeFactor: { wedding: 1, bar_mitzvah: 1, conference: 0.8, corporate: 0.9, birthday: 1, catering: 1, platters: 1, private: 1, other: 1 },
};

export interface MenuLineCalc {
  dishId: number;
  audience: Audience;
  /** Portions per person in the audience (1 = one portion each, 0.5 = half the guests take it). */
  perGuest: number;
  /** Fixed number of portions set explicitly (overrides the formula). */
  qtyOverride: number | null;
}

export function audienceCount(c: GuestCounts, a: Audience): number {
  switch (a) {
    case 'all': return c.guests;
    case 'adults': return Math.max(0, c.guests - c.kids);
    case 'kids': return c.kids;
    case 'veg': return c.vegetarian;
    case 'vegan': return c.vegan;
  }
}

export function portionsFor(line: MenuLineCalc, counts: GuestCounts, eventType: EventType, f: KitchenFactors = DEFAULT_FACTORS): number {
  if (line.qtyOverride !== null && line.qtyOverride !== undefined) return Math.max(0, Math.round(line.qtyOverride));
  const base = audienceCount(counts, line.audience) * line.perGuest;
  const factor = f.typeFactor[eventType] ?? 1;
  return Math.ceil(q(base * factor * (1 + f.bufferPct / 100)));
}

export interface RecipeLine {
  itemId: number;
  itemName: string;
  unit: string;
  /** Quantity of the item needed for `yieldPortions` portions. */
  qty: number;
}
export interface Recipe {
  dishId: number;
  yieldPortions: number;
  lines: RecipeLine[];
}

export interface RawNeed {
  itemId: number;
  itemName: string;
  unit: string;
  qty: number;
  byDish: { dishId: number; qty: number }[];
}

/** Sum raw materials for a set of (dish, portions). Dishes without a recipe are reported separately. */
export function rawMaterials(
  dishPortions: { dishId: number; portions: number }[],
  recipes: Map<number, Recipe>,
): { needs: RawNeed[]; missingRecipes: number[] } {
  const acc = new Map<number, RawNeed>();
  const missing = new Set<number>();
  for (const { dishId, portions } of dishPortions) {
    const r = recipes.get(dishId);
    if (!r || r.yieldPortions <= 0 || r.lines.length === 0) {
      if (portions > 0) missing.add(dishId);
      continue;
    }
    for (const l of r.lines) {
      const need = q((portions / r.yieldPortions) * l.qty);
      const cur = acc.get(l.itemId) ?? { itemId: l.itemId, itemName: l.itemName, unit: l.unit, qty: 0, byDish: [] };
      cur.qty = q(cur.qty + need);
      cur.byDish.push({ dishId, qty: need });
      acc.set(l.itemId, cur);
    }
  }
  return { needs: [...acc.values()].sort((a, b) => a.itemName.localeCompare(b.itemName, 'he')), missingRecipes: [...missing] };
}

export interface WeekEventInput {
  eventId: number;
  title: string;
  date: string;
  lines: { dishId: number; dishName: string; portions: number }[];
}
export interface WeekDishLoad {
  dishId: number;
  dishName: string;
  total: number;
  byEvent: { eventId: number; title: string; date: string; portions: number }[];
}

/** Weekly view: total portions per dish plus the per-event breakdown. */
export function weeklyLoad(events: WeekEventInput[]): WeekDishLoad[] {
  const map = new Map<number, WeekDishLoad>();
  for (const e of events) {
    for (const l of e.lines) {
      if (l.portions <= 0) continue;
      const cur = map.get(l.dishId) ?? { dishId: l.dishId, dishName: l.dishName, total: 0, byEvent: [] };
      cur.total += l.portions;
      cur.byEvent.push({ eventId: e.eventId, title: e.title, date: e.date, portions: l.portions });
      map.set(l.dishId, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.dishName.localeCompare(b.dishName, 'he'));
}

export interface GuestChangeImpact {
  dishes: { dishId: number; before: number; after: number; delta: number }[];
  raw: { itemId: number; itemName: string; unit: string; before: number; after: number; delta: number }[];
}

/** What a change in guest counts does to the kitchen and to purchasing. */
export function guestChangeImpact(
  lines: MenuLineCalc[],
  before: GuestCounts,
  after: GuestCounts,
  eventType: EventType,
  recipes: Map<number, Recipe>,
  f: KitchenFactors = DEFAULT_FACTORS,
): GuestChangeImpact {
  const dishes = lines.map((l) => {
    const b = portionsFor(l, before, eventType, f);
    const a = portionsFor(l, after, eventType, f);
    return { dishId: l.dishId, before: b, after: a, delta: a - b };
  });
  const rb = rawMaterials(dishes.map((d) => ({ dishId: d.dishId, portions: d.before })), recipes).needs;
  const ra = rawMaterials(dishes.map((d) => ({ dishId: d.dishId, portions: d.after })), recipes).needs;
  const ids = new Set([...rb, ...ra].map((r) => r.itemId));
  const raw = [...ids].map((id) => {
    const b = rb.find((r) => r.itemId === id);
    const a = ra.find((r) => r.itemId === id);
    const ref = (a ?? b)!;
    return { itemId: id, itemName: ref.itemName, unit: ref.unit, before: b?.qty ?? 0, after: a?.qty ?? 0, delta: q((a?.qty ?? 0) - (b?.qty ?? 0)) };
  }).filter((r) => r.delta !== 0);
  return { dishes: dishes.filter((d) => d.delta !== 0), raw };
}
