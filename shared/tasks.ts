/**
 * Catalogue of automatic tasks (spec §4): who gets them, what action is expected,
 * and what counts as evidence of completion.
 */
import type { Role } from './permissions.ts';
import type { WorkStage } from './domain.ts';

export interface TaskTypeDef {
  label: string;
  role: Role;
  /** The trigger, in business words. */
  trigger: string;
  /** What closes the task. */
  evidence: string;
  /** Closed automatically when the operational data proves it (vs. closed by hand with a note). */
  auto: boolean;
  /** Stage of the work process the task belongs to. */
  stage: WorkStage;
  /** Counts toward event readiness. */
  required?: boolean;
}

export const TASK_TYPES = {
  lead_followup: { label: 'חזרה לפנייה חדשה', role: 'sales', trigger: 'נקלטה פנייה חדשה', evidence: 'תיעוד שיחה עם תוצאה ופעולה הבאה', auto: true, stage: 'inquiry' },
  scheduled_call: { label: 'שיחה מתוזמנת ללקוח', role: 'sales', trigger: 'נקבעה שיחת המשך', evidence: 'תיעוד שיחה עם תוצאה ופעולה הבאה', auto: true, stage: 'inquiry' },
  schedule_tasting: { label: 'תיאום טעימות', role: 'sales', trigger: 'חוזה נחתם', evidence: 'פגישת טעימות ביומן', auto: true, stage: 'inquiry' },
  track_deposit: { label: 'מעקב מקדמה', role: 'accountant', trigger: 'חוזה נחתם', evidence: 'תקבול מקדמה מתועד', auto: true, stage: 'menu_quote' },
  verify_intake: { label: 'אימות קליטת אירוע מהאולם', role: 'brand', trigger: 'התקבל אירוע מהאולם', evidence: 'הפרטים אומתו או נפתחה משימת השלמה', auto: true, stage: 'opening' },
  complete_intake: { label: 'השלמת פרטי אירוע מהאולם', role: 'brand', trigger: 'סומנו פרטים חסרים בקליטה', evidence: 'הפרטים אומתו', auto: true, stage: 'opening' },
  menu_ack_kitchen: { label: 'בדיקת שינוי תפריט – מטבח', role: 'kitchen', trigger: 'עודכן תפריט לאחר אישור', evidence: 'אישור קבלה של המטבח', auto: true, stage: 'kitchen', required: true },
  menu_ack_field: { label: 'בדיקת שינוי תפריט – מנהל אירוע', role: 'event_manager', trigger: 'עודכן תפריט לאחר אישור', evidence: 'אישור קבלה של מנהל האירוע', auto: true, stage: 'readiness', required: true },
  guest_change: { label: 'שינוי במספר האורחים – בדיקת הכנות ורכש', role: 'kitchen', trigger: 'מספר האורחים השתנה אחרי אישור תפריט', evidence: 'אישור שהדרישות עודכנו', auto: false, stage: 'kitchen', required: true },
  order_shortage: { label: 'הזמנת חוסר מספק', role: 'purchasing', trigger: 'אושרה דרישה עם חוסר במלאי', evidence: 'הזמנת רכש פתוחה מכסה את החוסר', auto: true, stage: 'purchasing', required: true },
  verify_delivery: { label: 'אימות קבלת אספקה', role: 'purchasing', trigger: 'הגיע מועד אספקה', evidence: 'כמות בפועל, שעת קבלה וטיפול בפער', auto: true, stage: 'purchasing', required: true },
  unload_check: { label: 'ספירה לאחר פריקה', role: 'ops', trigger: 'הושלמה העמסה (בנקודה עם ספירת העמסה)', evidence: 'ספירה בפועל ודיווח פערים', auto: true, stage: 'closing' },
  report_handle: { label: 'טיפול בדיווח מהשטח', role: 'event_manager', trigger: 'דווח חוסר / שינוי בזמן האירוע', evidence: 'אישור קבלה ותיעוד פתרון', auto: true, stage: 'readiness' },
  readiness_check: { label: 'בדיקת מוכנות לפני אירוע', role: 'event_manager', trigger: 'האירוע מתקרב', evidence: 'אישור מוכנות של מנהל האירוע', auto: true, stage: 'readiness', required: true },
  kitchen_readiness: { label: 'אישור מוכנות מזון', role: 'kitchen', trigger: 'האירוע מתקרב', evidence: 'אישור מוכנות של מנהל המטבח', auto: true, stage: 'kitchen', required: true },
  return_rentals: { label: 'החזרת כלים שכורים לספק', role: 'event_manager', trigger: 'הסתיים אירוע עם ציוד שכור', evidence: 'אישור החזרה עם כמויות', auto: true, stage: 'closing' },
  collect_balance: { label: 'גביית יתרה', role: 'accountant', trigger: 'הסתיים אירוע עם יתרה פתוחה', evidence: 'תקבול מתועד', auto: true, stage: 'closing' },
  feedback_call: { label: 'שיחת משוב ללקוח', role: 'sales', trigger: 'הסתיים אירוע', evidence: 'תיעוד שיחת משוב', auto: true, stage: 'closing' },
  template: { label: 'משימת תהליך', role: 'ops', trigger: 'תבנית העבודה של האירוע', evidence: 'לפי הגדרת התבנית', auto: false, stage: 'readiness' },
  manual: { label: 'משימה', role: 'ops', trigger: 'נפתחה ידנית', evidence: 'סימון ביצוע עם הערה', auto: false, stage: 'readiness' },
} as const satisfies Record<string, TaskTypeDef>;
export type TaskType = keyof typeof TASK_TYPES;

export const TASK_STATUS = { open: 'פתוחה', in_progress: 'בטיפול', blocked: 'חסומה', done: 'בוצעה', cancelled: 'בוטלה' } as const;
/** Statuses that still need work. */
export const OPEN_STATUSES = ['open', 'in_progress', 'blocked'] as const;
export const OPEN_SQL = "('open','in_progress','blocked')";
export type TaskStatus = keyof typeof TASK_STATUS;
