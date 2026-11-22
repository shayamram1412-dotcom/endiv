import { describe, expect, it } from 'vitest';
import { allocate, receiptGap } from '../shared/inventory.ts';
import { formatMoney, parseShekels, toShekelInput } from '../shared/money.ts';
import { portionsFor, rawMaterials, weeklyLoad, guestChangeImpact, DEFAULT_FACTORS } from '../shared/kitchen.ts';
import { computeReadiness, type ReadinessFacts } from '../shared/readiness.ts';
import { diffMenus, type MenuSnapshot } from '../shared/menuDiff.ts';
import { summarizeCollection } from '../shared/finance.ts';
import { can, levelFor, venueScope } from '../shared/permissions.ts';

describe('inventory allocation', () => {
  it('spec example: 100 units, events need 70 and 60 → shortage 30 on the later event', () => {
    const a = allocate(100, [{ eventId: 2, date: '2026-12-02', qty: 60 }, { eventId: 1, date: '2026-12-01', qty: 70 }]);
    expect(a.shortage).toBe(30);
    expect(a.rows.map((r) => [r.eventId, r.allocated, r.short])).toEqual([[1, 70, 0], [2, 30, 30]]);
  });
  it('open purchase orders reduce what still needs ordering', () => {
    const a = allocate(100, [{ eventId: 1, date: '2026-12-01', qty: 130 }], 20);
    expect(a.shortage).toBe(30);
    expect(a.uncovered).toBe(10);
  });
  it('partial receipt leaves the gap open', () => {
    expect(receiptGap(30, 18)).toEqual({ received: 18, gap: 12, status: 'partial' });
    expect(receiptGap(10, 10).status).toBe('received');
  });
});

describe('money in agorot', () => {
  it('parses shekel input exactly', () => {
    expect(parseShekels('12,500.50')).toBe(1_250_050);
    expect(parseShekels('₪ 0.1')).toBe(10);
    expect(parseShekels('0.29')).toBe(29);
    expect(parseShekels('1.234')).toBeNull();
    expect(parseShekels('abc')).toBeNull();
  });
  it('round-trips through the input format', () => {
    for (const v of [0, 5, 10, 199, 1_250_050]) expect(parseShekels(toShekelInput(v))).toBe(v);
  });
  it('formats for display', () => {
    expect(formatMoney(1_250_000)).toContain('12,500');
  });
});

describe('kitchen calculations', () => {
  const counts = { guests: 200, kids: 20, vegetarian: 10, vegan: 4 };
  it('scales portions by audience, event type and buffer', () => {
    expect(portionsFor({ dishId: 1, audience: 'all', perGuest: 1, qtyOverride: null }, counts, 'wedding')).toBe(210); // 200 × 1.05
    expect(portionsFor({ dishId: 1, audience: 'adults', perGuest: 0.5, qtyOverride: null }, counts, 'wedding')).toBe(95); // 180 × .5 × 1.05 = 94.5 → 95
    expect(portionsFor({ dishId: 1, audience: 'kids', perGuest: 1, qtyOverride: null }, counts, 'wedding')).toBe(21);
    expect(portionsFor({ dishId: 1, audience: 'all', perGuest: 1, qtyOverride: null }, counts, 'conference')).toBe(168); // × 0.8
    expect(portionsFor({ dishId: 1, audience: 'all', perGuest: 1, qtyOverride: 50 }, counts, 'wedding')).toBe(50);
  });
  it('turns portions into raw materials via recipe yield', () => {
    const recipes = new Map([[1, { dishId: 1, yieldPortions: 10, lines: [{ itemId: 7, itemName: 'בקר', unit: 'ק״ג', qty: 4.5 }] }]]);
    const r = rawMaterials([{ dishId: 1, portions: 175 }, { dishId: 2, portions: 10 }], recipes);
    expect(r.needs[0].qty).toBe(78.75);
    expect(r.missingRecipes).toEqual([2]);
  });
  it('weekly load gives a total and per-event breakdown for a shared dish', () => {
    const w = weeklyLoad([
      { eventId: 1, title: 'A', date: '2026-12-01', lines: [{ dishId: 5, dishName: 'סלט', portions: 100 }] },
      { eventId: 2, title: 'B', date: '2026-12-02', lines: [{ dishId: 5, dishName: 'סלט', portions: 60 }] },
    ]);
    expect(w[0].total).toBe(160);
    expect(w[0].byEvent.map((b) => b.portions)).toEqual([100, 60]);
  });
  it('guest change shows its impact on dishes and purchasing', () => {
    const recipes = new Map([[1, { dishId: 1, yieldPortions: 10, lines: [{ itemId: 7, itemName: 'בקר', unit: 'ק״ג', qty: 4 }] }]]);
    const imp = guestChangeImpact([{ dishId: 1, audience: 'all', perGuest: 1, qtyOverride: null }], counts, { ...counts, guests: 220 }, 'wedding', recipes, DEFAULT_FACTORS);
    expect(imp.dishes[0]).toMatchObject({ before: 210, after: 231, delta: 21 });
    expect(imp.raw[0].delta).toBeCloseTo(8.4);
  });
});

describe('readiness per venue', () => {
  const base: ReadinessFacts = {
    venue: 'farm', serviceKind: 'full', salesStatus: 'hall', intakeStatus: 'verified', menuStatus: 'approved', pendingMenuAcks: 0,
    shortItems: 0, openDeliveries: 0, staffing: [{ role: 'waiter', required: 10, assigned: 10 }], equipmentLines: 4, rentalsUnconfirmed: 0,
    siteDetailsComplete: false, confirmations: ['kitchen_ready', 'field_ready', 'loaded'], openReports: 0,
  };
  it('farm requires loading count; eden has no equipment line', () => {
    expect(computeReadiness(base).items.map((i) => i.key)).toContain('loaded');
    const eden = computeReadiness({ ...base, venue: 'eden' });
    expect(eden.items.map((i) => i.key)).not.toContain('equipment');
    expect(eden.items.map((i) => i.key)).not.toContain('loaded');
  });
  it('changes when the underlying data changes', () => {
    expect(computeReadiness(base).pct).toBe(100);
    expect(computeReadiness({ ...base, shortItems: 2 }).pct).toBeLessThan(100);
    expect(computeReadiness({ ...base, menuStatus: 'changed', pendingMenuAcks: 1 }).items.find((i) => i.key === 'menu')!.done).toBe(false);
  });
  it('direct sale needs a signed contract; offsite needs site details', () => {
    const off = computeReadiness({ ...base, venue: 'offsite', salesStatus: 'quoted', intakeStatus: null });
    expect(off.items.find((i) => i.key === 'contract')!.done).toBe(false);
    expect(off.items.find((i) => i.key === 'site')!.done).toBe(false);
  });
});

describe('menu diff', () => {
  const a: MenuSnapshot = { guests: 100, kids: 0, kosher: 'none', lines: [{ dishId: 1, dishName: 'סלט', audience: 'all', perGuest: 1, qtyOverride: null, notes: '' }], dietary: [] };
  it('reports added, removed and changed items', () => {
    const b: MenuSnapshot = { ...a, guests: 120, lines: [{ dishId: 2, dishName: 'מרק', audience: 'all', perGuest: 1, qtyOverride: null, notes: '' }], dietary: [{ kind: 'allergy', count: 2, description: 'אגוזים' }] };
    const d = diffMenus(a, b);
    expect(d.map((c) => c.type).sort()).toEqual(['added', 'added', 'changed', 'removed']);
  });
});

describe('collection status', () => {
  it('deposit late vs balance due vs paid', () => {
    const lines = [{ kind: 'deposit' as const, amount: 3000, dueDate: '2026-01-01', received: 0, receivedAt: null }, { kind: 'final' as const, amount: 7000, dueDate: '2026-12-31', received: 0, receivedAt: null }];
    expect(summarizeCollection(10000, lines, '2026-06-01').status).toBe('deposit_late');
    lines[0].received = 3000;
    const s = summarizeCollection(10000, lines, '2026-06-01');
    expect(s).toMatchObject({ status: 'balance_due', balance: 7000, overdue: 0 });
    lines[1].received = 7000;
    expect(summarizeCollection(10000, lines, '2026-06-01').status).toBe('paid');
  });
});

describe('permissions', () => {
  const brandEden = { grants: [{ role: 'brand' as const, venue: 'eden' as const }] };
  it('venue-scoped roles', () => {
    expect(can(brandEden, 'events', 3, 'eden')).toBe(true);
    expect(can(brandEden, 'events', 1, 'farm')).toBe(false);
    expect(venueScope(brandEden)).toEqual(['eden']);
  });
  it('multiple roles combine to the highest level', () => {
    const p = { grants: [{ role: 'event_manager' as const, venue: null }, { role: 'accountant' as const, venue: null }] };
    expect(levelFor(p, 'finance')).toBe(3);
    expect(levelFor(p, 'staffing')).toBe(3);
    expect(can({ grants: [{ role: 'kitchen' as const, venue: null }] }, 'finance')).toBe(false);
  });
});
