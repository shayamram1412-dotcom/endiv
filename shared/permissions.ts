/**
 * Role-based access control. One matrix, enforced by the server and mirrored by the UI.
 * Levels: 0 none · 1 view · 2 edit · 3 approve. Scope: a role is granted for one venue or for all venues.
 */
import type { VenueCode } from './domain.ts';

export const ROLES = {
  owner: 'בעלים / סמנכ״ל',
  ops: 'מנהל תפעול',
  sales: 'שירות ומכירות',
  brand: 'מנהל מותג',
  kitchen: 'מנהל מטבח',
  purchasing: 'מנהל רכש',
  event_manager: 'מנהל אירוע',
  logistics: 'אחראי ציוד ולוגיסטיקה',
  crew: 'אחראי צוות ומלצרים',
  accountant: 'מנהלת חשבונות',
  staff: 'עובד משלים',
} as const;
export type Role = keyof typeof ROLES;

export const MODULES = {
  events: 'אירועים',
  clients: 'לקוחות',
  sales: 'מכירות ושיווק',
  menu: 'תפריט וטעימות',
  kitchen: 'מטבח',
  inventory: 'מלאי',
  purchasing: 'רכש וספקים',
  equipment: 'ציוד ולוגיסטיקה',
  staffing: 'כוח אדם',
  field: 'ביצוע בשטח',
  finance: 'גבייה',
  tasks: 'משימות',
  catalog: 'קטלוג מנות ופריטים',
  reports: 'דוחות',
  process: 'תהליך עבודה ותבניות',
  admin: 'ניהול מערכת',
} as const;
export type Module = keyof typeof MODULES;

export const LEVEL = { none: 0, view: 1, edit: 2, approve: 3 } as const;
export type Level = (typeof LEVEL)[keyof typeof LEVEL];
export const LEVEL_LABEL: Record<Level, string> = { 0: 'ללא', 1: 'צפייה', 2: 'עריכה', 3: 'אישור' };

type Matrix = Record<Role, Partial<Record<Module, Level>>>;

const ALL: Partial<Record<Module, Level>> = Object.fromEntries(
  Object.keys(MODULES).map((m) => [m, 3]),
) as Partial<Record<Module, Level>>;

export const MATRIX: Matrix = {
  owner: ALL,
  ops: {
    events: 2, clients: 1, menu: 2, kitchen: 2, inventory: 3, purchasing: 3,
    equipment: 3, staffing: 2, field: 3, tasks: 3, catalog: 2, process: 3,
  },
  sales: {
    events: 2, clients: 2, sales: 3, menu: 2, finance: 1, tasks: 2, catalog: 1, reports: 1, process: 1,
  },
  brand: {
    events: 3, clients: 1, menu: 2, kitchen: 1, inventory: 1, purchasing: 1,
    equipment: 2, staffing: 1, field: 2, tasks: 2, catalog: 1, process: 1,
  },
  kitchen: {
    events: 1, menu: 3, kitchen: 3, inventory: 2, purchasing: 2, equipment: 1, staffing: 2,
    field: 2, tasks: 2, catalog: 3, process: 1,
  },
  purchasing: {
    events: 1, menu: 1, kitchen: 1, inventory: 2, purchasing: 3, equipment: 2, tasks: 2, catalog: 2, process: 1,
  },
  event_manager: {
    events: 2, clients: 1, menu: 2, kitchen: 1, inventory: 1, equipment: 2, staffing: 3,
    field: 3, tasks: 2, catalog: 1, process: 1,
  },
  logistics: {
    events: 1, inventory: 1, purchasing: 1, equipment: 3, field: 2, tasks: 2, catalog: 1, process: 1,
  },
  crew: {
    events: 1, staffing: 3, field: 2, tasks: 2, process: 1,
  },
  accountant: { events: 1, clients: 1, finance: 3, tasks: 2, reports: 1, process: 1 },
  staff: { events: 1, field: 1, tasks: 2, process: 1 },
};

/** Roles a task can be routed to, and who supervises each queue (sees overdue / unclaimed). */
export const SUPERVISOR_ROLES: Role[] = ['owner', 'ops'];

export interface RoleGrant {
  role: Role;
  /** null = every venue */
  venue: VenueCode | null;
}

export interface Principal {
  id: number;
  name: string;
  grants: RoleGrant[];
}

/** Highest level the principal has on a module, optionally restricted to a venue. */
export function levelFor(p: Pick<Principal, 'grants'>, module: Module, venue?: VenueCode | null): Level {
  let best: Level = 0;
  for (const g of p.grants) {
    if (venue && g.venue && g.venue !== venue) continue;
    const lvl = (MATRIX[g.role][module] ?? 0) as Level;
    if (lvl > best) best = lvl;
  }
  return best;
}

export function can(p: Pick<Principal, 'grants'>, module: Module, level: Level = 1, venue?: VenueCode | null): boolean {
  return levelFor(p, module, venue) >= level;
}

/**
 * Business-wide data (central kitchen and warehouse, suppliers, catalog, settings): only grants that cover
 * every venue count. A user limited to one venue never passes this.
 */
export function canGlobal(p: Pick<Principal, 'grants'>, module: Module, level: Level = 1): boolean {
  return levelFor({ grants: p.grants.filter((g) => g.venue === null) }, module) >= level;
}

/** Data that belongs to one venue, or to the central kitchen when venue is null (then a business-wide grant is needed). */
export function canAt(p: Pick<Principal, 'grants'>, module: Module, level: Level, venue: VenueCode | string | null): boolean {
  return venue === null ? canGlobal(p, module, level) : can(p, module, level, venue as VenueCode);
}

/** Venues the principal can see at all. null = all venues. */
export function venueScope(p: Pick<Principal, 'grants'>): VenueCode[] | null {
  if (p.grants.some((g) => g.venue === null)) return null;
  return [...new Set(p.grants.map((g) => g.venue).filter((v): v is VenueCode => v !== null))];
}

export function hasRole(p: Pick<Principal, 'grants'>, role: Role, venue?: VenueCode | null): boolean {
  return p.grants.some((g) => g.role === role && (!venue || !g.venue || g.venue === venue));
}

export function isSupervisor(p: Pick<Principal, 'grants'>): boolean {
  return p.grants.some((g) => SUPERVISOR_ROLES.includes(g.role));
}

/** What each role is accountable for (roles before names). */
export const ROLE_DESC: Record<Role, string> = {
  owner: 'מעקב רוחבי, קביעת נהלים והתערבות בחריגים',
  ops: 'רכש רוחבי, תיאום בין נקודות, אימות העמסה ופריקה',
  sales: 'פניות, טעימות, הצעות מחיר, מעקב עד חתימה ושירות אחרי האירוע',
  brand: 'קליטת אירועים מהאולם ווידוא השלמות בנקודה',
  kitchen: 'תפריט, כמויות, תוכנית ייצור, הכנה ואריזה',
  purchasing: 'הזמנות, אישורי אספקה ותיאום מול ספקים',
  event_manager: 'תכלול האירוע, בדיקת מוכנות וטיפול בחוסרים',
  logistics: 'רשימות ציוד, הובלה, הקמה והחזרות',
  crew: 'שיבוץ עובדים ומשמרות, דיווח נוכחות',
  accountant: 'מעקב תשלומי לקוח וחשבונות ספקים',
  staff: 'ביצוע לפי האירוע והתפקיד שנקבעו',
};
