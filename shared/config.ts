/**
 * Runtime configuration of the system's vocabulary and structure.
 *
 * The built-in dictionaries (venues, event types, stages, statuses, roles, permissions…) are defaults.
 * `applyConfig` re-applies the business's own settings onto those same objects at runtime — on the server at
 * startup / after every settings change, and in the browser after sign-in — so every screen and rule that
 * reads them sees the business's names, structure and permissions. Nothing needs a programmer to change.
 */
import {
  ACTIVITY_KIND, ALLERGENS, AUDIENCE, CLIENT_KIND, CONFIRMATIONS, CORE_STAGES, DIETARY_KIND, DOC_KIND, DONE_WHEN, EVENT_TYPES,
  INTAKE_STATUS, ITEM_KIND, KOSHER, LIFECYCLE, MEETING_KIND, MENU_STATUS, MOVEMENT_KIND, PAYMENT_KIND, PAYMENT_STATUS, PO_STATUS,
  REPORT_KIND, REPORT_TARGET, SALES_STATUS, SERVICE_KIND, STAFF_ROLES, VENUE_CODES, VENUE_COLORS, VENUE_EVENT_TYPES, VENUE_LABEL,
  VENUE_DEFAULTS, VENUE_RULES, WORK_STAGES, WORK_STAGE_ORDER, type VenueDefaults, type VenueRules,
} from './domain.ts';
import { MATRIX, MODULES, ROLES, ROLE_DESC, type Level, type Module, type Role } from './permissions.ts';
import { TASK_STATUS, TASK_TYPES } from './tasks.ts';
import { READINESS_ITEMS, READINESS_OWNER } from './readiness.ts';
import { EVENT_STYLE } from './staffing.ts';
import { CONTACT_ROLES, KPIS_BY_ROLE, NAV_BY_ROLE, type HomeBlock, type KpiKey, type NavKey } from './navigation.ts';
import type { StaffingStyle } from './settings.ts';

// ---------------------------------------------------------------- shapes stored in settings

export interface EventTypeConfig { key: string; label: string; venues: string[]; style: StaffingStyle; active: boolean }
export interface StageConfig { key: string; label: string; desc: string }
export interface VenueConfig extends VenueRules { code: string; name: string; address: string; color: string; sort: number; active: number; defaults?: VenueDefaults }

export interface SystemConfig {
  /** namespace → key → label (overrides of the built-in wording). */
  labels: Record<string, Record<string, string>>;
  /** Event types (empty = built-in). */
  eventTypes: EventTypeConfig[];
  /** Work stages in order (empty = built-in). Core stages cannot be removed. */
  workStages: StageConfig[];
  /** Permission overrides: role → module → level. Owner always keeps full access. */
  permissions: Partial<Record<Role, Partial<Record<Module, Level>>>>;
  /** Readiness item owners (role). */
  readinessOwners: Partial<Record<string, Role>>;
  allergens: string[];
  /** What each role sees in the menu and on the home screen; who sees client contact details. */
  navByRole?: Partial<Record<Role, NavKey[]>>;
  homeByRole?: Partial<Record<Role, (KpiKey | HomeBlock)[]>>;
  contactRoles?: Role[];
}

export const EMPTY_SYSTEM_CONFIG: SystemConfig = { labels: {}, eventTypes: [], workStages: [], permissions: {}, readinessOwners: {}, allergens: [], navByRole: {}, homeByRole: {}, contactRoles: [] };

// ---------------------------------------------------------------- editable dictionaries

const taskTypeLabels = Object.fromEntries(Object.entries(TASK_TYPES).map(([k, v]) => [k, v.label])) as Record<string, string>;

/** Every editable word list, with a title for the settings screen. */
export const DICTS: Record<string, { title: string; dict: Record<string, string> }> = {
  roles: { title: 'שמות תפקידים', dict: ROLES as unknown as Record<string, string> },
  roleDesc: { title: 'תיאור אחריות לכל תפקיד', dict: ROLE_DESC as unknown as Record<string, string> },
  modules: { title: 'אזורי המערכת (הרשאות)', dict: MODULES as unknown as Record<string, string> },
  taskTypes: { title: 'שמות המשימות האוטומטיות', dict: taskTypeLabels },
  taskStatus: { title: 'מצבי משימה', dict: TASK_STATUS as unknown as Record<string, string> },
  doneWhen: { title: '"נסגרת כאשר" – נתונים שסוגרים משימה', dict: DONE_WHEN as unknown as Record<string, string> },
  readiness: { title: 'פריטי צ׳קליסט המוכנות', dict: READINESS_ITEMS },
  sales: { title: 'מצבי מכירה', dict: SALES_STATUS as unknown as Record<string, string> },
  intake: { title: 'מצבי קליטה מאולם', dict: INTAKE_STATUS as unknown as Record<string, string> },
  menu: { title: 'מצבי תפריט', dict: MENU_STATUS as unknown as Record<string, string> },
  lifecycle: { title: 'מצבי אירוע', dict: LIFECYCLE as unknown as Record<string, string> },
  payment: { title: 'מצבי גבייה', dict: PAYMENT_STATUS as unknown as Record<string, string> },
  paymentKind: { title: 'סוגי תשלום', dict: PAYMENT_KIND as unknown as Record<string, string> },
  serviceKind: { title: 'סוגי שירות', dict: SERVICE_KIND as unknown as Record<string, string> },
  clientKind: { title: 'סוגי לקוח', dict: CLIENT_KIND as unknown as Record<string, string> },
  activity: { title: 'סוגי פעילות מול לקוח', dict: ACTIVITY_KIND as unknown as Record<string, string> },
  meeting: { title: 'סוגי פגישות', dict: MEETING_KIND as unknown as Record<string, string> },
  audience: { title: 'קהל למנה', dict: AUDIENCE as unknown as Record<string, string> },
  dietary: { title: 'סוגי הנחיות תזונתיות', dict: DIETARY_KIND as unknown as Record<string, string> },
  kosher: { title: 'רמות כשרות', dict: KOSHER as unknown as Record<string, string> },
  itemKind: { title: 'סוגי פריטים', dict: ITEM_KIND as unknown as Record<string, string> },
  movement: { title: 'סוגי תנועות מלאי', dict: MOVEMENT_KIND as unknown as Record<string, string> },
  po: { title: 'מצבי הזמנת רכש', dict: PO_STATUS as unknown as Record<string, string> },
  staffRoles: { title: 'תפקידי צוות באירוע', dict: STAFF_ROLES as unknown as Record<string, string> },
  report: { title: 'סוגי דיווח מהשטח', dict: REPORT_KIND as unknown as Record<string, string> },
  reportTarget: { title: 'נמעני דיווח', dict: REPORT_TARGET as unknown as Record<string, string> },
  confirmations: { title: 'אישורי מוכנות וביצוע', dict: CONFIRMATIONS as unknown as Record<string, string> },
  docKind: { title: 'סוגי מסמכים', dict: DOC_KIND as unknown as Record<string, string> },
};

// ---------------------------------------------------------------- defaults snapshot (to revert removed overrides)

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const DEFAULTS = {
  dicts: Object.fromEntries(Object.entries(DICTS).map(([k, d]) => [k, { ...d.dict }])),
  eventTypes: { ...EVENT_TYPES },
  venueEventTypes: clone(VENUE_EVENT_TYPES),
  eventStyle: { ...EVENT_STYLE },
  stages: clone(WORK_STAGES),
  matrix: clone(MATRIX),
  allergens: [...ALLERGENS],
  readinessOwner: { ...READINESS_OWNER },
  nav: clone(NAV_BY_ROLE),
  home: clone(KPIS_BY_ROLE),
  contactRoles: [...CONTACT_ROLES],
};
export const defaultNavByRole = () => clone(DEFAULTS.nav);
export const defaultHomeByRole = () => clone(DEFAULTS.home);
export const defaultContactRoles = () => [...DEFAULTS.contactRoles];

function replaceObject<T extends object>(target: T, source: object) {
  for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
  Object.assign(target, source);
}
function replaceArray<T>(target: T[], source: T[]) {
  target.splice(0, target.length, ...source);
}

/** Built-in event type list (used to seed the editor). */
export function defaultEventTypes(): EventTypeConfig[] {
  return Object.entries(DEFAULTS.eventTypes).map(([key, label]) => ({
    key, label,
    venues: Object.entries(DEFAULTS.venueEventTypes).filter(([, list]) => (list as string[]).includes(key)).map(([v]) => v),
    style: DEFAULTS.eventStyle[key] ?? 'reception',
    active: true,
  }));
}
export function defaultStages(): StageConfig[] {
  return CORE_STAGES.map((k) => ({ key: k, label: DEFAULTS.stages[k].label, desc: DEFAULTS.stages[k].desc }));
}
export function defaultLabel(ns: string, key: string): string | undefined {
  return DEFAULTS.dicts[ns]?.[key];
}

export function applyConfig(cfg: Partial<SystemConfig> | undefined, venues: VenueConfig[] | undefined): void {
  const c = { ...EMPTY_SYSTEM_CONFIG, ...(cfg ?? {}) };

  // Words.
  for (const [ns, d] of Object.entries(DICTS)) replaceObject(d.dict, { ...DEFAULTS.dicts[ns], ...(c.labels[ns] ?? {}) });
  for (const [k, def] of Object.entries(TASK_TYPES)) (def as { label: string }).label = DICTS.taskTypes.dict[k] ?? def.label;

  // Venues (stored in the venues table).
  if (venues?.length) {
    const sorted = [...venues].sort((a, b) => a.sort - b.sort);
    replaceArray(VENUE_CODES, sorted.map((v) => v.code));
    replaceObject(VENUE_LABEL, Object.fromEntries(sorted.map((v) => [v.code, v.name])));
    replaceObject(VENUE_COLORS, Object.fromEntries(sorted.map((v) => [v.code, v.color || '#6b716c'])));
    replaceObject(VENUE_RULES, Object.fromEntries(sorted.map((v) => [v.code, { track: v.track, equipment: v.equipment, loadCheck: !!v.loadCheck, siteDetails: !!v.siteDetails, maxPerDay: v.maxPerDay ?? null }])));
    replaceObject(VENUE_DEFAULTS, Object.fromEntries(sorted.map((v) => [v.code, v.defaults ?? {}])));
  }

  // Event types.
  const types = c.eventTypes.length ? c.eventTypes : defaultEventTypes();
  replaceObject(EVENT_TYPES, Object.fromEntries(types.map((t) => [t.key, t.label])));
  replaceObject(EVENT_STYLE, Object.fromEntries(types.map((t) => [t.key, t.style])));
  const byVenue: Record<string, string[]> = {};
  for (const v of VENUE_CODES) byVenue[v] = types.filter((t) => t.active && t.venues.includes(v)).map((t) => t.key);
  for (const v of VENUE_CODES) if (!byVenue[v].length) byVenue[v] = types.filter((t) => t.active).map((t) => t.key).slice(0, 1);
  replaceObject(VENUE_EVENT_TYPES, byVenue);

  // Work stages: business order, core stages always present.
  const stages = (c.workStages.length ? c.workStages : defaultStages()).filter((s) => s.key);
  for (const core of CORE_STAGES) if (!stages.some((s) => s.key === core)) stages.push(defaultStages().find((s) => s.key === core)!);
  replaceObject(WORK_STAGES, Object.fromEntries(stages.map((s, i) => [s.key, { n: i + 1, label: s.label, desc: s.desc }])));
  replaceArray(WORK_STAGE_ORDER, stages.map((s) => s.key));

  // Permissions: defaults + overrides; the owner row is never reduced (prevents locking everyone out).
  const matrix = clone(DEFAULTS.matrix);
  for (const [role, mods] of Object.entries(c.permissions)) {
    if (role === 'owner' || !(role in matrix)) continue;
    for (const [m, lvl] of Object.entries(mods ?? {})) (matrix[role as Role] as Record<string, Level>)[m] = lvl as Level;
  }
  replaceObject(MATRIX, matrix);

  replaceObject(READINESS_OWNER, { ...DEFAULTS.readinessOwner, ...(c.readinessOwners as Record<string, Role>) });
  replaceArray(ALLERGENS, c.allergens.length ? c.allergens : DEFAULTS.allergens);

  // Per-role view. The owner always keeps every menu item.
  replaceObject(NAV_BY_ROLE, { ...clone(DEFAULTS.nav), ...(c.navByRole ?? {}), owner: DEFAULTS.nav.owner });
  replaceObject(KPIS_BY_ROLE, { ...clone(DEFAULTS.home), ...(c.homeByRole ?? {}) });
  replaceArray(CONTACT_ROLES, c.contactRoles?.length ? [...new Set<Role>(['owner', ...c.contactRoles])] : DEFAULTS.contactRoles);
}
