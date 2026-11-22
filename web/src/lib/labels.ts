/** Hebrew labels for fields (forms, conflict dialogs, history). */
export const EVENT_FIELD_LABELS: Record<string, string> = {
  title: 'כותרת', eventType: 'סוג אירוע', serviceKind: 'סוג שירות', date: 'תאריך', dateFlexible: 'תאריך גמיש',
  startTime: 'שעת התחלה', endTime: 'שעת סיום', deliveryTime: 'שעת מסירה', guests: 'אורחים', kids: 'ילדים',
  vegetarian: 'צמחונים', vegan: 'טבעונים', menuType: 'סוג תפריט', kosher: 'כשרות', address: 'כתובת',
  siteContactName: 'איש קשר בשטח', siteContactPhone: 'טלפון בשטח', siteRequirements: 'דרישות המקום',
  specialRequests: 'בקשות מיוחדות', notes: 'הערות', salesStatus: 'מצב מכירה', source: 'מקור פנייה', campaign: 'קמפיין',
  lostReason: 'סיבת אי-סגירה', contractTotal: 'סכום חוזה', payer: 'גורם משלם', intakeStatus: 'מצב קליטה',
  hallContactName: 'איש קשר באולם', hallContactPhone: 'טלפון האולם', intakeMissing: 'פרטים חסרים',
  eventManagerId: 'מנהל אירוע', kitchenManagerId: 'מנהל מטבח', brandManagerId: 'מנהל מותג', salesRepId: 'נציגת מכירות',
  ubeyaRef: 'מזהה Ubeya', clientId: 'לקוח', name: 'שם', phone: 'טלפון', email: 'מייל', company: 'חברה', kind: 'סוג',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: 'נוצר', updated: 'עודכן', signed: 'חוזה נחתם', menu_saved: 'תפריט נשמר', menu_approved: 'תפריט אושר',
  menu_changed: 'שינוי בתפריט מאושר', menu_ack: 'אישור קבלת תפריט', prep_planned: 'תכנון הכנה',
  requirements_approved: 'דרישה אושרה', consumed: 'צריכה נרשמה', received: 'התקבל', scheduled: 'תוזמן',
  completed: 'בוצע', acked: 'התקבל', resolved: 'טופל', uploaded: 'הועלה', deleted: 'נמחק', late_change: 'שינוי מאוחר',
  generated: 'נוצר מתבנית', 'count:loaded': 'ספירת העמסה', 'count:unloaded': 'ספירת פריקה', 'count:returned': 'החזרה לספק',
  'lifecycle:cancelled': 'בוטל', 'lifecycle:closed': 'נסגר', 'lifecycle:planning': 'נפתח מחדש', 'lifecycle:completed': 'בוצע',
};

export function auditActionLabel(a: string): string {
  if (AUDIT_ACTION_LABELS[a]) return AUDIT_ACTION_LABELS[a];
  if (a.startsWith('confirm:')) return 'אישור';
  if (a.startsWith('unconfirm:')) return 'ביטול אישור';
  if (a.startsWith('movement:')) return 'תנועת מלאי';
  return a;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  return String(v);
}
