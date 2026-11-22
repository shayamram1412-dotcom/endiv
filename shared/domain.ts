/**
 * Core business vocabulary of the catering operation.
 * Everything that is a business rule (not data) lives here so the server and the UI agree.
 */

// ---------------------------------------------------------------- venues
/** Built-in venues; the business can add, rename and reconfigure venues in Settings (runtime registry). */
export type BuiltinVenue = 'winery' | 'eden' | 'farm' | 'offsite';
export type VenueCode = BuiltinVenue | (string & {});
export const VENUE_CODES: VenueCode[] = ['winery', 'eden', 'farm', 'offsite'];

/** How each venue works. These rules drive forms, checklists and automatic tasks. */
export interface VenueRules {
  /** direct = we sell (lead → quote → tour → contract). hall = the hall sold it and hands it over. */
  track: 'direct' | 'hall';
  /** rental = reusable serving ware rented from outside and returned. consumables = disposable only.
   *  none = no equipment from the catering side. site = per-site requirements (offsite). */
  equipment: 'rental' | 'consumables' | 'none' | 'site';
  /** Count food + equipment before loading and again after unloading (farm). */
  loadCheck: boolean;
  /** Needs site details: address, on-site contact, delivery/execution hours. */
  siteDetails: boolean;
  /** How many events the venue can take on one day (null = no limit). */
  maxPerDay?: number | null;
}

/** What a new event at this venue starts with. Every value can still be changed on the event itself. */
export interface VenueDefaults {
  eventType?: string;
  serviceKind?: 'full' | 'platters';
  startTime?: string;
  endTime?: string;
  deliveryTime?: string;
  guests?: number | null;
  kosher?: string;
  menuType?: string;
  eventManagerId?: number | null;
  /** Hall-sold venues: the hall's contact and who pays — the same for every event there. */
  hallContactName?: string;
  hallContactPhone?: string;
  payer?: string;
  address?: string;
}
export const VENUE_DEFAULTS: Record<string, VenueDefaults> = {};

export const VENUE_RULES: Record<VenueCode, VenueRules> = {
  winery: { track: 'direct', equipment: 'rental', loadCheck: false, siteDetails: false },
  eden: { track: 'hall', equipment: 'none', loadCheck: false, siteDetails: false },
  farm: { track: 'hall', equipment: 'consumables', loadCheck: true, siteDetails: false },
  offsite: { track: 'direct', equipment: 'site', loadCheck: false, siteDetails: true },
};

export const VENUE_LABEL: Record<VenueCode, string> = {
  winery: 'יקב',
  eden: 'עדן על המים',
  farm: 'חוות עמק איילון',
  offsite: 'אירועי חוץ',
};

export const VENUE_COLORS: Record<VenueCode, string> = {
  winery: '#7a2948',
  eden: '#1d6fa3',
  farm: '#6b7d1f',
  offsite: '#a15c12',
};

// ---------------------------------------------------------------- event types
export const EVENT_TYPES = {
  conference: 'כנס',
  corporate: 'אירוע חברה',
  birthday: 'יום הולדת',
  wedding: 'חתונה',
  bar_mitzvah: 'בר/בת מצווה',
  catering: 'קייטרינג',
  platters: 'מגשי אירוח',
  private: 'אירוע פרטי',
  other: 'אחר',
} as Record<string, string>;
export type BuiltinEventType = 'conference' | 'corporate' | 'birthday' | 'wedding' | 'bar_mitzvah' | 'catering' | 'platters' | 'private' | 'other';
/** Event types are editable in Settings (runtime registry). */
export type EventType = BuiltinEventType | (string & {});

/** Which event types are offered per venue (first one is the default). */
export const VENUE_EVENT_TYPES: Record<VenueCode, EventType[]> = {
  winery: ['conference', 'corporate', 'birthday', 'platters', 'private', 'other'],
  eden: ['wedding', 'bar_mitzvah', 'private'],
  farm: ['wedding', 'bar_mitzvah', 'private'],
  offsite: ['catering', 'platters', 'corporate', 'private', 'other'],
};

// ---------------------------------------------------------------- statuses (independent dimensions)
export const SALES_STATUS = {
  lead: 'פנייה',
  quoted: 'הצעה נשלחה',
  tour: 'סיור',
  signed: 'חוזה נחתם',
  lost: 'לא נסגר',
  hall: 'נמכר ע״י האולם',
} as const;
export type SalesStatus = keyof typeof SALES_STATUS;
export const DIRECT_PIPELINE: SalesStatus[] = ['lead', 'quoted', 'tour', 'signed'];

export const INTAKE_STATUS = {
  received: 'התקבל – ממתין לאימות',
  missing: 'חסרים פרטים',
  verified: 'פרטים אומתו',
} as const;
export type IntakeStatus = keyof typeof INTAKE_STATUS;

export const MENU_STATUS = {
  open: 'טרם נקבע',
  draft: 'בבנייה',
  approved: 'מאושר',
  changed: 'שונה – ממתין לאישורי קבלה',
} as const;
export type MenuStatus = keyof typeof MENU_STATUS;

export const LIFECYCLE = {
  planning: 'בתכנון',
  completed: 'בוצע – בסגירה',
  closed: 'סגור',
  cancelled: 'בוטל',
} as const;
export type Lifecycle = keyof typeof LIFECYCLE;

export const PAYMENT_STATUS = {
  none: 'אין התחייבות',
  deposit_due: 'ממתין למקדמה',
  deposit_late: 'מקדמה באיחור',
  balance_due: 'יתרה פתוחה',
  balance_late: 'יתרה באיחור',
  paid: 'שולם במלואו',
} as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUS;

export const SERVICE_KIND = { full: 'אירוע מלא', platters: 'מגשים / מסירה' } as const;
export type ServiceKind = keyof typeof SERVICE_KIND;

// ---------------------------------------------------------------- CRM
export const CLIENT_KIND = { private: 'פרטי', company: 'חברה', producer: 'מפיק' } as const;
export type ClientKind = keyof typeof CLIENT_KIND;

export const ACTIVITY_KIND = {
  call: 'שיחה',
  whatsapp: 'וואטסאפ',
  email: 'מייל',
  meeting: 'פגישה',
  note: 'הערה',
  feedback: 'משוב',
  complaint: 'תלונה',
} as const;
export type ActivityKind = keyof typeof ACTIVITY_KIND;

export const LEAD_SOURCES = ['אתר', 'אינסטגרם', 'פייסבוק', 'גוגל', 'המלצה', 'לקוח חוזר', 'מפיק', 'טלפון', 'אחר'] as const;

export const MEETING_KIND = { tour: 'סיור', tasting: 'טעימות', call: 'שיחה מתוזמנת' } as const;
export type MeetingKind = keyof typeof MEETING_KIND;

// ---------------------------------------------------------------- menu & kitchen
export const DISH_CATEGORIES = ['קבלת פנים', 'ראשונות', 'עיקריות', 'תוספות', 'קינוחים', 'מגשים', 'בר', 'ילדים'] as const;

export const AUDIENCE = { all: 'כל האורחים', adults: 'מבוגרים', kids: 'ילדים', veg: 'צמחונים', vegan: 'טבעונים' } as const;
export type Audience = keyof typeof AUDIENCE;

export const DIETARY_KIND = {
  allergy: 'אלרגיה',
  vegetarian: 'צמחוני',
  vegan: 'טבעוני',
  gluten_free: 'ללא גלוטן',
  kids: 'ילדים',
  kosher: 'כשרות',
  other: 'אחר',
} as const;
export type DietaryKind = keyof typeof DIETARY_KIND;

export const ALLERGENS: string[] = ['גלוטן', 'אגוזים', 'בוטנים', 'שומשום', 'חלב', 'ביצים', 'דגים', 'סויה', 'סלרי', 'חרדל'];

export const KOSHER = { none: 'לא כשר', kosher: 'כשר', mehadrin: 'כשר למהדרין' } as const;
export type Kosher = keyof typeof KOSHER;

// ---------------------------------------------------------------- inventory & purchasing
export const ITEM_KIND = {
  food: 'חומר גלם',
  consumable: 'מתכלה',
  rental: 'ציוד שכור',
  equipment: 'ציוד בבעלות',
} as const;
export type ItemKind = keyof typeof ITEM_KIND;

export const UNITS = ['ק״ג', 'גרם', 'ליטר', 'יח׳', 'ארגז', 'חבילה', 'מנה', 'צרור'] as const;

export const MOVEMENT_KIND = {
  receipt: 'קבלה מספק',
  consumption: 'צריכה לאירוע',
  transfer_out: 'העברה – יציאה',
  transfer_in: 'העברה – כניסה',
  adjustment: 'התאמת מלאי',
  count: 'ספירה',
} as const;
export type MovementKind = keyof typeof MOVEMENT_KIND;

export const PO_STATUS = {
  draft: 'טיוטה',
  ordered: 'הוזמן',
  partial: 'התקבל חלקית',
  received: 'התקבל',
  cancelled: 'בוטל',
} as const;
export type PoStatus = keyof typeof PO_STATUS;

// ---------------------------------------------------------------- staffing & field
export const STAFF_ROLES = {
  waiter: 'מלצרים',
  cook: 'טבחים',
  bartender: 'ברמנים',
  bar_manager: 'מנהלי בר',
  setup: 'הקמה ופירוק',
} as const;
export type StaffRole = keyof typeof STAFF_ROLES;
/** Who is responsible for each staff group (spec §2). */
export const STAFF_ROLE_OWNER: Record<StaffRole, 'kitchen' | 'event_manager'> = {
  waiter: 'event_manager',
  cook: 'kitchen',
  bartender: 'event_manager',
  bar_manager: 'event_manager',
  setup: 'event_manager',
};

export const REPORT_KIND = {
  change: 'שינוי',
  shortage: 'חוסר',
  issue: 'תקלה',
  timing: 'שינוי לו״ז',
} as const;
export type ReportKind = keyof typeof REPORT_KIND;
export const REPORT_TARGET = { kitchen: 'מטבח', event_manager: 'מנהל אירוע', ops: 'תפעול' } as const;
export type ReportTarget = keyof typeof REPORT_TARGET;

export const CONFIRMATIONS = {
  kitchen_ready: 'מנהל המטבח אישר מוכנות מזון',
  field_ready: 'מנהל האירוע אישר מוכנות',
  loaded: 'העמסה נספרה ואושרה',
  unloaded: 'פריקה נספרה ואושרה',
  executed: 'ביצוע האירוע הסתיים',
  rentals_returned: 'כלים שכורים הוחזרו לספק',
} as const;
export type ConfirmationKind = keyof typeof CONFIRMATIONS;

// ---------------------------------------------------------------- payments
export const PAYMENT_KIND = { deposit: 'מקדמה', interim: 'תשלום ביניים', final: 'תשלום סופי' } as const;
export type PaymentKind = keyof typeof PAYMENT_KIND;

export const DOC_KIND = { quote: 'הצעת מחיר', contract: 'חוזה', menu: 'תפריט', invoice: 'חשבונית/קבלה', other: 'אחר' } as const;
export type DocKind = keyof typeof DOC_KIND;

// ---------------------------------------------------------------- work process (8 stages, MTD/owner process map)
export const WORK_STAGES: Record<string, { n: number; label: string; desc: string }> = {
  inquiry: { n: 1, label: 'פנייה וטעימות', desc: 'תיעוד הפנייה, דרישות הלקוח ותיאום טעימות' },
  menu_quote: { n: 2, label: 'תפריט והצעת מחיר', desc: 'בחירת תפריט, בניית הצעה ומעקב עד חתימה' },
  opening: { n: 3, label: 'פתיחת אירוע', desc: 'תאריך, מיקום, היקף וצוות אחראי לאירוע' },
  purchasing: { n: 4, label: 'רכש וספקים', desc: 'כמויות, הזמנות, מועדי הגעה ואישורי ספקים' },
  kitchen: { n: 5, label: 'מטבח והכנות', desc: 'תוכנית הכנה, חומרי גלם ואריזה ליציאה' },
  equipment_staff: { n: 6, label: 'ציוד וצוות', desc: 'שיבוץ תפקידים, ציוד, הסעות והקמת השטח' },
  readiness: { n: 7, label: 'מוכנות לאירוע', desc: 'בדיקת השלמה ומיון חריגים לפני האירוע' },
  closing: { n: 8, label: 'סגירה ותשלומים', desc: 'החזרות, חשבונות ספקים, תשלום לקוח ומשוב' },
};
/** Core stages the logic relies on; the business can rename, describe, reorder and add stages. */
export type CoreStage = 'inquiry' | 'menu_quote' | 'opening' | 'purchasing' | 'kitchen' | 'equipment_staff' | 'readiness' | 'closing';
export type WorkStage = CoreStage | (string & {});
export const CORE_STAGES: CoreStage[] = ['inquiry', 'menu_quote', 'opening', 'purchasing', 'kitchen', 'equipment_staff', 'readiness', 'closing'];
export const WORK_STAGE_ORDER: WorkStage[] = [...CORE_STAGES];
/** Stages that apply while a direct sale is not closed yet; the rest start once the event is committed. */
export const PRE_SALE_STAGES: WorkStage[] = ['inquiry', 'menu_quote'];

/**
 * Operational facts a template task can be tied to: the task closes automatically when the fact is recorded,
 * so the checklist never disagrees with the data.
 */
export const DONE_WHEN = {
  contract_signed: 'החוזה נחתם / האירוע נקלט מהאולם',
  tasting_scheduled: 'נקבעה פגישת טעימות',
  menu_approved: 'התפריט אושר',
  intake_verified: 'פרטי הקליטה אומתו',
  manager_assigned: 'שובץ מנהל אירוע',
  requirements_approved: 'אושרה דרישת חומרי גלם',
  stock_covered: 'אין חוסר במלאי לאירוע',
  deliveries_received: 'כל האספקות לאירוע התקבלו',
  prep_planned: 'לכל המנות נקבע יום הכנה',
  equipment_listed: 'הופקה רשימת ציוד',
  rentals_confirmed: 'כלים שכורים אושרו מול הספק',
  staffing_full: 'הצוות שובץ לפי התקן',
  kitchen_ready: 'מנהל המטבח אישר מוכנות',
  field_ready: 'מנהל האירוע אישר מוכנות',
  loaded: 'העמסה נספרה',
  executed: 'ביצוע האירוע הסתיים',
  rentals_returned: 'כלים הוחזרו לספק',
  deposit_paid: 'מקדמה התקבלה',
  fully_paid: 'שולם במלואו',
  feedback_logged: 'תועד משוב לקוח',
} as const;
export type DoneWhen = keyof typeof DONE_WHEN;

/** What a template task's timing is measured from (editable per template). */
export const TIMING_ANCHOR = {
  event_start: 'תחילת האירוע',
  event_end: 'סיום האירוע',
  contract_signed: 'חתימת החוזה / קליטה מהאולם',
  event_created: 'פתיחת האירוע במערכת',
} as const;
export type TimingAnchor = keyof typeof TIMING_ANCHOR;
