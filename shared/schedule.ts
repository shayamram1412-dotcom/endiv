/**
 * Run of show and resource conflicts — pure functions.
 */

/** "18:30" + offset minutes → "HH:MM" (wraps past midnight). Empty start → ''. */
export function shiftTime(start: string, offsetMin: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(start);
  if (!m) return '';
  const total = (((Number(m[1]) * 60 + Number(m[2]) + offsetMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export interface Demand { eventId: number; title: string; qty: number }

/** Owned equipment: per item and day, the sum demanded across events vs. what we own. */
export function equipmentConflicts(
  lines: { date: string; itemId: number; itemName: string; owned: number; eventId: number; title: string; qty: number }[],
): { date: string; itemId: number; itemName: string; owned: number; demanded: number; short: number; events: Demand[] }[] {
  const by = new Map<string, { date: string; itemId: number; itemName: string; owned: number; events: Demand[] }>();
  for (const l of lines) {
    const k = `${l.date}|${l.itemId}`;
    const cur = by.get(k) ?? { date: l.date, itemId: l.itemId, itemName: l.itemName, owned: l.owned, events: [] };
    cur.events.push({ eventId: l.eventId, title: l.title, qty: l.qty });
    by.set(k, cur);
  }
  return [...by.values()]
    .map((g) => { const demanded = g.events.reduce((a, e) => a + e.qty, 0); return { ...g, demanded, short: Math.max(0, demanded - g.owned) }; })
    .filter((g) => g.events.length > 1 && g.short > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.itemName.localeCompare(b.itemName, 'he'));
}

/** A vehicle booked for two events on the same day whose time windows overlap (or have no times). */
export function vehicleConflicts(
  rows: { date: string; vehicleId: number; vehicleName: string; eventId: number; title: string; depart: string; back: string }[],
): { date: string; vehicleId: number; vehicleName: string; events: { eventId: number; title: string; depart: string; back: string }[] }[] {
  const toMin = (t: string, fallback: number) => { const m = /^(\d{2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : fallback; };
  const out: ReturnType<typeof vehicleConflicts> = [];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.date}|${r.vehicleId}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // A return earlier than the departure means after midnight.
    const span = (r: (typeof g)[number]) => { const s = toMin(r.depart, 0); let e = toMin(r.back, 1440); if (e <= s) e += 1440; return [s, e] as const; };
    const clash = g.some((a, i) => g.some((b, j) => { if (j <= i) return false; const [as, ae] = span(a); const [bs, be] = span(b); return as < be && bs < ae; }));
    if (clash) out.push({ date: g[0].date, vehicleId: g[0].vehicleId, vehicleName: g[0].vehicleName, events: g.map((r) => ({ eventId: r.eventId, title: r.title, depart: r.depart, back: r.back })) });
  }
  return out;
}
