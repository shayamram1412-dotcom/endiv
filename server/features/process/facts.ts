/**
 * Operational facts that close template tasks automatically ("done when …").
 * Each fact reads the real data, so a checklist item can never say "done" while the data says otherwise.
 */
import { all, get } from '../../core/db.ts';
import { VENUE_RULES, type DoneWhen } from '../../../shared/domain.ts';
import type { EventRecord } from '../../../shared/types.ts';
import { collectionFor, confirmationsFor, shortItemsFor } from '../events/service.ts';

const count = (sql: string, ...p: unknown[]) => get<{ n: number }>(sql, ...p)!.n;

export const FACTS: Record<DoneWhen, (ev: EventRecord) => boolean> = {
  contract_signed: (ev) => ev.salesStatus === 'signed' || ev.salesStatus === 'hall',
  tasting_scheduled: (ev) => count("SELECT COUNT(*) AS n FROM meetings WHERE event_id = ? AND kind = 'tasting' AND status != 'cancelled'", ev.id) > 0,
  menu_approved: (ev) => ev.menuStatus === 'approved' || ev.menuStatus === 'changed',
  intake_verified: (ev) => VENUE_RULES[ev.venue].track === 'direct' || ev.intakeStatus === 'verified',
  manager_assigned: (ev) => !!ev.eventManagerId,
  requirements_approved: (ev) => count('SELECT COUNT(*) AS n FROM requirements WHERE event_id = ? AND approved_at IS NOT NULL', ev.id) > 0,
  stock_covered: (ev) => count('SELECT COUNT(*) AS n FROM requirements WHERE event_id = ? AND approved_at IS NOT NULL', ev.id) > 0 && shortItemsFor(ev.id) === 0,
  deliveries_received: (ev) => count(
    `SELECT COUNT(*) AS n FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
      WHERE l.event_id = ? AND p.status IN ('ordered','partial') AND l.received < l.qty AND l.gap_resolved = 0`, ev.id,
  ) === 0,
  prep_planned: (ev) => {
    const dishes = all<{ dish_id: number }>('SELECT DISTINCT dish_id FROM menu_lines WHERE event_id = ?', ev.id);
    if (!dishes.length) return false;
    return count('SELECT COUNT(*) AS n FROM prep_plan WHERE event_id = ?', ev.id) >= dishes.length;
  },
  equipment_listed: (ev) => VENUE_RULES[ev.venue].equipment === 'none' || count('SELECT COUNT(*) AS n FROM event_equipment WHERE event_id = ?', ev.id) > 0,
  rentals_confirmed: (ev) => {
    if (VENUE_RULES[ev.venue].equipment !== 'rental') return true;
    const lines = all<{ c: number }>('SELECT supplier_confirmed AS c FROM event_equipment WHERE event_id = ? AND is_food = 0', ev.id);
    return lines.length > 0 && lines.every((l) => l.c);
  },
  staffing_full: (ev) => {
    const rows = all<{ required: number; assigned: number }>('SELECT required, assigned FROM staffing WHERE event_id = ? AND required > 0', ev.id);
    return rows.length > 0 && rows.every((r) => r.assigned >= r.required);
  },
  kitchen_ready: (ev) => confirmationsFor(ev.id).includes('kitchen_ready'),
  field_ready: (ev) => confirmationsFor(ev.id).includes('field_ready'),
  loaded: (ev) => !VENUE_RULES[ev.venue].loadCheck || confirmationsFor(ev.id).includes('loaded'),
  executed: (ev) => confirmationsFor(ev.id).includes('executed'),
  rentals_returned: (ev) => VENUE_RULES[ev.venue].equipment !== 'rental' || confirmationsFor(ev.id).includes('rentals_returned'),
  deposit_paid: (ev) => {
    const d = get<{ amount: number; received: number }>("SELECT amount, received FROM payments WHERE event_id = ? AND kind = 'deposit' ORDER BY id LIMIT 1", ev.id);
    return !!d && d.received >= d.amount;
  },
  fully_paid: (ev) => {
    const c = collectionFor(ev);
    return c.contract > 0 && c.balance <= 0;
  },
  feedback_logged: (ev) => count("SELECT COUNT(*) AS n FROM activities WHERE event_id = ? AND kind IN ('feedback','complaint')", ev.id) > 0,
};
