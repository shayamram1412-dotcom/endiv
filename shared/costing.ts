/**
 * Event profitability: revenue vs. food, rentals, staff and other costs.
 * Estimate = from the plan (menu × recipe × item price, equipment lines, staffing × shift cost).
 * Actual  = from what really happened (purchase lines for the event, staff who arrived, costs entered by hand).
 * All money in integer agorot; quantities are floats, so every product is rounded once to whole agorot.
 */
import type { Agorot } from './money.ts';
import type { StaffRole } from './domain.ts';
import { can, canGlobal, isSupervisor, type Principal } from './permissions.ts';

/** Margins are internal: management and the accountant only. */
export const seesMargins = (p: Principal): boolean => isSupervisor(p) || canGlobal(p, 'finance', 3);
/** Purchase prices: margins viewers, buyers and the kitchen (who cost recipes). */
export const seesPrices = (p: Principal): boolean => seesMargins(p) || can(p, 'purchasing', 2) || can(p, 'catalog', 2);

export const COST_CATEGORY = {
  food: 'אוכל וחומרי גלם',
  rentals: 'השכרות וציוד',
  staff: 'צוות',
  transport: 'הובלה',
  other: 'אחר',
} as const;
export type CostCategory = keyof typeof COST_CATEGORY;

/** Price × quantity, rounded once to whole agorot. */
export const lineCost = (unitCost: Agorot, qty: number): Agorot => Math.round(unitCost * qty);

export interface CostInputs {
  revenue: Agorot | null;
  /** Raw materials needed by the plan, each with the item's price per unit. */
  foodNeeds: { qty: number; unitCost: Agorot }[];
  /** Purchase lines tied to this event: received quantity × price on the line (or the item price). */
  purchases: { received: number; unitPrice: Agorot | null; itemCost: Agorot }[];
  equipment: { planned: number; unitCost: Agorot }[];
  staffing: { role: StaffRole; required: number; arrived: number | null }[];
  shiftCost: Partial<Record<StaffRole, Agorot>>;
  manual: { category: CostCategory; amount: Agorot }[];
}

export interface CostBreakdown {
  estimate: Record<CostCategory, Agorot> & { total: Agorot };
  actual: Record<CostCategory, Agorot> & { total: Agorot };
  revenue: Agorot | null;
  /** Revenue minus cost; null when there is no revenue yet. */
  profitEstimate: Agorot | null;
  profitActual: Agorot | null;
  /** Food cost as a percent of revenue (0–100, one decimal). */
  foodPct: number | null;
  /** Items in the plan with no price — the estimate is too low until they are priced. */
  unpriced: number;
}

const zero = (): Record<CostCategory, Agorot> => ({ food: 0, rentals: 0, staff: 0, transport: 0, other: 0 });
const sum = (r: Record<CostCategory, Agorot>) => Object.values(r).reduce((a, b) => a + b, 0);

export function eventCosts(i: CostInputs): CostBreakdown {
  const est = zero();
  const act = zero();
  for (const n of i.foodNeeds) est.food += lineCost(n.unitCost, n.qty);
  for (const p of i.purchases) act.food += lineCost(p.unitPrice ?? p.itemCost, p.received);
  for (const e of i.equipment) { const c = lineCost(e.unitCost, e.planned); est.rentals += c; act.rentals += c; }
  for (const s of i.staffing) {
    const per = i.shiftCost[s.role] ?? 0;
    est.staff += per * s.required;
    act.staff += per * (s.arrived ?? s.required);
  }
  for (const m of i.manual) { act[m.category] += m.amount; if (m.category !== 'food' && m.category !== 'staff') est[m.category] += m.amount; }
  // Without purchases yet, actual food falls back to the plan so the actual profit is not inflated.
  if (!i.purchases.length) act.food = est.food;
  const estimate = { ...est, total: sum(est) };
  const actual = { ...act, total: sum(act) };
  const rev = i.revenue;
  return {
    estimate, actual, revenue: rev,
    profitEstimate: rev === null ? null : rev - estimate.total,
    profitActual: rev === null ? null : rev - actual.total,
    foodPct: rev ? Math.round((actual.food / rev) * 1000) / 10 : null,
    unpriced: i.foodNeeds.filter((n) => n.unitCost <= 0 && n.qty > 0).length,
  };
}

/** Cost of one portion of a dish from its recipe. */
export function dishPortionCost(yieldPortions: number, lines: { qty: number; unitCost: Agorot }[]): Agorot {
  if (yieldPortions <= 0) return 0;
  return Math.round(lines.reduce((a, l) => a + l.qty * l.unitCost, 0) / yieldPortions);
}
