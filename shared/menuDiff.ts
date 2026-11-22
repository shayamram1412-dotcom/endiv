/**
 * Menu snapshots and the difference between two versions — "what changed" after approval.
 */
import { AUDIENCE, DIETARY_KIND, type Audience, type DietaryKind } from './domain.ts';

export interface MenuSnapshotLine {
  dishId: number;
  dishName: string;
  audience: Audience;
  perGuest: number;
  qtyOverride: number | null;
  notes: string;
}
export interface MenuSnapshotDietary {
  kind: DietaryKind;
  count: number;
  description: string;
}
export interface MenuSnapshot {
  guests: number;
  kids: number;
  lines: MenuSnapshotLine[];
  dietary: MenuSnapshotDietary[];
  kosher: string;
}

export interface MenuChange {
  type: 'added' | 'removed' | 'changed';
  label: string;
  before?: string;
  after?: string;
}

const lineDesc = (l: MenuSnapshotLine) =>
  `${AUDIENCE[l.audience]} · ${l.qtyOverride !== null ? `${l.qtyOverride} מנות (קבוע)` : `${l.perGuest} לאורח`}${l.notes ? ` · ${l.notes}` : ''}`;
const dietKey = (d: MenuSnapshotDietary) => `${d.kind}|${d.description.trim()}`;
const dietDesc = (d: MenuSnapshotDietary) => `${DIETARY_KIND[d.kind]}${d.description ? ` – ${d.description}` : ''}${d.count ? ` (${d.count})` : ''}`;

export function diffMenus(a: MenuSnapshot | null, b: MenuSnapshot): MenuChange[] {
  if (!a) return [{ type: 'added', label: 'תפריט ראשון אושר' }];
  const out: MenuChange[] = [];
  if (a.guests !== b.guests) out.push({ type: 'changed', label: 'מספר אורחים', before: String(a.guests), after: String(b.guests) });
  if (a.kids !== b.kids) out.push({ type: 'changed', label: 'ילדים', before: String(a.kids), after: String(b.kids) });
  if (a.kosher !== b.kosher) out.push({ type: 'changed', label: 'כשרות', before: a.kosher, after: b.kosher });

  const am = new Map(a.lines.map((l) => [l.dishId, l]));
  const bm = new Map(b.lines.map((l) => [l.dishId, l]));
  for (const [id, l] of bm) {
    const prev = am.get(id);
    if (!prev) out.push({ type: 'added', label: l.dishName, after: lineDesc(l) });
    else if (lineDesc(prev) !== lineDesc(l)) out.push({ type: 'changed', label: l.dishName, before: lineDesc(prev), after: lineDesc(l) });
  }
  for (const [id, l] of am) if (!bm.has(id)) out.push({ type: 'removed', label: l.dishName, before: lineDesc(l) });

  const ad = new Map(a.dietary.map((d) => [dietKey(d), d]));
  const bd = new Map(b.dietary.map((d) => [dietKey(d), d]));
  for (const [k, d] of bd) {
    const prev = ad.get(k);
    if (!prev) out.push({ type: 'added', label: 'הנחיה תזונתית', after: dietDesc(d) });
    else if (prev.count !== d.count) out.push({ type: 'changed', label: 'הנחיה תזונתית', before: dietDesc(prev), after: dietDesc(d) });
  }
  for (const [k, d] of ad) if (!bd.has(k)) out.push({ type: 'removed', label: 'הנחיה תזונתית', before: dietDesc(d) });
  return out;
}
