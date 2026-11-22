/**
 * What each role sees: menu items and home-screen numbers.
 * Defaults per role; the business can change them in Settings (applyConfig mutates these maps).
 * Visibility here is about relevance — permissions still decide what is allowed.
 */
import type { Role, RoleGrant } from './permissions.ts';

export const NAV_ITEMS = {
  dashboard: 'דשבורד',
  tasks: 'משימות',
  process: 'תהליכי עבודה',
  roles: 'בעלי תפקידים',
  calendar: 'לוח שנה',
  field: 'ביצוע בשטח',
  events: 'אירועים',
  clients: 'לקוחות',
  sales: 'מכירות ופניות',
  intake: 'קליטה מאולם',
  kitchen: 'תכנון מטבח',
  prep: 'לוח הכנות',
  staffing: 'כוח אדם לפי יום',
  inventory: 'מלאי ומחסנים',
  purchasing: 'רכש וספקים',
  catalog: 'קטלוג מנות ופריטים',
  finance: 'כספים',
  reports: 'דוחות המרה',
  templates: 'תבנית העבודה',
  admin: 'הגדרות והרשאות',
} as const;
export type NavKey = keyof typeof NAV_ITEMS;

export const NAV_BY_ROLE: Record<Role, NavKey[]> = {
  owner: Object.keys(NAV_ITEMS) as NavKey[],
  ops: ['dashboard', 'tasks', 'process', 'roles', 'calendar', 'field', 'events', 'clients', 'kitchen', 'prep', 'staffing', 'inventory', 'purchasing', 'catalog', 'templates'],
  sales: ['dashboard', 'tasks', 'calendar', 'events', 'clients', 'sales', 'finance', 'reports'],
  brand: ['dashboard', 'tasks', 'calendar', 'field', 'events', 'intake', 'purchasing'],
  kitchen: ['dashboard', 'tasks', 'calendar', 'events', 'kitchen', 'prep', 'staffing', 'inventory', 'purchasing', 'catalog'],
  purchasing: ['dashboard', 'tasks', 'calendar', 'events', 'kitchen', 'inventory', 'purchasing', 'catalog'],
  event_manager: ['dashboard', 'tasks', 'calendar', 'field', 'events', 'staffing'],
  logistics: ['dashboard', 'tasks', 'calendar', 'field', 'events', 'inventory'],
  crew: ['dashboard', 'tasks', 'calendar', 'field', 'events', 'staffing'],
  accountant: ['dashboard', 'tasks', 'events', 'clients', 'finance', 'reports'],
  staff: ['field', 'tasks'],
};

export const KPI_ITEMS = {
  upcoming: 'אירועים ב-7 הימים הקרובים',
  notReady: 'אירועים קרובים שאינם מוכנים',
  shortages: 'אירועים עם חוסר במלאי',
  menuPending: 'תפריט לא סגור / שינוי פתוח',
  overdue: 'משימות באיחור',
  blocked: 'דורשות פתרון (חסומות)',
  escalated: 'הסלמות',
  unclaimed: 'משימות שטרם נלקחו',
  receivables: 'יתרות לגבייה',
  overduePayments: 'תשלומים באיחור',
  openLeads: 'פניות פתוחות',
  newLeads: 'פניות חדשות השבוע',
} as const;
export type KpiKey = keyof typeof KPI_ITEMS;

/** Extra home-screen blocks. */
export const HOME_BLOCKS = {
  checkpoint: 'האירוע הבא ונקודת הבקרה',
  kitchenLoad: 'עומס מטבח',
  meetings: 'סיורים, טעימות ושיחות',
  reports: 'דיווחים פתוחים מהשטח',
} as const;
export type HomeBlock = keyof typeof HOME_BLOCKS;

export const KPIS_BY_ROLE: Record<Role, (KpiKey | HomeBlock)[]> = {
  owner: [...(Object.keys(KPI_ITEMS) as KpiKey[]), 'checkpoint', 'kitchenLoad', 'meetings', 'reports'],
  ops: ['upcoming', 'notReady', 'shortages', 'menuPending', 'overdue', 'blocked', 'escalated', 'unclaimed', 'checkpoint', 'kitchenLoad', 'reports'],
  sales: ['openLeads', 'newLeads', 'menuPending', 'overdue', 'blocked', 'overduePayments', 'meetings'],
  brand: ['upcoming', 'notReady', 'menuPending', 'overdue', 'blocked', 'checkpoint'],
  kitchen: ['upcoming', 'shortages', 'menuPending', 'overdue', 'blocked', 'checkpoint', 'kitchenLoad', 'meetings', 'reports'],
  purchasing: ['shortages', 'overdue', 'blocked', 'kitchenLoad'],
  event_manager: ['upcoming', 'notReady', 'overdue', 'blocked', 'checkpoint', 'reports'],
  logistics: ['upcoming', 'overdue', 'blocked', 'checkpoint', 'reports'],
  crew: ['upcoming', 'overdue', 'blocked', 'checkpoint'],
  accountant: ['receivables', 'overduePayments', 'overdue'],
  staff: [],
};

const union = <T,>(grants: RoleGrant[], map: Record<Role, T[]>): Set<T> => new Set(grants.flatMap((g) => map[g.role] ?? []));
export const navFor = (grants: RoleGrant[]) => union(grants, NAV_BY_ROLE);
export const homeFor = (grants: RoleGrant[]) => union(grants, KPIS_BY_ROLE);

/** A user whose only role is complementary staff sees just today's work. */
export const isStaffOnly = (grants: RoleGrant[]) => grants.length > 0 && grants.every((g) => g.role === 'staff');

/** Roles that need the client's phone and e-mail. */
export const CONTACT_ROLES: Role[] = ['owner', 'ops', 'sales', 'brand', 'event_manager', 'accountant'];
export const seesClientContact = (grants: RoleGrant[]) => grants.some((g) => CONTACT_ROLES.includes(g.role));
