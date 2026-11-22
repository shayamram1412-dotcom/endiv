/**
 * Business policy that management decides (spec §7 "החלטות לסגירה"). Stored in the DB, editable in Settings.
 * Principle: every value here is a default. Wherever it applies to a single record (event, task, line),
 * that record can override it by hand.
 */
import { DEFAULT_FACTORS, type KitchenFactors } from './kitchen.ts';
import type { TaskType } from './tasks.ts';
import type { Role } from './permissions.ts';
import { LEAD_SOURCES, DISH_CATEGORIES, UNITS, type StaffRole } from './domain.ts';
import type { SystemConfig } from './config.ts';

export type StaffingStyle = 'formal' | 'reception' | 'platters';

export interface BusinessSettings {
  /** Hours from trigger until the task is due, per task type. */
  taskDueHours: Partial<Record<TaskType, number>>;
  /** Automatic tasks: switch a type off, or route it to a different role. */
  autoTasks: Partial<Record<TaskType, { enabled: boolean; role?: Role | null }>>;
  /** A task with no handler this many hours after creation is escalated to supervisors… */
  unclaimedEscalationHours: number;
  /** …but only when its due time is within this many hours (0 = regardless of due time). */
  escalationWindowHours: number;
  /** Dashboard "not claimed yet" counts tasks due within this many days (0 = all). */
  unclaimedWindowDays: number;
  /** Task lists show by default only tasks due within this many days (+ overdue, blocked, undated). 0 = all. */
  taskHorizonDays: number;
  /** Days before the event when the guest count locks. */
  guestLockDays: number;
  /** Days before the event when the menu locks. */
  menuLockDays: number;
  /** Days before the event to open readiness checks. */
  readinessDays: number;
  /** The control point: everything required must be closed this many minutes before the event starts. */
  checkpointMinutes: number;
  /** Days before a supplier delivery to remind. 0 = on the day. */
  deliveryReminderDays: number;
  /** Default deposit as percent of contract, and days after signing it is due. */
  depositPct: number;
  depositDueDays: number;
  /** Days after the event the final payment is due. */
  finalDueDays: number;
  kitchen: KitchenFactors;
  /** Guests per one worker, by service style (staffing suggestion). */
  staffingRatios: Record<StaffingStyle, Partial<Record<StaffRole, number>>>;
  /** Readiness checklist items that count (false = not used by the business). */
  readinessItems: Partial<Record<string, boolean>>;
  /** Portions per food tray/box when building the loading list. */
  foodTrayPortions: number;
  /** Cost of one worker for one event, per staff group (agorot) — for the profit estimate. */
  staffShiftCost: Partial<Record<StaffRole, number>>;
  /** Target food cost as percent of revenue; above it the event is flagged. */
  foodCostTargetPct: number;
  /** Default run of show: minutes relative to the event start (negative = before). */
  runOfShow: { offsetMin: number; title: string; role: Role | '' }[];
  /** What new forms start with (each can be changed in the form itself). */
  formDefaults: {
    poLeadDays: number; poTime: string; payableTermsDays: number;
    meetingLeadDays: number; tourTime: string; tastingTime: string;
    /** Starting price per guest in a new quote, per event type (agorot). */
    quotePerGuest: Record<string, number>;
  };
  /** How many backups to keep (a verified backup is taken automatically every day). */
  backupKeep: number;
  /** Business details printed on quotes, orders and event sheets. */
  business: { name: string; legalName: string; taxId: string; phone: string; email: string; address: string; quoteTerms: string; poNote: string };
  /** Editable pick lists. */
  lists: { leadSources: string[]; dishCategories: string[]; units: string[] };
  /** Vocabulary, event types, stages, permissions… (see shared/config.ts). */
  system: SystemConfig;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  taskDueHours: {
    lead_followup: 4,
    schedule_tasting: 72,
    verify_intake: 24,
    complete_intake: 48,
    menu_ack_kitchen: 12,
    menu_ack_field: 12,
    guest_change: 24,
    order_shortage: 24,
    unload_check: 6,
    report_handle: 1,
    return_rentals: 48,
    feedback_call: 72,
    collect_balance: 24,
    manual: 24,
  },
  autoTasks: {},
  unclaimedEscalationHours: 8,
  escalationWindowHours: 72,
  unclaimedWindowDays: 7,
  taskHorizonDays: 7,
  guestLockDays: 7,
  menuLockDays: 10,
  readinessDays: 3,
  checkpointMinutes: 60,
  deliveryReminderDays: 0,
  depositPct: 30,
  depositDueDays: 7,
  finalDueDays: 14,
  kitchen: DEFAULT_FACTORS,
  staffingRatios: {
    formal: { waiter: 12, cook: 60, bartender: 80, bar_manager: 300, setup: 60 },
    reception: { waiter: 20, cook: 80, bartender: 100, bar_manager: 400, setup: 80 },
    platters: { setup: 150 },
  },
  readinessItems: {},
  foodTrayPortions: 20,
  staffShiftCost: { waiter: 45000, cook: 60000, bartender: 50000, bar_manager: 70000, setup: 40000 },
  foodCostTargetPct: 30,
  backupKeep: 30,
  formDefaults: { poLeadDays: 1, poTime: '08:00', payableTermsDays: 30, meetingLeadDays: 3, tourTime: '11:00', tastingTime: '17:00', quotePerGuest: {} },
  business: {
    name: 'מטבחון', legalName: '', taxId: '', phone: '', email: '', address: '',
    quoteTerms: 'ההצעה בתוקף ל-14 יום. המחיר כולל מע״מ אלא אם צוין אחרת. מספר האורחים הסופי ייקבע 7 ימים לפני האירוע. מקדמה של 30% עם החתימה, היתרה עד 14 יום לאחר האירוע.',
    poNote: 'נא לאשר קבלת ההזמנה ומועד האספקה. אספקה למחסן היעד בשעה שצוינה.',
  },
  runOfShow: [
    { offsetMin: -300, title: 'יציאת משאית מהמטבח', role: 'logistics' },
    { offsetMin: -240, title: 'הגעת צוות הקמה', role: 'event_manager' },
    { offsetMin: -120, title: 'הגעת מטבח ותחילת חימום', role: 'kitchen' },
    { offsetMin: -60, title: 'נקודת בקרה: הכול מוכן', role: 'event_manager' },
    { offsetMin: 0, title: 'קבלת פנים', role: 'event_manager' },
    { offsetMin: 90, title: 'הגשת מנה ראשונה', role: 'kitchen' },
    { offsetMin: 150, title: 'הגשת עיקרית', role: 'kitchen' },
    { offsetMin: 210, title: 'קינוחים ושתייה חמה', role: 'kitchen' },
    { offsetMin: 300, title: 'פירוק והעמסה', role: 'logistics' },
  ],
  lists: { leadSources: [...LEAD_SOURCES], dishCategories: [...DISH_CATEGORIES], units: [...UNITS] },
  system: { labels: {}, eventTypes: [], workStages: [], permissions: {}, readinessOwners: {}, allergens: [] },
};

export function mergeSettings(stored: Partial<BusinessSettings> | null | undefined): BusinessSettings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    taskDueHours: { ...DEFAULT_SETTINGS.taskDueHours, ...(s.taskDueHours ?? {}) },
    autoTasks: { ...(s.autoTasks ?? {}) },
    kitchen: {
      ...DEFAULT_SETTINGS.kitchen,
      ...(s.kitchen ?? {}),
      typeFactor: { ...DEFAULT_SETTINGS.kitchen.typeFactor, ...(s.kitchen?.typeFactor ?? {}) },
    },
    staffingRatios: {
      formal: { ...DEFAULT_SETTINGS.staffingRatios.formal, ...(s.staffingRatios?.formal ?? {}) },
      reception: { ...DEFAULT_SETTINGS.staffingRatios.reception, ...(s.staffingRatios?.reception ?? {}) },
      platters: { ...DEFAULT_SETTINGS.staffingRatios.platters, ...(s.staffingRatios?.platters ?? {}) },
    },
    readinessItems: { ...(s.readinessItems ?? {}) },
    staffShiftCost: { ...DEFAULT_SETTINGS.staffShiftCost, ...(s.staffShiftCost ?? {}) },
    runOfShow: s.runOfShow ?? DEFAULT_SETTINGS.runOfShow,
    business: { ...DEFAULT_SETTINGS.business, ...(s.business ?? {}) },
    formDefaults: { ...DEFAULT_SETTINGS.formDefaults, ...(s.formDefaults ?? {}), quotePerGuest: { ...(s.formDefaults?.quotePerGuest ?? {}) } },
    lists: { ...DEFAULT_SETTINGS.lists, ...(s.lists ?? {}) },
    system: { ...DEFAULT_SETTINGS.system, ...(s.system ?? {}) },
  };
}

/** Is this automatic task type switched on, and which role gets it. */
export function autoTaskConfig(s: BusinessSettings, type: TaskType, defaultRole: Role): { enabled: boolean; role: Role } {
  const c = s.autoTasks[type];
  return { enabled: c?.enabled !== false, role: c?.role || defaultRole };
}
