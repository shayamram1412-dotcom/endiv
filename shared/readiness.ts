/**
 * Readiness is computed from operational data, never typed in by hand.
 * When the underlying fact changes (e.g. received quantity was entered), readiness changes with it.
 */
import { VENUE_RULES, type ConfirmationKind, type MenuStatus, type SalesStatus, type IntakeStatus, type VenueCode, type StaffRole, STAFF_ROLES, type ServiceKind } from './domain.ts';
import type { Role } from './permissions.ts';

export interface ReadinessFacts {
  venue: VenueCode;
  serviceKind: ServiceKind;
  salesStatus: SalesStatus;
  intakeStatus: IntakeStatus | null;
  menuStatus: MenuStatus;
  pendingMenuAcks: number;
  /** Raw-material lines allocated to this event that are still short. */
  shortItems: number;
  /** Purchase lines for this event not fully received. */
  openDeliveries: number;
  staffing: { role: StaffRole; required: number; assigned: number }[];
  equipmentLines: number;
  rentalsUnconfirmed: number;
  siteDetailsComplete: boolean;
  confirmations: ConfirmationKind[];
  openReports: number;
  /**
   * Tasks marked "required for readiness". A task that covers one of the checks below
   * (by its "done when" fact or its automatic type) replaces that check — one item, not two.
   */
  tasks?: { id: number; covers: string | null; title: string; done: boolean; blocked: boolean; role: Role }[];
}

/** Which readiness check each "done when" fact / automatic task type covers. */
export const COVERS: Record<string, string> = {
  contract_signed: 'contract', intake_verified: 'intake', menu_approved: 'menu', stock_covered: 'stock', deliveries_received: 'deliveries',
  staffing_full: 'staffing', rentals_confirmed: 'rentals', equipment_listed: 'equipment', kitchen_ready: 'kitchen_ready', field_ready: 'field_ready', loaded: 'loaded',
  kitchen_readiness: 'kitchen_ready', readiness_check: 'field_ready', order_shortage: 'stock', verify_delivery: 'deliveries',
  menu_ack_kitchen: 'menu', menu_ack_field: 'menu', verify_intake: 'intake', complete_intake: 'intake',
};

export interface ReadinessItem {
  key: string;
  label: string;
  done: boolean;
  detail?: string;
  owner: Role;
  /** Not relevant: switched off in settings, or marked not relevant for this event. Not counted. */
  na?: 'settings' | 'event';
  /** The item is a task (open it to act on it). */
  taskId?: number;
  /** The check this task stands in for (e.g. 'staffing'). */
  covers?: string;
  blocked?: boolean;
}

/** Checklist items the business can switch on/off in Settings and per event. */
export const READINESS_ITEMS: Record<string, string> = {
  contract: 'חוזה נחתם',
  intake: 'פרטי קליטה מהאולם אומתו',
  menu: 'תפריט מאושר והתקבל במטבח ובשטח',
  stock: 'חומרי גלם מכוסים',
  deliveries: 'אספקות התקבלו',
  staffing: 'צוות שובץ לפי התקן',
  rentals: 'כלי הגשה שכורים הוזמנו',
  equipment: 'רשימת מתכלים הוכנה',
  site: 'פרטי אתר מלאים (כתובת, איש קשר, שעות)',
  kitchen_ready: 'מנהל המטבח אישר מוכנות',
  field_ready: 'מנהל האירוע אישר מוכנות',
  loaded: 'העמסה נספרה',
};

/** Who is accountable for each readiness item (editable in Settings). */
export const READINESS_OWNER: Record<string, Role> = {
  contract: 'sales', intake: 'brand', menu: 'kitchen', stock: 'purchasing', deliveries: 'purchasing', staffing: 'event_manager',
  rentals: 'event_manager', equipment: 'ops', site: 'sales', kitchen_ready: 'kitchen', field_ready: 'event_manager', loaded: 'ops',
};

export interface ReadinessOptions {
  /** Keys switched off in settings. */
  disabled?: string[];
  /** Keys marked not relevant for this specific event. */
  skipped?: string[];
}

export interface Readiness {
  items: ReadinessItem[];
  done: number;
  total: number;
  pct: number;
  /** Plain-words summary for screen readers and for status chips. */
  label: string;
}

export function computeReadiness(f: ReadinessFacts, opts: ReadinessOptions = {}): Readiness {
  const rules = VENUE_RULES[f.venue];
  const items: ReadinessItem[] = [];
  const has = (c: ConfirmationKind) => f.confirmations.includes(c);

  if (rules.track === 'direct') {
    items.push({ key: 'contract', label: 'חוזה נחתם', done: f.salesStatus === 'signed', owner: 'sales' });
  } else {
    items.push({ key: 'intake', label: 'פרטי קליטה מהאולם אומתו', done: f.intakeStatus === 'verified', detail: f.intakeStatus === 'missing' ? 'חסרים פרטים' : undefined, owner: 'brand' });
  }
  items.push({
    key: 'menu',
    label: 'תפריט מאושר והתקבל במטבח ובשטח',
    done: f.menuStatus === 'approved' && f.pendingMenuAcks === 0,
    detail: f.menuStatus === 'changed' ? `${f.pendingMenuAcks} אישורי קבלה חסרים` : f.menuStatus !== 'approved' ? 'התפריט טרם אושר' : undefined,
    owner: 'kitchen',
  });
  items.push({
    key: 'stock',
    label: 'חומרי גלם מכוסים',
    done: f.shortItems === 0,
    detail: f.shortItems ? `${f.shortItems} פריטים בחוסר` : undefined,
    owner: 'purchasing',
  });
  items.push({
    key: 'deliveries',
    label: 'אספקות התקבלו',
    done: f.openDeliveries === 0,
    detail: f.openDeliveries ? `${f.openDeliveries} שורות הזמנה פתוחות` : undefined,
    owner: 'purchasing',
  });

  if (f.serviceKind === 'full') {
    const gaps = f.staffing.filter((s) => s.assigned < s.required);
    items.push({
      key: 'staffing',
      label: 'צוות שובץ לפי התקן',
      done: f.staffing.length > 0 && gaps.length === 0,
      detail: f.staffing.length === 0 ? 'לא הוגדר תקן' : gaps.map((g) => `${STAFF_ROLES[g.role]}: ${g.assigned}/${g.required}`).join(' · ') || undefined,
      owner: 'event_manager',
    });
  }

  if (rules.equipment === 'rental') {
    items.push({
      key: 'rentals',
      label: 'כלי הגשה שכורים הוזמנו',
      done: f.equipmentLines > 0 && f.rentalsUnconfirmed === 0,
      detail: f.equipmentLines === 0 ? 'אין רשימת ציוד' : f.rentalsUnconfirmed ? `${f.rentalsUnconfirmed} פריטים לא אושרו מול הספק` : undefined,
      owner: 'event_manager',
    });
  } else if (rules.equipment === 'consumables') {
    items.push({ key: 'equipment', label: 'רשימת מתכלים הוכנה', done: f.equipmentLines > 0, owner: 'ops' });
  }
  if (rules.siteDetails) {
    items.push({ key: 'site', label: 'פרטי אתר מלאים (כתובת, איש קשר, שעות)', done: f.siteDetailsComplete, owner: 'sales' });
  }

  items.push({ key: 'kitchen_ready', label: 'מנהל המטבח אישר מוכנות', done: has('kitchen_ready'), owner: 'kitchen' });
  if (f.serviceKind === 'full') {
    items.push({ key: 'field_ready', label: 'מנהל האירוע אישר מוכנות', done: has('field_ready'), owner: 'event_manager' });
  }
  if (rules.loadCheck) {
    items.push({ key: 'loaded', label: 'העמסה נספרה', done: has('loaded'), owner: 'ops' });
  }

  // Tasks replace the checks they cover; every required task is an item of its own.
  if (f.tasks?.length) {
    const covered = new Set(f.tasks.map((t) => t.covers).filter(Boolean) as string[]);
    for (let k = items.length - 1; k >= 0; k--) if (covered.has(items[k].key)) items.splice(k, 1);
    for (const t of f.tasks) {
      items.push({ key: `task:${t.id}`, label: t.title, done: t.done, owner: t.role, taskId: t.id, covers: t.covers ?? undefined, blocked: t.blocked, detail: t.blocked ? 'חסומה' : undefined });
    }
  }
  for (const i of items) {
    if (i.taskId) continue;
    i.label = READINESS_ITEMS[i.key] ?? i.label;
    i.owner = READINESS_OWNER[i.key] ?? i.owner;
    if (opts.disabled?.includes(i.key)) i.na = 'settings';
    else if (opts.skipped?.includes(i.key)) i.na = 'event';
  }
  const counted = items.filter((i) => !i.na);
  const done = counted.filter((i) => i.done).length;
  const pct = counted.length ? Math.round((done / counted.length) * 100) : 100;
  const label = done === counted.length ? 'מוכן לביצוע' : `${done} מתוך ${counted.length} מוכנים`;
  return { items: items.filter((i) => i.na !== 'settings'), done, total: counted.length, pct, label };
}
