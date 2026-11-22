/** Auth, users & roles, business settings, backup, and the realtime stream. */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { resolve } from 'node:path';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { createBackup, listBackups, pruneBackups } from '../../core/backup.ts';
import { zAgorot, zTime, body, camelAll, HttpError, intParam, invalid, requireAny, requireGlobal, zPhone, zText, zVenueCode, type AppEnv } from '../../core/http.ts';
import { createSession, destroySession, hashPassword, verifyPassword } from '../../core/auth.ts';
import { audit } from '../../core/audit.ts';
import { getSettings, saveSettings } from '../../core/settings.ts';
import { loadVenues, reloadConfig } from '../../core/config.ts';
import { publish, subscribe } from '../../core/realtime.ts';
import { CORE_STAGES } from '../../../shared/domain.ts';
import { ROLES, can, canGlobal, type Role, venueScope } from '../../../shared/permissions.ts';
import { seesMargins } from '../../../shared/costing.ts';
import { VENUE_CODES } from '../../../shared/domain.ts';
import { nowISO } from '../../../shared/dates.ts';
import { mergeSettings, type BusinessSettings } from '../../../shared/settings.ts';
import type { Me } from '../../../shared/types.ts';
import type { SystemConfig } from '../../../shared/config.ts';

export const DEMO_MODE = process.env.DEMO_MODE !== '0';

// ---------------------------------------------------------------- auth

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', async (c) => {
  const b = await body(c, z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1, 'נדרשת סיסמה') }));
  const u = get<{ id: number; password_hash: string; active: number }>('SELECT id, password_hash, active FROM users WHERE email = ?', b.email);
  if (!u || !u.active || !verifyPassword(b.password, u.password_hash)) throw new HttpError(401, 'פרטי ההתחברות שגויים', 'bad_credentials');
  createSession(c, u.id);
  return c.json({ ok: true });
});

authRoutes.post('/logout', (c) => {
  destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', (c) => {
  const u = c.get('user');
  const me: Me = { id: u.id, name: u.name, email: u.email, grants: u.grants };
  return c.json(me);
});

/** Demo environment only: list of role accounts for one-click sign-in during training. */
authRoutes.get('/demo-users', (c) => {
  if (!DEMO_MODE) return c.json([]);
  return c.json(all<{ email: string; name: string; roles: string }>(
    `SELECT u.email, u.name, GROUP_CONCAT(r.role || ':' || COALESCE(r.venue, '*')) AS roles FROM users u
       JOIN user_roles r ON r.user_id = u.id WHERE u.active = 1 GROUP BY u.id ORDER BY u.id`,
  ));
});

// ---------------------------------------------------------------- users

export const usersRoutes = new Hono<AppEnv>();

/** Lightweight directory for pickers (any signed-in user). */
usersRoutes.get('/directory', (c) => {
  const rows = all<{ id: number; name: string; roles: string | null }>(
    `SELECT u.id, u.name, GROUP_CONCAT(r.role || ':' || COALESCE(r.venue, '*')) AS roles FROM users u
       LEFT JOIN user_roles r ON r.user_id = u.id WHERE u.active = 1 GROUP BY u.id ORDER BY u.name`,
  );
  return c.json(rows.map((r) => ({
    id: r.id, name: r.name,
    grants: (r.roles ?? '').split(',').filter(Boolean).map((s) => { const [role, venue] = s.split(':'); return { role, venue: venue === '*' ? null : venue }; }),
  })));
});

usersRoutes.get('/', (c) => {
  requireGlobal(c, 'admin', 1);
  const users = camelAll(all('SELECT id, name, email, phone, active, created_at FROM users ORDER BY active DESC, name'));
  const grants = all<{ user_id: number; role: Role; venue: string | null }>('SELECT user_id, role, venue FROM user_roles');
  return c.json(users.map((u) => ({ ...u, grants: grants.filter((g) => g.user_id === (u as { id: number }).id).map((g) => ({ role: g.role, venue: g.venue })) })));
});

const userSchema = z.object({
  name: zText(120).min(2, 'נדרש שם'),
  email: z.email('מייל לא תקין').transform((s) => s.toLowerCase()),
  phone: zPhone.default(''),
  active: z.boolean().default(true),
  password: z.string().min(8, 'לפחות 8 תווים').optional(),
  grants: z.array(z.object({ role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]), venue: zVenueCode.nullable() })).min(1, 'נדרש לפחות תפקיד אחד'),
});

usersRoutes.post('/', async (c) => {
  const admin = requireGlobal(c, 'admin', 3);
  const b = await body(c, userSchema);
  if (!b.password) throw invalid('נדרשת סיסמה ראשונית', { fields: { password: 'נדרשת סיסמה' } });
  if (get('SELECT 1 FROM users WHERE email = ?', b.email)) throw invalid('המייל כבר רשום', { fields: { email: 'כבר קיים' } });
  const id = tx(() => {
    const id = insert('users', { name: b.name, email: b.email, phone: b.phone, active: b.active, password_hash: hashPassword(b.password!), created_at: nowISO() });
    for (const g of b.grants) insert('user_roles', { user_id: id, role: g.role, venue: g.venue });
    audit({ entity: 'user', entityId: id, userId: admin.id, action: 'created', summary: `${b.name}: ${b.grants.map((g) => ROLES[g.role]).join(', ')}` });
    return id;
  });
  return c.json({ id }, 201);
});

usersRoutes.put('/:id', async (c) => {
  const admin = requireGlobal(c, 'admin', 3);
  const id = intParam(c);
  const b = await body(c, userSchema);
  if (get('SELECT 1 FROM users WHERE email = ? AND id != ?', b.email, id)) throw invalid('המייל כבר רשום', { fields: { email: 'כבר קיים' } });
  tx(() => {
    run('UPDATE users SET name = ?, email = ?, phone = ?, active = ? WHERE id = ?', b.name, b.email, b.phone, b.active, id);
    if (b.password) { run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), id); run('DELETE FROM sessions WHERE user_id = ?', id); }
    if (!b.active) run('DELETE FROM sessions WHERE user_id = ?', id);
    run('DELETE FROM user_roles WHERE user_id = ?', id);
    for (const g of b.grants) insert('user_roles', { user_id: id, role: g.role, venue: g.venue });
    audit({ entity: 'user', entityId: id, userId: admin.id, action: 'updated', summary: `${b.name}: ${b.grants.map((g) => ROLES[g.role]).join(', ')}${b.active ? '' : ' (מושבת)'}` });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- settings, backup, audit

export const adminRoutes = new Hono<AppEnv>();

/**
 * Settings: the screens of every role need some defaults (task horizon, pick lists, business name for printouts…).
 * Costs, target margins and pricing defaults are only for those who manage them.
 */
adminRoutes.get('/settings', (c) => {
  const user = c.get('user');
  const s = getSettings();
  if (canGlobal(user, 'admin', 1)) return c.json(s);
  return c.json({
    ...s,
    staffShiftCost: seesMargins(user) ? s.staffShiftCost : {},
    foodCostTargetPct: seesMargins(user) ? s.foodCostTargetPct : 0,
    formDefaults: { ...s.formDefaults, quotePerGuest: can(user, 'sales', 1) ? s.formDefaults.quotePerGuest : {} },
    business: can(user, 'sales', 1) || can(user, 'purchasing', 1) || seesMargins(user) ? s.business : { ...s.business, taxId: '', legalName: '', quoteTerms: '', poNote: '' },
    system: { ...s.system, permissions: {} },
  });
});

adminRoutes.put('/settings', async (c) => {
  const user = requireGlobal(c, 'admin', 3);
  const ratio = z.record(z.string(), z.number().min(0).max(10000));
  const b = await body(c, z.object({
    taskDueHours: z.record(z.string(), z.number().min(0).max(24 * 60)),
    autoTasks: z.record(z.string(), z.object({ enabled: z.boolean(), role: z.enum(Object.keys(ROLES) as [Role, ...Role[]]).nullable().optional() })).default({}),
    unclaimedEscalationHours: z.number().min(1).max(240),
    escalationWindowHours: z.number().min(0).max(24 * 60),
    unclaimedWindowDays: z.number().int().min(0).max(365),
    taskHorizonDays: z.number().int().min(0).max(365),
    guestLockDays: z.number().int().min(0).max(90),
    menuLockDays: z.number().int().min(0).max(90),
    readinessDays: z.number().int().min(0).max(30),
    checkpointMinutes: z.number().int().min(0).max(24 * 60),
    deliveryReminderDays: z.number().int().min(0).max(14),
    depositPct: z.number().min(0).max(100),
    depositDueDays: z.number().int().min(0).max(120),
    finalDueDays: z.number().int().min(0).max(365),
    kitchen: z.object({ bufferPct: z.number().min(0).max(100), typeFactor: z.record(z.string(), z.number().min(0).max(5)) }),
    staffingRatios: z.object({ formal: ratio, reception: ratio, platters: ratio }),
    readinessItems: z.record(z.string(), z.boolean()).default({}),
    foodTrayPortions: z.number().int().min(1).max(500),
    staffShiftCost: z.record(z.string(), zAgorot).default({}),
    foodCostTargetPct: z.number().min(0).max(100).default(30),
    runOfShow: z.array(z.object({
      offsetMin: z.number().int().min(-24 * 60).max(24 * 60),
      title: zText(160).min(2, 'נדרש תיאור לכל שורה בלו״ז'),
      role: z.string().refine((v) => v === '' || v in ROLES, 'תפקיד לא מוכר'),
    })).max(60).optional(),
    backupKeep: z.number().int().min(3, 'לפחות 3 גיבויים').max(365).optional(),
    formDefaults: z.object({
      poLeadDays: z.number().int().min(0).max(60), poTime: zTime, payableTermsDays: z.number().int().min(0).max(365),
      meetingLeadDays: z.number().int().min(0).max(90), tourTime: zTime, tastingTime: zTime,
      quotePerGuest: z.record(z.string(), zAgorot).default({}),
    }).optional(),
    business: z.object({
      name: zText(80).min(1, 'נדרש שם העסק'), legalName: zText(120).default(''), taxId: zText(20).default(''), phone: zText(30).default(''),
      email: zText(120).default(''), address: zText(200).default(''), quoteTerms: zText(3000).default(''), poNote: zText(1000).default(''),
    }).optional(),
    lists: z.object({
      leadSources: z.array(zText(60).min(1)).min(1, 'נדרש לפחות ערך אחד').max(50),
      dishCategories: z.array(zText(60).min(1)).min(1, 'נדרש לפחות ערך אחד').max(50),
      units: z.array(zText(20).min(1)).min(1, 'נדרש לפחות ערך אחד').max(50),
    }),
  }));
  saveSettings(mergeSettings({ ...(b as Partial<BusinessSettings>), system: getSettings().system }), user.id);
  audit({ entity: 'settings', entityId: 0, userId: user.id, action: 'updated', summary: 'עדכון הגדרות עסקיות' });
  return c.json(getSettings());
});

adminRoutes.get('/venues', (c) => { requireGlobal(c, 'admin', 1); return c.json(camelAll(all('SELECT * FROM venues ORDER BY sort'))); });

adminRoutes.post('/backup', async (c) => {
  const user = requireGlobal(c, 'admin', 3);
  const b = await createBackup('manual');
  pruneBackups(getSettings().backupKeep);
  audit({ entity: 'backup', entityId: 0, userId: user.id, action: 'backup', summary: `${b.name} · ${b.verified ? 'אומת' : `נכשל באימות: ${b.problem}`}` });
  if (!b.verified) throw invalid(`הגיבוי נשמר אבל לא עבר אימות: ${b.problem}`);
  return c.json(b);
});

adminRoutes.get('/backups', (c) => {
  requireGlobal(c, 'admin', 1);
  return c.json(listBackups());
});

adminRoutes.get('/audit', (c) => {
  requireGlobal(c, 'admin', 1);
  const rows = all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC, a.id DESC LIMIT 300`);
  return c.json(camelAll(rows).map((r) => ({ ...r, diff: JSON.parse(String((r as { diff: string }).diff || '{}')) })));
});

// ---------------------------------------------------------------- realtime

export const streamRoutes = new Hono<AppEnv>();

streamRoutes.get('/', (c) => {
  const user = c.get('user');
  const scope = venueScope(user);
  return streamSSE(c, async (stream) => {
    let alive = true;
    const unsubscribe = subscribe((h) => {
      // Hints carry ids only; data is fetched through permission-checked endpoints.
      void stream.writeSSE({ event: 'change', data: JSON.stringify(h) });
    });
    stream.onAbort(() => { alive = false; unsubscribe(); });
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ user: user.id, venues: scope }) });
    while (alive) {
      await stream.sleep(25_000);
      if (alive) await stream.writeSSE({ event: 'ping', data: '' });
    }
  });
});

// ---------------------------------------------------------------- system configuration (vocabulary & structure)

/** Everything the UI needs to speak the business's language. Any signed-in user. */
adminRoutes.get('/config', (c) => c.json({ system: getSettings().system, venues: loadVenues(), version: getSettings().system ? JSON.stringify(getSettings().system).length : 0 }));

const levelZ = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const keyZ = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'מזהה באנגלית קטנה, מספרים וקו תחתון');
const systemSchema = z.object({
  labels: z.record(z.string(), z.record(z.string(), zText(200))).default({}),
  eventTypes: z.array(z.object({
    key: keyZ, label: zText(60).min(1, 'נדרש שם'), venues: z.array(zVenueCode),
    style: z.enum(['formal', 'reception', 'platters']), active: z.boolean(),
  })).default([]),
  workStages: z.array(z.object({ key: keyZ, label: zText(60).min(1, 'נדרש שם'), desc: zText(300) })).default([]),
  permissions: z.record(z.string().refine((r) => r in ROLES, 'תפקיד לא מוכר'), z.record(z.string(), levelZ)).default({}),
  readinessOwners: z.record(z.string(), z.enum(Object.keys(ROLES) as [Role, ...Role[]])).default({}),
  allergens: z.array(zText(40).min(1)).max(60).default([]),
  navByRole: z.record(z.string(), z.array(z.string().max(30)).max(40)).default({}),
  homeByRole: z.record(z.string(), z.array(z.string().max(30)).max(40)).default({}),
  contactRoles: z.array(z.string().refine((r) => r in ROLES, 'תפקיד לא מוכר')).default([]),
});

adminRoutes.put('/system', async (c) => {
  const user = requireGlobal(c, 'admin', 3);
  const b = await body(c, systemSchema);
  const keys = (l: { key: string }[]) => new Set(l.map((x) => x.key)).size === l.length;
  if (!keys(b.eventTypes)) throw invalid('יש סוג אירוע שמופיע פעמיים');
  if (!keys(b.workStages)) throw invalid('יש שלב שמופיע פעמיים');
  // Event types still used by events cannot disappear (deactivate instead).
  if (b.eventTypes.length) {
    const used = all<{ event_type: string }>('SELECT DISTINCT event_type FROM events').map((r) => r.event_type);
    const missing = used.filter((u) => !b.eventTypes.some((t) => t.key === u));
    if (missing.length) throw invalid(`סוגי אירוע בשימוש לא ניתנים למחיקה (אפשר להשבית): ${missing.join(', ')}`);
  }
  const stagesInUse = all<{ stage: string }>("SELECT DISTINCT stage FROM tasks UNION SELECT DISTINCT stage FROM task_templates").map((r) => r.stage);
  if (b.workStages.length) {
    const lost = stagesInUse.filter((st) => !b.workStages.some((w) => w.key === st) && !CORE_STAGES.includes(st as never));
    if (lost.length) throw invalid(`שלבים בשימוש לא ניתנים למחיקה: ${lost.join(', ')}`);
  }
  saveSettings({ ...getSettings(), system: b as SystemConfig }, user.id);
  audit({ entity: 'settings', entityId: 0, userId: user.id, action: 'updated', summary: 'עדכון מבנה ומונחי המערכת' });
  publish({ topic: 'settings' });
  return c.json({ system: getSettings().system, venues: loadVenues() });
});

// ---------------------------------------------------------------- venues

const venueSchema = z.object({
  name: zText(80).min(2, 'נדרש שם'),
  address: zText(300).default(''),
  track: z.enum(['direct', 'hall']),
  equipment: z.enum(['rental', 'consumables', 'none', 'site']),
  loadCheck: z.boolean(),
  siteDetails: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'צבע לא תקין'),
  sort: z.number().int().default(0),
  active: z.boolean().default(true),
  maxPerDay: z.number().int().min(1).max(50).nullable().default(null),
  defaults: z.object({
    eventType: z.string().max(40).optional(),
    serviceKind: z.enum(['full', 'platters']).optional(),
    startTime: zTime.optional(), endTime: zTime.optional(), deliveryTime: zTime.optional(),
    guests: z.number().int().min(0).max(10000).nullable().optional(),
    kosher: z.string().max(20).optional(),
    menuType: zText(120).optional(),
    eventManagerId: z.number().int().positive().nullable().optional(),
    hallContactName: zText(120).optional(),
    hallContactPhone: zPhone.optional(),
    payer: zText(120).optional(),
    address: zText(300).optional(),
  }).default({}),
});

adminRoutes.post('/venues', async (c) => {
  const user = requireGlobal(c, 'admin', 3);
  const b = await body(c, venueSchema.extend({ code: keyZ }));
  if (get('SELECT 1 FROM venues WHERE code = ?', b.code)) throw invalid('מזהה הנקודה כבר קיים', { fields: { code: 'כבר קיים' } });
  tx(() => {
    insert('venues', { code: b.code, name: b.name, address: b.address, track: b.track, equipment: b.equipment, load_check: b.loadCheck, site_details: b.siteDetails, color: b.color, sort: b.sort, active: b.active, max_per_day: b.maxPerDay, defaults: JSON.stringify(b.defaults) });
    insert('warehouses', { name: `מחסן ${b.name}`, venue: b.code });
    audit({ entity: 'venue', entityId: 0, userId: user.id, action: 'created', summary: b.name });
  });
  reloadConfig();
  publish({ topic: 'settings' });
  return c.json({ venues: loadVenues() }, 201);
});

adminRoutes.put('/venues/:code', async (c) => {
  const user = requireGlobal(c, 'admin', 3);
  const code = c.req.param('code');
  if (!get('SELECT 1 FROM venues WHERE code = ?', code)) throw invalid('נקודה לא קיימת');
  const b = await body(c, venueSchema);
  run('UPDATE venues SET name = ?, address = ?, track = ?, equipment = ?, load_check = ?, site_details = ?, color = ?, sort = ?, active = ?, max_per_day = ?, defaults = ? WHERE code = ?',
    b.name, b.address, b.track, b.equipment, b.loadCheck, b.siteDetails, b.color, b.sort, b.active, b.maxPerDay, JSON.stringify(b.defaults), code);
  audit({ entity: 'venue', entityId: 0, userId: user.id, action: 'updated', summary: b.name });
  reloadConfig();
  publish({ topic: 'settings' });
  return c.json({ venues: loadVenues() });
});

adminRoutes.delete('/venues/:code', (c) => {
  const user = requireGlobal(c, 'admin', 3);
  const code = c.req.param('code');
  if (get('SELECT 1 FROM events WHERE venue = ? LIMIT 1', code)) throw invalid('לנקודה יש אירועים – אפשר להשבית אותה במקום למחוק');
  tx(() => {
    run('DELETE FROM user_roles WHERE venue = ?', code);
    run('DELETE FROM equipment_templates WHERE venue = ?', code);
    run('UPDATE task_templates SET venue = NULL, active = 0 WHERE venue = ?', code);
    run('DELETE FROM warehouses WHERE venue = ? AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.warehouse_id = warehouses.id)', code);
    run('UPDATE warehouses SET venue = NULL WHERE venue = ?', code);
    run('DELETE FROM venues WHERE code = ?', code);
    audit({ entity: 'venue', entityId: 0, userId: user.id, action: 'deleted', summary: code });
  });
  reloadConfig();
  publish({ topic: 'settings' });
  return c.json({ venues: loadVenues() });
});
