/**
 * Demo data for training and acceptance tests (spec §5 "נתוני הדגמה"). Dates are relative to today.
 * Scenarios: a client with two events and different menus, a hall wedding awaiting intake verification,
 * a farm wedding with an unloading gap, a partial supplier delivery, a scheduled follow-up call,
 * two events competing for the same stock (100 vs 70+60), an offsite event with on-site crew, and a platters delivery.
 */
import { all, get, insert, run, tx } from '../core/db.ts';
import { hashPassword } from '../core/auth.ts';
import { addDays, nowISO, today, addHours } from '../../shared/dates.ts';
import { diffMenus } from '../../shared/menuDiff.ts';
import { DEFAULT_SETTINGS } from '../../shared/settings.ts';
import { reloadConfig } from '../core/config.ts';
import { loadEvent, menuSnapshot } from '../features/events/service.ts';
import { reconcileEvent, sweep } from '../features/tasks/engine.ts';
import type { Role } from '../../shared/permissions.ts';
import type { VenueCode, EventType } from '../../shared/domain.ts';

export const DEMO_PASSWORD = 'demo1234';

let rng = 42;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
const ils = (n: number) => Math.round(n * 100);

export function seedDemo(): void {
  rng = 42;
  const T = today();
  const now = nowISO();
  tx(() => {
    // ------------------------------------------------------------ venues & warehouses
    const venues: [VenueCode, string, string, string, string, number, number, string][] = [
      ['winery', 'יקב', 'היקב, מושב גבעת ישעיהו', 'direct', 'rental', 0, 0, '#7a2948'],
      ['eden', 'עדן על המים', 'עדן על המים, קיבוץ חולדה', 'hall', 'none', 0, 0, '#1d6fa3'],
      ['farm', 'חוות עמק איילון', 'חוות עמק איילון, דרך הנחל', 'hall', 'consumables', 1, 0, '#6b7d1f'],
      ['offsite', 'אירועי חוץ', '', 'direct', 'site', 0, 1, '#a15c12'],
    ];
    venues.forEach(([code, name, address, track, equipment, loadCheck, siteDetails, color], i) =>
      insert('venues', { code, name, address, sort: i, track, equipment, load_check: loadCheck, site_details: siteDetails, color, max_per_day: ({ winery: 1, eden: 2, farm: 1 } as Record<string, number>)[code] ?? null,
        defaults: JSON.stringify(({
          eden: { eventType: 'wedding', startTime: '19:00', endTime: '23:30', kosher: 'kosher', payer: 'האולם', hallContactName: 'מנהלת אירועים באולם', hallContactPhone: '08-9000000' },
          farm: { eventType: 'wedding', startTime: '19:00', endTime: '23:30', payer: 'האולם', hallContactName: 'מנהל החווה', hallContactPhone: '08-9111111' },
          winery: { startTime: '19:00', endTime: '23:00' },
        } as Record<string, object>)[code] ?? {}) }));
    reloadConfig();
    const whCentral = insert('warehouses', { name: 'מטבח מרכזי – מחסן ומקררים', venue: null });
    const whWinery = insert('warehouses', { name: 'מחסן היקב', venue: 'winery' });
    const whFarm = insert('warehouses', { name: 'מחסן החווה', venue: 'farm' });
    insert('warehouses', { name: 'מחסן אירועי חוץ', venue: 'offsite' });

    run("INSERT INTO settings (key, value, updated_at) VALUES ('business', ?, ?)", JSON.stringify(DEFAULT_SETTINGS), now);

    // ------------------------------------------------------------ users
    const pw = hashPassword(DEMO_PASSWORD);
    const user = (name: string, email: string, grants: [Role, VenueCode | null][]) => {
      const id = insert('users', { name, email, phone: '050-0000000', password_hash: pw, created_at: now });
      for (const [role, venue] of grants) insert('user_roles', { user_id: id, role, venue });
      return id;
    };
    const U = {
      owner: user('אבי – בעלים', 'owner@demo.local', [['owner', null]]),
      vp: user('מירב – סמנכ״לית', 'vp@demo.local', [['owner', null]]),
      ops: user('יוסי – מנהל תפעול', 'ops@demo.local', [['ops', null]]),
      sales1: user('נועה – שירות ומכירות', 'sales1@demo.local', [['sales', null]]),
      sales2: user('שירן – שירות ומכירות', 'sales2@demo.local', [['sales', null]]),
      brandEden: user('רועי – מנהל מותג עדן', 'brand.eden@demo.local', [['brand', 'eden']]),
      brandFarm: user('טל – מנהלת מותג החווה', 'brand.farm@demo.local', [['brand', 'farm']]),
      chef: user('שף דניאל – מנהל מטבח', 'chef@demo.local', [['kitchen', null]]),
      buyer: user('אורי – מנהל רכש', 'buyer@demo.local', [['purchasing', null]]),
      em1: user('גיא – מנהל אירוע', 'em1@demo.local', [['event_manager', 'winery'], ['event_manager', 'offsite']]),
      em2: user('ליאת – מנהלת אירוע', 'em2@demo.local', [['event_manager', 'eden'], ['event_manager', 'farm']]),
      acc: user('רונית – הנהלת חשבונות', 'acc@demo.local', [['accountant', null]]),
      logistics: user('דוד – אחראי ציוד ולוגיסטיקה', 'logistics@demo.local', [['logistics', null]]),
      crew: user('מאיה – אחראית צוות ומלצרים', 'crew@demo.local', [['crew', null]]),
      staff: user('עובד משלים', 'staff@demo.local', [['staff', 'farm']]),
    };

    // ------------------------------------------------------------ suppliers & items
    const S = {
      meat: insert('suppliers', { name: 'אטליז הגליל', contact: 'משה', phone: '04-6000001', categories: 'בשר, עוף' }),
      fish: insert('suppliers', { name: 'דגי הים התיכון', contact: 'רמי', phone: '03-6000002', categories: 'דגים' }),
      veg: insert('suppliers', { name: 'ירקות השרון', contact: 'חנה', phone: '09-6000003', categories: 'ירקות, פירות, עשבים' }),
      dry: insert('suppliers', { name: 'מכולת סיטונאית', contact: 'אלי', phone: '08-6000004', categories: 'יבשים, שמנים, תבלינים' }),
      dairy: insert('suppliers', { name: 'מחלבות הצפון', contact: 'יעל', phone: '04-6000005', categories: 'חלב וביצים' }),
      disp: insert('suppliers', { name: 'חד-פעמי פלוס', contact: 'דודי', phone: '03-6000006', categories: 'מתכלים' }),
      rent: insert('suppliers', { name: 'השכרות כלים בע״מ', contact: 'סיגל', phone: '03-6000007', categories: 'כלי הגשה להשכרה' }),
    };
    const item = (name: string, kind: string, unit: string, category: string, supplier: number, min = 0) =>
      insert('items', { name, kind, unit, category, supplier_id: supplier, min_stock: min });
    const I = {
      beef: item('צלעות בקר', 'food', 'ק״ג', 'בשר', S.meat, 10),
      entrecote: item('אנטריקוט', 'food', 'ק״ג', 'בשר', S.meat, 5),
      chicken: item('פרגיות', 'food', 'ק״ג', 'עוף', S.meat, 20),
      chickenBreast: item('חזה עוף', 'food', 'ק״ג', 'עוף', S.meat, 10),
      salmon: item('פילה סלמון', 'food', 'ק״ג', 'דגים', S.fish, 5),
      seabass: item('פילה דניס', 'food', 'ק״ג', 'דגים', S.fish),
      potato: item('תפוחי אדמה', 'food', 'ק״ג', 'ירקות', S.veg, 30),
      sweetPotato: item('בטטה', 'food', 'ק״ג', 'ירקות', S.veg),
      lettuce: item('חסה', 'food', 'יח׳', 'ירקות', S.veg),
      tomato: item('עגבניות שרי', 'food', 'ק״ג', 'ירקות', S.veg),
      cucumber: item('מלפפונים', 'food', 'ק״ג', 'ירקות', S.veg),
      eggplant: item('חצילים', 'food', 'ק״ג', 'ירקות', S.veg),
      herbs: item('עשבי תיבול', 'food', 'צרור', 'ירקות', S.veg),
      lemon: item('לימונים', 'food', 'ק״ג', 'פירות', S.veg),
      rice: item('אורז', 'food', 'ק״ג', 'יבשים', S.dry, 20),
      flour: item('קמח', 'food', 'ק״ג', 'יבשים', S.dry, 25),
      oil: item('שמן זית', 'food', 'ליטר', 'יבשים', S.dry, 10),
      tahini: item('טחינה גולמית', 'food', 'ק״ג', 'יבשים', S.dry),
      chocolate: item('שוקולד מריר', 'food', 'ק״ג', 'יבשים', S.dry),
      sugar: item('סוכר', 'food', 'ק״ג', 'יבשים', S.dry),
      eggs: item('ביצים', 'food', 'יח׳', 'חלב וביצים', S.dairy, 120),
      cream: item('שמנת מתוקה (צמחית)', 'food', 'ליטר', 'חלב וביצים', S.dairy),
      quinoa: item('קינואה', 'food', 'ק״ג', 'יבשים', S.dry),
      mushrooms: item('פטריות', 'food', 'ק״ג', 'ירקות', S.veg),
      // consumables
      plates: item('צלחות חד״פ מהודרות', 'consumable', 'יח׳', 'מתכלים', S.disp, 200),
      cups: item('כוסות מתכלות', 'consumable', 'יח׳', 'מתכלים', S.disp, 300),
      cutlery: item('סכו״ם חד״פ (סט)', 'consumable', 'יח׳', 'מתכלים', S.disp, 300),
      napkins: item('מפיות', 'consumable', 'חבילה', 'מתכלים', S.disp),
      foil: item('תבניות אלומיניום', 'consumable', 'יח׳', 'מתכלים', S.disp),
      platterBox: item('קופסאות מגש', 'consumable', 'יח׳', 'מתכלים', S.disp),
      // rentals
      rPlates: item('צלחות פורצלן (שכירות)', 'rental', 'יח׳', 'כלי הגשה', S.rent),
      rGlasses: item('כוסות יין (שכירות)', 'rental', 'יח׳', 'כלי הגשה', S.rent),
      rCutlery: item('סכו״ם נירוסטה (שכירות)', 'rental', 'יח׳', 'כלי הגשה', S.rent),
      rChafing: item('שייפינג דיש (שכירות)', 'rental', 'יח׳', 'כלי הגשה', S.rent),
    };

    // ------------------------------------------------------------ dishes & recipes (qty per yield)
    const dish = (name: string, category: string, perGuest: number, yieldP: number, recipe: [number, number][], opts: { allergens?: string; veg?: boolean; vegan?: boolean; lead?: number } = {}) => {
      const id = insert('dishes', { name, category, default_per_guest: perGuest, yield_portions: yieldP, allergens: opts.allergens ?? '', is_vegetarian: opts.veg ?? false, is_vegan: opts.vegan ?? false, prep_lead_days: opts.lead ?? 0 });
      for (const [itemId, qty] of recipe) insert('recipe_lines', { dish_id: id, item_id: itemId, qty });
      return id;
    };
    const D = {
      focaccia: dish('פוקאצ׳ה ביתית ומטבלים', 'קבלת פנים', 0.5, 20, [[I.flour, 2], [I.oil, 0.4], [I.herbs, 2], [I.tahini, 0.5]], { allergens: 'גלוטן, שומשום', veg: true, lead: 1 }),
      eggplant: dish('חציל קלוי בטחינה', 'ראשונות', 0.5, 10, [[I.eggplant, 3], [I.tahini, 0.4], [I.herbs, 1], [I.lemon, 0.2]], { allergens: 'שומשום', veg: true, vegan: true }),
      salmonTartare: dish('טרטר סלמון', 'ראשונות', 0.4, 10, [[I.salmon, 0.9], [I.lemon, 0.2], [I.cucumber, 0.3], [I.herbs, 1]], { allergens: 'דגים' }),
      greenSalad: dish('סלט ירוק עם עשבים', 'ראשונות', 0.6, 10, [[I.lettuce, 4], [I.tomato, 0.5], [I.cucumber, 0.6], [I.herbs, 1], [I.oil, 0.1]], { veg: true, vegan: true }),
      beefRibs: dish('אסאדו בבישול ארוך', 'עיקריות', 0.45, 10, [[I.beef, 4.5], [I.oil, 0.1], [I.herbs, 1]], { lead: 1 }),
      chickenSkewers: dish('שיפודי פרגיות', 'עיקריות', 0.6, 10, [[I.chicken, 2.2], [I.lemon, 0.2], [I.oil, 0.1]]),
      entrecote: dish('נתחי אנטריקוט על הגריל', 'עיקריות', 0.35, 10, [[I.entrecote, 2.5]]),
      seabass: dish('פילה דניס בעשבים', 'עיקריות', 0.3, 10, [[I.seabass, 1.8], [I.lemon, 0.3], [I.herbs, 1]], { allergens: 'דגים' }),
      mushroomRisotto: dish('ריזוטו פטריות', 'עיקריות', 0.15, 10, [[I.rice, 1], [I.mushrooms, 1.2], [I.cream, 0.5]], { allergens: 'חלב', veg: true }),
      quinoaBowl: dish('קערת קינואה טבעונית', 'עיקריות', 0, 10, [[I.quinoa, 0.8], [I.sweetPotato, 1.2], [I.herbs, 1]], { veg: true, vegan: true }),
      potatoes: dish('תפוחי אדמה צלויים', 'תוספות', 0.8, 10, [[I.potato, 2], [I.oil, 0.15], [I.herbs, 0.5]], { veg: true, vegan: true }),
      rice: dish('אורז לבן עם שקדים', 'תוספות', 0.6, 10, [[I.rice, 0.8], [I.oil, 0.05]], { allergens: 'אגוזים', veg: true, vegan: true }),
      sweetPotato: dish('בטטה צלויה', 'תוספות', 0.5, 10, [[I.sweetPotato, 1.8], [I.oil, 0.1]], { veg: true, vegan: true }),
      chocolateMousse: dish('מוס שוקולד', 'קינוחים', 1, 20, [[I.chocolate, 1.2], [I.cream, 2], [I.eggs, 12], [I.sugar, 0.3]], { allergens: 'ביצים', lead: 1 }),
      fruit: dish('מגש פירות העונה', 'קינוחים', 0.5, 20, [[I.lemon, 0.2]], { veg: true, vegan: true }),
      kidsSchnitzel: dish('שניצלונים לילדים', 'ילדים', 1, 10, [[I.chickenBreast, 1.5], [I.flour, 0.2], [I.eggs, 4]], { allergens: 'גלוטן, ביצים' }),
      sandwichPlatter: dish('מגש כריכונים', 'מגשים', 0.25, 1, [[I.flour, 0.4], [I.eggs, 4], [I.lettuce, 1], [I.platterBox, 1]], { allergens: 'גלוטן, ביצים', veg: true }),
      saladPlatter: dish('מגש סלטים', 'מגשים', 0.1, 1, [[I.lettuce, 3], [I.tomato, 0.5], [I.cucumber, 0.5], [I.platterBox, 1]], { veg: true, vegan: true }),
      dessertPlatter: dish('מגש מיני קינוחים', 'מגשים', 0.1, 1, [[I.chocolate, 0.3], [I.cream, 0.4], [I.platterBox, 1]], { allergens: 'חלב, ביצים' }),
    };

    // ------------------------------------------------------------ equipment templates
    const tpl = (venue: VenueCode, itemId: number, perGuest: number, fixed = 0, eventType = '*') => insert('equipment_templates', { venue, event_type: eventType, item_id: itemId, per_guest: perGuest, fixed_qty: fixed });
    tpl('winery', I.rPlates, 3); tpl('winery', I.rGlasses, 1.5); tpl('winery', I.rCutlery, 3); tpl('winery', I.rChafing, 0, 6);
    tpl('farm', I.plates, 3.2); tpl('farm', I.cups, 3); tpl('farm', I.cutlery, 1.1); tpl('farm', I.napkins, 0.05); tpl('farm', I.foil, 0, 40);
    tpl('offsite', I.plates, 2.2); tpl('offsite', I.cups, 2); tpl('offsite', I.cutlery, 1.1); tpl('offsite', I.foil, 0, 20);

    // ------------------------------------------------------------ opening stock
    const stock = (itemId: number, wh: number, qty: number, daysAgo = 20) =>
      insert('stock_movements', { item_id: itemId, warehouse_id: wh, qty, kind: 'count', user_id: U.ops, at: addHours(now, -24 * daysAgo), note: 'ספירת פתיחה' });
    stock(I.flour, whCentral, 60); stock(I.oil, whCentral, 30); stock(I.rice, whCentral, 40); stock(I.potato, whCentral, 80);
    stock(I.tahini, whCentral, 12); stock(I.sugar, whCentral, 20); stock(I.eggs, whCentral, 360); stock(I.chocolate, whCentral, 8);
    stock(I.herbs, whCentral, 40); stock(I.lemon, whCentral, 10); stock(I.chicken, whCentral, 40); stock(I.beef, whCentral, 20);
    stock(I.quinoa, whCentral, 6); stock(I.sweetPotato, whCentral, 15); stock(I.cream, whCentral, 12);
    // The spec example: 100 units, two events need 70 and 60.
    stock(I.cups, whFarm, 100); stock(I.plates, whFarm, 900); stock(I.cutlery, whFarm, 500); stock(I.napkins, whFarm, 30); stock(I.foil, whFarm, 120);


    // ------------------------------------------------------------ work template (editable in "תהליך עבודה")
    // offset = hours relative to the event start (negative = before). done_when ties the task to real data.
    const T_: [string, string, string, string, number, boolean, string | null, { venue?: VenueCode; service?: string; action?: string }?][] = [
      ['inquiry', 'שליחת תפריטים לדוגמה ומחירון', 'sales', '', -1080, false, null],
      ['menu_quote', 'הצעת מחיר ומעקב עד חתימה', 'sales', '', -720, true, 'contract_signed'],
      ['menu_quote', 'אישור תפריט סופי עם הלקוח', 'sales', '', -240, true, 'menu_approved'],
      ['opening', 'שיבוץ מנהל אירוע', 'ops', '', -504, true, 'manager_assigned'],
      ['opening', 'פתיחת תיק: מועד, מקום, היקף ואנשי קשר בשטח', 'event_manager', '', -336, true, null],
      ['purchasing', 'אישור כמויות ודרישת חומרי גלם', 'kitchen', '', -120, true, 'requirements_approved'],
      ['purchasing', 'הזמנת חומרי גלם ותיאום מועדי אספקה', 'purchasing', '', -72, true, 'stock_covered'],
      ['purchasing', 'אימות קבלת כל האספקות לאירוע', 'purchasing', '', -24, true, 'deliveries_received'],
      ['kitchen', 'תוכנית הכנות לפי ימים', 'kitchen', '', -72, true, 'prep_planned'],
      ['kitchen', 'אריזה, תיוג ובדיקת טמפרטורות ליציאה', 'kitchen', '', -3, true, null],
      ['equipment_staff', 'הפקת רשימת ציוד לאירוע', 'logistics', '', -120, true, 'equipment_listed'],
      ['equipment_staff', 'אישור כלי הגשה שכורים מול הספק', 'logistics', '', -96, true, 'rentals_confirmed', { venue: 'winery' }],
      ['equipment_staff', 'תיאום רכב הובלה ונהג', 'logistics', '', -48, true, null, { venue: 'farm' }],
      ['equipment_staff', 'תיאום רכב הובלה ונהג', 'logistics', '', -48, true, null, { venue: 'offsite' }],
      ['equipment_staff', 'שיבוץ צוות ומלצרים לפי התקן', 'crew', '', -72, true, 'staffing_full', { service: 'full' }],
      ['equipment_staff', 'אישור הגעה מול הצוות יום לפני', 'crew', '', -24, true, null, { service: 'full' }],
      ['readiness', 'ספירת העמסה לפני יציאה', 'logistics', '', -4, true, 'loaded', { venue: 'farm' }],
      ['readiness', 'בדיקת שטח, הקמה ועמדות שירות', 'event_manager', '', -2, true, null, { service: 'full' }],
      ['readiness', 'מסירה ללקוח בזמן ואישור קבלה', 'logistics', '', -1, true, null, { service: 'platters' }],
      ['closing', 'סגירת חשבונות ספקים לאירוע', 'accountant', '', 168, false, null],
      ['closing', 'סיכום ולקחים קצרים מהאירוע', 'event_manager', '', 48, false, null],
    ];
    T_.forEach(([stage, title, role, action, offset, required, doneWhen, opt], i) => insert('task_templates', {
      title, action, stage, role, venue: opt?.venue ?? null, event_type: '*', service_kind: opt?.service ?? '*', offset_hours: offset,
      required, done_when: doneWhen, sort: i, updated_at: now,
    }));

    // ------------------------------------------------------------ helpers
    const client = (name: string, phone: string, kind = 'private', company = '', source = '') =>
      insert('clients', { name, phone, phone_digits: phone.replace(/\D/g, ''), kind, company, source, owner_id: U.sales1, created_at: addHours(now, -24 * 60), updated_at: now });

    interface EvOpts {
      venue: VenueCode; type: EventType; date: string; guests: number; client: number; title?: string; start?: string; end?: string;
      sales?: string; signedDaysAgo?: number; total?: number; kids?: number; veg?: number; vegan?: number; service?: 'full' | 'platters';
      em?: number | null; rep?: number | null; brand?: number | null; source?: string; campaign?: string; createdDaysAgo?: number;
      address?: string; siteName?: string; sitePhone?: string; delivery?: string; intake?: string; missing?: string; lifecycle?: string; menuType?: string; kosher?: string; special?: string;
    }
    const event = (o: EvOpts) => {
      const isHall = o.venue === 'eden' || o.venue === 'farm';
      const created = addHours(now, -24 * (o.createdDaysAgo ?? 40));
      return insert('events', {
        client_id: o.client, venue: o.venue, title: o.title ?? 'אירוע', event_type: o.type, service_kind: o.service ?? 'full', date: o.date,
        start_time: o.start ?? '19:00', end_time: o.end ?? '23:30', delivery_time: o.delivery ?? '', guests: o.guests, kids: o.kids ?? 0,
        vegetarian: o.veg ?? 0, vegan: o.vegan ?? 0, menu_type: o.menuType ?? '', kosher: o.kosher ?? 'none', address: o.address ?? '',
        site_contact_name: o.siteName ?? '', site_contact_phone: o.sitePhone ?? '', special_requests: o.special ?? '',
        sales_status: isHall ? 'hall' : (o.sales ?? 'signed'), source: o.source ?? '', campaign: o.campaign ?? '',
        contract_signed_at: !isHall && (o.sales ?? 'signed') === 'signed' ? addDays(T, -(o.signedDaysAgo ?? 30)) : null,
        contract_total: o.total !== undefined ? ils(o.total) : null,
        intake_status: isHall ? (o.intake ?? 'verified') : null, hall_received_at: isHall ? created : null,
        hall_contact_name: isHall ? 'מנהלת אירועים באולם' : '', hall_contact_phone: isHall ? '08-9000000' : '', intake_missing: o.missing ?? '',
        payer: isHall ? 'האולם' : '',
        sales_rep_id: o.rep === undefined ? (isHall ? null : U.sales1) : o.rep,
        event_manager_id: o.em === undefined ? (o.venue === 'winery' || o.venue === 'offsite' ? U.em1 : U.em2) : o.em,
        kitchen_manager_id: U.chef,
        brand_manager_id: o.brand === undefined ? (o.venue === 'eden' ? U.brandEden : o.venue === 'farm' ? U.brandFarm : null) : o.brand,
        lifecycle: o.lifecycle ?? 'planning', created_by: isHall ? U.brandEden : U.sales1, created_at: created, updated_at: created,
      });
    };
    const menu = (eventId: number, lines: [number, number?, string?, string?][], approve = true, approvedBy = U.chef) => {
      lines.forEach(([dishId, perGuest, audience, notes], i) => {
        const d = get<{ default_per_guest: number }>('SELECT default_per_guest FROM dishes WHERE id = ?', dishId)!;
        insert('menu_lines', { event_id: eventId, dish_id: dishId, audience: audience ?? 'all', per_guest: perGuest ?? d.default_per_guest, notes: notes ?? '', sort: i });
      });
      if (approve) {
        const snap = menuSnapshot(loadEvent(eventId));
        insert('menu_versions', { event_id: eventId, version: 1, snapshot: JSON.stringify(snap), changes: JSON.stringify(diffMenus(null, snap)), reason: 'אושר בטעימות', approved_by: approvedBy, approved_at: addHours(now, -24 * 10) });
        run("UPDATE events SET menu_status = 'approved', menu_version = 1 WHERE id = ?", eventId);
      } else {
        run("UPDATE events SET menu_status = 'draft' WHERE id = ?", eventId);
      }
    };
    const pay = (eventId: number, kind: string, amount: number, due: string, received = 0, receivedAt: string | null = null, ref = '') =>
      insert('payments', { event_id: eventId, kind, amount: ils(amount), due_date: due, received: ils(received), received_at: receivedAt, reference: ref });
    const activity = (clientId: number, eventId: number | null, kind: string, content: string, daysAgo: number, by = U.sales1, next?: [string, string]) =>
      insert('activities', { client_id: clientId, event_id: eventId, user_id: by, kind, content, at: addHours(now, -24 * daysAgo), next_action: next?.[0] ?? '', next_action_at: next?.[1] ?? null });
    const standardMenu: [number, number?, string?, string?][] = [[D.focaccia], [D.eggplant], [D.greenSalad], [D.beefRibs], [D.chickenSkewers], [D.potatoes], [D.rice], [D.chocolateMousse]];

    // ============================================================ SCENARIO 1: producer with two events and different menus
    const producer = client('הפקות גפן – מפיק', '052-1111111', 'producer', 'הפקות גפן בע״מ', 'מפיק');
    insert('contacts', { client_id: producer, name: 'עדי גפן', role: 'מפיקה', phone: '052-1111111', email: 'adi@gefen.example' });
    insert('contacts', { client_id: producer, name: 'דנה – חברת הייטק (לקוח סופי)', role: 'מנהלת רווחה', phone: '054-1111112', is_end_client: 1 });
    const conf = event({ venue: 'winery', type: 'conference', title: 'כנס מכירות שנתי – הפקות גפן', date: addDays(T, 9), start: '09:00', end: '16:00', guests: 180, client: producer, total: 72000, source: 'מפיק', veg: 12, vegan: 4, menuType: 'ארוחת צהריים חלבית-בשרית' });
    menu(conf, [[D.focaccia], [D.greenSalad], [D.salmonTartare], [D.chickenSkewers], [D.mushroomRisotto, 1, 'veg'], [D.quinoaBowl, 1, 'vegan'], [D.rice], [D.fruit]]);
    insert('dietary', { event_id: conf, kind: 'allergy', count: 3, description: 'אלרגיה לאגוזים – מנה נפרדת ללא שקדים באורז' });
    insert('dietary', { event_id: conf, kind: 'vegetarian', count: 12, description: '' });
    insert('dietary', { event_id: conf, kind: 'vegan', count: 4, description: '' });
    pay(conf, 'deposit', 21600, addDays(T, -20), 21600, addDays(T, -18), 'העברה 88123');
    pay(conf, 'final', 50400, addDays(T, 23));
    const gala = event({ venue: 'winery', type: 'corporate', title: 'ערב גאלה – הפקות גפן', date: addDays(T, 26), start: '19:30', guests: 120, client: producer, total: 64000, source: 'מפיק', menuType: 'ארוחת ערב בשרית מוגשת' });
    menu(gala, [[D.focaccia], [D.eggplant], [D.entrecote], [D.seabass], [D.sweetPotato], [D.chocolateMousse]], false);
    pay(gala, 'deposit', 19200, addDays(T, 3));
    pay(gala, 'final', 44800, addDays(T, 40));
    activity(producer, conf, 'call', 'עדי אישרה 180 משתתפים, 12 צמחונים ו-4 טבעונים. ביקשה שהמנה ללא אגוזים תסומן', 6);
    activity(producer, gala, 'meeting', 'סיור ביקב עם עדי ודנה. התרשמו מאוד מהמרפסת, מבקשים הגשה מוגשת לשולחן', 12, U.sales2);
    insert('meetings', { kind: 'tasting', event_id: gala, client_id: producer, date: addDays(T, 4), time: '17:00', manager_id: U.chef, created_by: U.sales1, created_at: now });
    insert('meetings', { kind: 'tasting', event_id: conf, client_id: producer, date: addDays(T, -12), time: '16:00', manager_id: U.chef, status: 'done', notes: 'נסגר תפריט במקום', created_by: U.sales1, created_at: now });
    insert('equipment_templates', { venue: 'winery', event_type: 'conference', item_id: I.rChafing, per_guest: 0, fixed_qty: 4 });
    for (const [itemId, label, planned, confirmed] of [[I.rPlates, 'צלחות פורצלן (שכירות)', 540, 1], [I.rGlasses, 'כוסות יין (שכירות)', 270, 1], [I.rCutlery, 'סכו״ם נירוסטה (שכירות)', 540, 0]] as const) {
      insert('event_equipment', { event_id: conf, item_id: itemId, label, planned, supplier_id: S.rent, supplier_confirmed: confirmed });
    }
    for (const [role, req, asg] of [['waiter', 15, 12], ['cook', 3, 3], ['bartender', 2, 2], ['setup', 3, 3]] as const) insert('staffing', { event_id: conf, role, required: req, assigned: asg });

    // ============================================================ SCENARIO 2: Eden wedding just received from the hall
    const coupleEden = client('נוי ואלון', '050-2222222', 'private', '', 'אולם');
    const edenNew = event({ venue: 'eden', type: 'wedding', title: 'חתונת נוי ואלון', date: addDays(T, 34), start: '19:30', guests: 420, kids: 30, client: coupleEden, intake: 'received', createdDaysAgo: 0, em: null });
    const coupleEden2 = client('שקד ורון', '050-2222333', 'private', '', 'אולם');
    const edenMissing = event({ venue: 'eden', type: 'wedding', title: 'חתונת שקד ורון', date: addDays(T, 48), guests: 300, client: coupleEden2, intake: 'missing', missing: 'שעת קבלת פנים ומספר ילדים', createdDaysAgo: 3 });
    const coupleEden3 = client('מאיה ודור', '050-2222444', 'private', '', 'אולם');
    const edenSoon = event({ venue: 'eden', type: 'wedding', title: 'חתונת מאיה ודור', date: addDays(T, 2), guests: 350, kids: 25, veg: 20, client: coupleEden3 });
    menu(edenSoon, [...standardMenu, [D.kidsSchnitzel, 1, 'kids'], [D.mushroomRisotto, 1, 'veg']]);
    insert('dietary', { event_id: edenSoon, kind: 'allergy', count: 2, description: 'צליאק – ללא גלוטן' });
    for (const [role, req, asg] of [['waiter', 30, 30], ['cook', 6, 5], ['bartender', 4, 4], ['bar_manager', 1, 1]] as const) insert('staffing', { event_id: edenSoon, role, required: req, assigned: asg });
    // A late change after approval: guests and an extra vegan dish → kitchen + event manager must acknowledge.
    run('UPDATE events SET guests = 370 WHERE id = ?', edenSoon);
    insert('menu_lines', { event_id: edenSoon, dish_id: D.quinoaBowl, audience: 'vegan', per_guest: 1, notes: 'נוסף לאחר טעימות', sort: 20 });
    run('UPDATE events SET vegan = 6 WHERE id = ?', edenSoon);
    {
      const prev = JSON.parse(get<{ snapshot: string }>('SELECT snapshot FROM menu_versions WHERE event_id = ? AND version = 1', edenSoon)!.snapshot);
      const snap = menuSnapshot(loadEvent(edenSoon));
      const v2 = insert('menu_versions', { event_id: edenSoon, version: 2, snapshot: JSON.stringify(snap), changes: JSON.stringify(diffMenus(prev, snap)), reason: 'הזוג עדכן 20 אורחים נוספים ו-6 טבעונים', approved_by: U.em2, approved_at: addHours(now, -5) });
      insert('menu_acks', { menu_version_id: v2, role: 'kitchen', user_id: U.chef, acked_at: addHours(now, -3) });
      insert('menu_acks', { menu_version_id: v2, role: 'event_manager' });
      run("UPDATE events SET menu_status = 'changed', menu_version = 2 WHERE id = ?", edenSoon);
    }

    // ============================================================ SCENARIO 3: farm wedding yesterday with unloading gap
    const coupleFarm = client('הדס ויונתן', '050-3333333', 'private', '', 'אולם');
    const farmPast = event({ venue: 'farm', type: 'wedding', title: 'חתונת הדס ויונתן', date: addDays(T, -1), guests: 280, kids: 20, client: coupleFarm });
    menu(farmPast, standardMenu);
    insert('event_equipment', { event_id: farmPast, label: 'מזון: אסאדו בבישול ארוך', unit: 'ארגזים', is_food: 1, planned: 20, loaded: 20, unloaded: 18, gap_owner_id: U.ops, gap_note: '' });
    insert('event_equipment', { event_id: farmPast, label: 'מזון: תפוחי אדמה צלויים', unit: 'ארגזים', is_food: 1, planned: 12, loaded: 12, unloaded: 12 });
    insert('event_equipment', { event_id: farmPast, item_id: I.plates, label: 'צלחות חד״פ מהודרות', planned: 900, loaded: 900, unloaded: 900 });
    insert('event_equipment', { event_id: farmPast, item_id: I.cups, label: 'כוסות מתכלות', planned: 840, loaded: 840, unloaded: 840 });
    insert('confirmations', { event_id: farmPast, kind: 'loaded', user_id: U.ops, note: 'ללא פערים', at: addHours(now, -30) });
    insert('confirmations', { event_id: farmPast, kind: 'unloaded', user_id: U.ops, note: 'פערים: מזון: אסאדו בבישול ארוך: 18 מתוך 20 ארגזים', at: addHours(now, -20) });
    insert('confirmations', { event_id: farmPast, kind: 'executed', user_id: U.em2, note: '', at: addHours(now, -21) });
    const gapReport = insert('field_reports', { event_id: farmPast, kind: 'shortage', target: 'ops', content: 'פער בפריקה: מזון: אסאדו בבישול ארוך: 18 מתוך 20 ארגזים', reported_by: U.ops, at: addHours(now, -20) });
    run("UPDATE events SET lifecycle = 'completed' WHERE id = ?", farmPast);

    // ============================================================ SCENARIO 4: two farm events competing for cups (100 vs 70 + 60)
    const coupleFarm2 = client('ענבר ואיתי', '050-3333444', 'private', '', 'אולם');
    const farmA = event({ venue: 'farm', type: 'wedding', title: 'חתונת ענבר ואיתי', date: addDays(T, 5), guests: 250, client: coupleFarm2 });
    menu(farmA, standardMenu);
    const coupleFarm3 = client('רותם ועומר', '050-3333555', 'private', '', 'אולם');
    const farmB = event({ venue: 'farm', type: 'wedding', title: 'חתונת רותם ועומר', date: addDays(T, 6), guests: 220, client: coupleFarm3 });
    menu(farmB, standardMenu, false);
    const req = (eventId: number, itemId: number, qty: number, wh: number) => insert('requirements', { event_id: eventId, item_id: itemId, qty, source: 'manual', warehouse_id: wh, approved_by: U.chef, approved_at: addHours(now, -48) });
    req(farmA, I.cups, 70, whFarm); req(farmB, I.cups, 60, whFarm);
    req(farmA, I.plates, 800, whFarm); req(farmB, I.plates, 700, whFarm);
    req(farmA, I.beef, 12, whCentral); req(farmA, I.chicken, 16, whCentral); req(farmA, I.potato, 40, whCentral);
    req(conf, I.salmon, 7, whCentral); req(conf, I.chicken, 26, whCentral);

    // ============================================================ SCENARIO 5: partial delivery
    const po = insert('purchase_orders', { supplier_id: S.meat, venue: null, warehouse_id: whCentral, responsible_id: U.buyer, status: 'partial', expected_date: addDays(T, -1), expected_time: '07:00', notes: 'לאירועי סוף השבוע', created_by: U.buyer, created_at: addHours(now, -72) });
    const l1 = insert('po_lines', { po_id: po, item_id: I.chicken, event_id: farmA, qty: 30, received: 18, gap_note: 'הספק העביר 18 ק״ג, היתר מחר' });
    insert('po_lines', { po_id: po, item_id: I.beef, event_id: farmA, qty: 10, received: 10 });
    insert('receipts', { po_line_id: l1, qty: 18, received_by: U.buyer, at: addHours(now, -26), note: 'הספק העביר 18 ק״ג, היתר מחר' });
    insert('stock_movements', { item_id: I.chicken, warehouse_id: whCentral, qty: 18, kind: 'receipt', event_id: farmA, po_line_id: l1, user_id: U.buyer, at: addHours(now, -26), note: `הזמנה #${po}` });
    insert('stock_movements', { item_id: I.beef, warehouse_id: whCentral, qty: 10, kind: 'receipt', event_id: farmA, user_id: U.buyer, at: addHours(now, -26), note: `הזמנה #${po}` });
    const po2 = insert('purchase_orders', { supplier_id: S.fish, venue: null, warehouse_id: whCentral, responsible_id: U.chef, status: 'ordered', expected_date: addDays(T, 7), expected_time: '08:00', notes: 'סלמון לכנס – הזמנה ע״י השף', created_by: U.chef, created_at: now });
    insert('po_lines', { po_id: po2, item_id: I.salmon, event_id: conf, qty: 7 });

    // ============================================================ SCENARIO 6: leads, follow-up calls, conversion by source
    const leadClients: [string, string, string, string, VenueCode, EventType, number, string][] = [
      ['מיכל לוי', '054-4444001', 'אינסטגרם', 'בר מצווה סתיו', 'winery', 'birthday', 80, 'lead'],
      ['חברת אלפא סיסטמס', '03-4444002', 'גוגל', 'כנסים 2026', 'winery', 'conference', 250, 'quoted'],
      ['עמותת לב', '02-4444003', 'המלצה', '', 'offsite', 'catering', 150, 'tour'],
      ['יובל כהן', '052-4444004', 'פייסבוק', 'ימי הולדת', 'winery', 'birthday', 60, 'lost'],
      ['סטארט-אפ בטא', '03-4444005', 'אתר', '', 'offsite', 'platters', 40, 'lead'],
      ['משפחת אברהם', '050-4444006', 'לקוח חוזר', '', 'winery', 'private', 100, 'quoted'],
    ];
    for (const [name, phone, source, campaign, venue, type, guests, status] of leadClients) {
      const cid = client(name, phone, type === 'conference' || type === 'platters' ? 'company' : 'private', '', source);
      const eid = event({ venue, type, title: `${type === 'conference' ? 'כנס' : type === 'platters' ? 'מגשי אירוח' : type === 'catering' ? 'קייטרינג' : 'אירוע'} – ${name}`, date: addDays(T, 20 + Math.floor(rand() * 60)), guests, client: cid, sales: status, source, campaign, total: undefined, createdDaysAgo: Math.floor(rand() * 20) + 1, em: null });
      activity(cid, eid, 'call', `פנייה ראשונית: ${guests} אורחים, מבקשים הצעה`, Math.floor(rand() * 10) + 1);
      if (status === 'quoted') insert('quotes', { event_id: eid, version: 1, per_guest: ils(240), total: ils(240 * guests), guests, description: 'תפריט בסיס', status: 'sent', created_by: U.sales1, created_at: addHours(now, -24 * 5) });
      if (status === 'tour') insert('meetings', { kind: 'tour', event_id: eid, client_id: cid, date: addDays(T, 1), time: '11:00', manager_id: U.em1, created_by: U.sales2, created_at: now });
      if (status === 'lost') run("UPDATE events SET lost_reason = 'בחרו מקום אחר בגלל מחיר' WHERE id = ?", eid);
    }
    // Scheduled follow-up call due today.
    const followClient = get<{ id: number }>("SELECT id FROM clients WHERE phone = '03-4444002'")!.id;
    const followEvent = get<{ id: number }>('SELECT id FROM events WHERE client_id = ?', followClient)!.id;
    const fa = activity(followClient, followEvent, 'email', 'נשלחה הצעת מחיר ל-250 משתתפים', 5, U.sales1, ['לחזור לגבי אישור ההצעה ותיאום סיור', `${T}T10:00`]);

    // ============================================================ SCENARIO 7: offsite with on-site crew + platters delivery
    const offClient = client('עיריית מודיעין', '08-5555001', 'company', 'עיריית מודיעין', 'טלפון');
    const off = event({ venue: 'offsite', type: 'catering', title: 'אירוע הוקרה – עיריית מודיעין', date: addDays(T, 12), start: '18:00', guests: 200, client: offClient, total: 58000,
      address: 'היכל התרבות, מודיעין', siteName: 'אבי – אב בית', sitePhone: '050-5555002', source: 'טלפון', special: 'אין חיבור לגז – לתאם גנרטור וכיריים חשמליות' });
    menu(off, [[D.focaccia], [D.greenSalad], [D.chickenSkewers], [D.potatoes], [D.fruit]]);
    pay(off, 'deposit', 17400, addDays(T, -10), 17400, addDays(T, -9), 'שיק 5521');
    pay(off, 'final', 40600, addDays(T, 30));
    const platClient = client('משרד עו״ד כהן-לוי', '03-5555100', 'company', 'כהן-לוי', 'לקוח חוזר');
    const plat = event({ venue: 'offsite', type: 'platters', service: 'platters', title: 'מגשי אירוח – כהן-לוי', date: addDays(T, 1), start: '', end: '', delivery: '12:00', guests: 45, client: platClient, total: 3800,
      address: 'מגדל עזריאלי, קומה 30, תל אביב', siteName: 'מזכירות', sitePhone: '03-5555101', source: 'לקוח חוזר' });
    menu(plat, [[D.sandwichPlatter, 0.25], [D.saladPlatter, 0.1], [D.dessertPlatter, 0.1]]);
    pay(plat, 'final', 3800, addDays(T, 15));

    // ============================================================ volume: a year-like spread around today
    const names = ['שחר', 'אור', 'גל', 'עדי', 'רז', 'יעל', 'ליה', 'תמר', 'עידו', 'אלה', 'בר', 'נטע', 'דניאל', 'אגם', 'הילה', 'זיו'];
    for (let i = 0; i < 46; i++) {
      const venue = pick(['winery', 'eden', 'farm', 'offsite', 'eden', 'farm'] as VenueCode[]);
      const offset = Math.floor(rand() * 150) - 70;
      if (offset >= -1 && offset <= 2) continue;
      const date = addDays(T, offset);
      const isHall = venue === 'eden' || venue === 'farm';
      const type: EventType = isHall ? 'wedding' : pick(['conference', 'corporate', 'birthday', 'catering'] as EventType[]);
      const guests = isHall ? 180 + Math.floor(rand() * 300) : 40 + Math.floor(rand() * 200);
      const a = pick(names), b = pick(names);
      const cid = client(isHall ? `${a} ו${b}` : `לקוח ${a} ${i}`, `05${Math.floor(rand() * 9)}-${String(6000000 + i * 137).slice(0, 7)}`, isHall ? 'private' : pick(['private', 'company']), '', isHall ? 'אולם' : pick(['אתר', 'גוגל', 'המלצה', 'אינסטגרם', 'לקוח חוזר']));
      const past = offset < 0;
      const total = isHall ? Math.round(guests * 210) : Math.round(guests * 260);
      const eid = event({ venue, type, date, guests, client: cid, title: isHall ? `חתונת ${a} ו${b}` : `${type === 'conference' ? 'כנס' : type === 'birthday' ? 'יום הולדת' : type === 'catering' ? 'קייטרינג' : 'אירוע חברה'} – ${a}`,
        total, lifecycle: past ? (offset < -20 ? 'closed' : 'completed') : 'planning', createdDaysAgo: Math.max(10, -offset + 60), source: isHall ? 'אולם' : pick(['אתר', 'גוגל', 'המלצה', 'אינסטגרם', 'לקוח חוזר']) });
      menu(eid, standardMenu, past || offset < 20);
      if (!isHall && (past || offset < 20)) {
        insert('meetings', { kind: 'tasting', event_id: eid, client_id: cid, date: addDays(date, -21), time: '17:00', manager_id: U.chef, status: 'done', notes: 'התפריט נסגר בטעימות', created_by: U.sales1, created_at: now });
      }
      if (!isHall || rand() > 0.3) {
        const dep = Math.round(total * 0.3);
        const depDue = addDays(date, -45);
        const depPaid = depDue < T && rand() > 0.15;
        pay(eid, 'deposit', dep, depDue, depPaid ? dep : 0, depPaid ? addDays(depDue, 1) : null, depPaid ? 'העברה' : '');
        const fully = offset < -20 || (past && rand() > 0.4);
        pay(eid, 'final', total - dep, addDays(date, 14), fully ? total - dep : 0, fully ? addDays(date, 10) : null, fully ? 'העברה' : '');
      }
      if (past) {
        insert('confirmations', { event_id: eid, kind: 'executed', user_id: venue === 'winery' || venue === 'offsite' ? U.em1 : U.em2, note: '', at: addHours(now, offset * 24) });
        if (offset < -20) run('UPDATE events SET closed_at = ? WHERE id = ?', addHours(now, (offset + 15) * 24), eid);
      }
    }

    // ------------------------------------------------------------ prices (agorot per unit), owned equipment, vehicles, payables
    const price: [number, number][] = [
      [I.beef, 9800], [I.entrecote, 16500], [I.chicken, 4200], [I.chickenBreast, 3900], [I.salmon, 11000], [I.seabass, 9500],
      [I.potato, 450], [I.sweetPotato, 700], [I.lettuce, 600], [I.tomato, 1400], [I.cucumber, 550], [I.eggplant, 650], [I.herbs, 500], [I.lemon, 900],
      [I.rice, 1100], [I.flour, 400], [I.oil, 3800], [I.tahini, 2600], [I.chocolate, 6500], [I.sugar, 450], [I.eggs, 60], [I.cream, 1700], [I.quinoa, 2400], [I.mushrooms, 2200],
      [I.plates, 90], [I.cups, 40], [I.cutlery, 120], [I.napkins, 1500], [I.foil, 250], [I.platterBox, 350],
      [I.rPlates, 350], [I.rGlasses, 400], [I.rCutlery, 300], [I.rChafing, 4500],
    ];
    for (const [id, cost] of price) run('UPDATE items SET unit_cost = ? WHERE id = ?', cost, id);
    run('UPDATE event_equipment SET unit_cost = (SELECT unit_cost FROM items WHERE items.id = event_equipment.item_id) WHERE item_id IN (SELECT id FROM items WHERE kind = \'rental\')');
    run('UPDATE po_lines SET unit_price = (SELECT unit_cost FROM items WHERE items.id = po_lines.item_id)');
    // Owned serving equipment shared by events on the same day.
    insert('items', { name: 'מחממי מזון (בבעלות)', kind: 'equipment', unit: 'יח׳', category: 'ציוד', owned_qty: 12, unit_cost: 0 });
    insert('items', { name: 'שולחנות הגשה מתקפלים', kind: 'equipment', unit: 'יח׳', category: 'ציוד', owned_qty: 20, unit_cost: 0 });
    const truckA = insert('vehicles', { name: 'משאית קירור', plate: '12-345-67', notes: '7.5 טון' });
    insert('vehicles', { name: 'טנדר', plate: '98-765-43', notes: '' });
    insert('event_transport', { event_id: farmA, vehicle_id: truckA, driver: 'יוסי', depart_time: '13:00', return_time: '01:00', notes: 'יציאה מהמטבח המרכזי' });
    insert('supplier_invoices', { supplier_id: S.meat, po_id: po, number: '40871', date: addDays(T, -1), due_date: addDays(T, 29), amount: 18 * 4200 + 10 * 9800, notes: 'שוטף + 30', created_by: U.buyer, created_at: now });
    insert('supplier_invoices', { supplier_id: S.disp, po_id: null, number: '1203', date: addDays(T, -40), due_date: addDays(T, -10), amount: 245000, notes: '', created_by: U.buyer, created_at: now });
    insert('supplier_invoices', { supplier_id: S.veg, po_id: null, number: '7781', date: addDays(T, -20), due_date: addDays(T, 10), amount: 132050, paid: 50000, status: 'partial', paid_at: addDays(T, -5), notes: '', created_by: U.buyer, created_at: now });

    // Old completed tasks for closed events should not show as open: mark closed events' post-event work as done later via reconcile.
    void fa; void gapReport; void edenNew; void edenMissing; void gala;
  });

  // Run the task engine over the seeded state (creates the automatic tasks with routing).
  for (const e of all<{ id: number }>("SELECT id FROM events WHERE lifecycle != 'closed'")) reconcileEvent(e.id);
  sweep();
  // Process tasks whose time passed long before the demo started were handled back then.
  run("UPDATE tasks SET status = 'done', completed_at = due_at, evidence = 'בוצע (היסטוריה)' WHERE type = 'template' AND status = 'open' AND due_at < ?", addHours(nowISO(), -24));
  // Closed historical events: their tasks were done in the past.
  run("UPDATE tasks SET status = 'done', completed_at = created_at, evidence = 'הושלם (היסטוריה)' WHERE event_id IN (SELECT id FROM events WHERE lifecycle = 'closed') AND status IN ('open','in_progress','blocked')");
  // The farm unloading-gap report task.
  const gap = get<{ id: number; event_id: number }>("SELECT id, event_id FROM field_reports WHERE content LIKE 'פער בפריקה%' LIMIT 1");
  if (gap) {
    insert('tasks', { dedupe_key: `report_handle:${gap.id}`, type: 'report_handle', title: 'פער בפריקה', action: 'לטפל בפער בפריקה: אסאדו 18 מתוך 20 ארגזים', role: 'ops', venue: 'farm', event_id: gap.event_id, ref_type: 'report', ref_id: gap.id, status: 'open', due_at: addHours(nowISO(), -2), created_at: addHours(nowISO(), -20) });
  }
  // Scheduled follow-up call (activity with next action).
  const act = get<{ id: number; client_id: number; event_id: number; next_action: string; next_action_at: string; user_id: number }>("SELECT * FROM activities WHERE next_action_at IS NOT NULL LIMIT 1");
  if (act) {
    insert('tasks', { dedupe_key: `scheduled_call:${act.id}`, type: 'scheduled_call', title: 'שיחה מתוזמנת ללקוח', action: act.next_action, role: 'sales', client_id: act.client_id, event_id: act.event_id, ref_type: 'activity', ref_id: act.id, assignee_id: act.user_id, status: 'open', due_at: new Date(act.next_action_at).toISOString(), created_at: addHours(nowISO(), -24 * 5) });
  }
  // A blocker the event manager has to resolve (demo).
  const farmAId = get<{ id: number }>("SELECT id FROM events WHERE title = 'חתונת ענבר ואיתי'")?.id;
  const truck = farmAId && get<{ id: number }>("SELECT id FROM tasks WHERE event_id = ? AND title = 'תיאום רכב הובלה ונהג'", farmAId);
  const logisticsId = get<{ id: number }>("SELECT id FROM users WHERE email = 'logistics@demo.local'")?.id;
  if (truck && logisticsId) {
    run("UPDATE tasks SET status = 'blocked', assignee_id = ?, blocked_reason = 'רכב הקירור במוסך עד יום ד׳ – צריך החלטה: שכירות רכב חלופי או פיצול הובלה', blocked_at = ?, blocked_by = ? WHERE id = ?", logisticsId, nowISO(), logisticsId, truck.id);
    insert('task_log', { task_id: truck.id, user_id: logisticsId, action: 'blocked', note: 'רכב הקירור במוסך עד יום ד׳', at: nowISO() });
  }
  console.log(`Demo data ready. Sign in with any *@demo.local user, password: ${DEMO_PASSWORD}`);
}
