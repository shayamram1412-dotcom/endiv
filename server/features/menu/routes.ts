/**
 * Menu per event: lines, dietary instructions, approval snapshots, late changes and acknowledgements.
 * Rule: once a menu was approved, every save creates a new version with a diff, and the kitchen and the
 * event manager must each acknowledge it (spec ו + §4 "עודכן תפריט לאחר אישור").
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camel, forbidden, intParam, invalid, notFound, zId, zText, type AppEnv } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { can, hasRole } from '../../../shared/permissions.ts';
import { AUDIENCE, DIETARY_KIND } from '../../../shared/domain.ts';
import { nowISO } from '../../../shared/dates.ts';
import { diffMenus, type MenuSnapshot } from '../../../shared/menuDiff.ts';
import type { MenuVersionRecord, MenuView, DietaryRecord, EventRecord } from '../../../shared/types.ts';
import { eventFor, loadEvent, menuLines, menuSnapshot } from '../events/service.ts';
import { reconcileEvent } from '../tasks/engine.ts';
import type { Role } from '../../../shared/permissions.ts';

export const menuRoutes = new Hono<AppEnv>();

function view(ev: EventRecord): MenuView {
  const versions = all<{ id: number; version: number; changes: string; reason: string; approved_at: string; name: string | null }>(
    `SELECT v.id, v.version, v.changes, v.reason, v.approved_at, u.name FROM menu_versions v LEFT JOIN users u ON u.id = v.approved_by
      WHERE v.event_id = ? ORDER BY v.version DESC`, ev.id,
  ).map<MenuVersionRecord>((v) => ({
    id: v.id,
    version: v.version,
    changes: JSON.parse(v.changes),
    reason: v.reason,
    approvedByName: v.name ?? '',
    approvedAt: v.approved_at,
    acks: all<{ role: Role; name: string | null; acked_at: string | null }>(
      'SELECT a.role, u.name, a.acked_at FROM menu_acks a LEFT JOIN users u ON u.id = a.user_id WHERE a.menu_version_id = ?', v.id,
    ).map((a) => ({ role: a.role, userName: a.name, ackedAt: a.acked_at })),
  }));
  return {
    lines: menuLines(ev),
    dietary: all('SELECT id, kind, count, description FROM dietary WHERE event_id = ? ORDER BY id', ev.id).map((r) => camel<DietaryRecord>(r)),
    versions,
    status: ev.menuStatus,
    version: ev.menuVersion,
    eventVersion: ev.version,
  };
}

menuRoutes.get('/:id/menu', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'menu', 1);
  return c.json(view(ev));
});

const zAudience = z.enum(Object.keys(AUDIENCE) as [keyof typeof AUDIENCE, ...(keyof typeof AUDIENCE)[]]);
const zDietKind = z.enum(Object.keys(DIETARY_KIND) as [keyof typeof DIETARY_KIND, ...(keyof typeof DIETARY_KIND)[]]);

const saveSchema = z.object({
  eventVersion: z.number().int(),
  lines: z.array(z.object({
    dishId: zId,
    audience: zAudience.default('all'),
    perGuest: z.number().min(0, 'לא שלילי').max(20, 'מקדם גבוה מדי'),
    qtyOverride: z.number().int().min(0).max(100000).nullable().default(null),
    notes: zText(500).default(''),
  })).max(200),
  dietary: z.array(z.object({ kind: zDietKind, count: z.number().int().min(0).max(20000), description: zText(500).default('') })).max(100),
  /** Guest breakdown is part of the menu discussion at the tasting. */
  kids: z.number().int().min(0).max(20000).optional(),
  vegetarian: z.number().int().min(0).max(20000).optional(),
  vegan: z.number().int().min(0).max(20000).optional(),
  /** true = approve now (e.g. closed at the tasting). */
  approve: z.boolean().default(false),
  /** Required when changing an already-approved menu. */
  reason: zText(500).default(''),
});

function writeVersion(ev: EventRecord, userId: number, reason: string): { version: number; changes: number } {
  const prev = get<{ snapshot: string }>('SELECT snapshot FROM menu_versions WHERE event_id = ? ORDER BY version DESC LIMIT 1', ev.id);
  const current = menuSnapshot(loadEvent(ev.id));
  const changes = diffMenus(prev ? (JSON.parse(prev.snapshot) as MenuSnapshot) : null, current);
  const version = ev.menuVersion + 1;
  const vid = insert('menu_versions', { event_id: ev.id, version, snapshot: JSON.stringify(current), changes: JSON.stringify(changes), reason, approved_by: userId, approved_at: nowISO() });
  if (prev) {
    // Late change: the kitchen and the event manager (full service) must each confirm they received it.
    insert('menu_acks', { menu_version_id: vid, role: 'kitchen' });
    if (ev.serviceKind === 'full') insert('menu_acks', { menu_version_id: vid, role: 'event_manager' });
  }
  run('UPDATE events SET menu_status = ?, menu_version = ?, version = version + 1, updated_at = ? WHERE id = ?', prev ? 'changed' : 'approved', version, nowISO(), ev.id);
  return { version, changes: changes.length };
}

menuRoutes.put('/:id/menu', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'menu', 2);
  const b = await body(c, saveSchema);
  if (ev.version !== b.eventVersion) {
    throw invalid('האירוע עודכן בינתיים על ידי משתמש אחר. טען מחדש את התפריט לפני השמירה.', { stale: true });
  }
  const wasApproved = ev.menuStatus === 'approved' || ev.menuStatus === 'changed';
  if (wasApproved && !b.reason) throw invalid('שינוי בתפריט מאושר מחייב סיבה', { fields: { reason: 'נדרשת סיבת שינוי' } });
  if (b.approve && !can(user, 'menu', 3, ev.venue)) throw forbidden('אישור תפריט דורש הרשאת אישור');
  const dishIds = [...new Set(b.lines.map((l) => l.dishId))];
  if (dishIds.length) {
    const found = all<{ id: number }>(`SELECT id FROM dishes WHERE id IN (${dishIds.map(() => '?').join(',')})`, ...dishIds).length;
    if (found !== dishIds.length) throw invalid('אחת המנות אינה קיימת בקטלוג');
  }
  const seen = new Set<string>();
  for (const l of b.lines) {
    const k = `${l.dishId}|${l.audience}`;
    if (seen.has(k)) throw invalid('אותה מנה מופיעה פעמיים לאותו קהל');
    seen.add(k);
  }

  const result = tx(() => {
    // Re-checked inside the transaction: two saves from the same starting point — only the first one lands.
    if (!get('SELECT 1 FROM events WHERE id = ? AND version = ?', ev.id, b.eventVersion)) {
      throw invalid('האירוע עודכן בינתיים על ידי משתמש אחר. טען מחדש את התפריט לפני השמירה.', { stale: true });
    }
    const before = menuSnapshot(ev);
    run('DELETE FROM menu_lines WHERE event_id = ?', ev.id);
    b.lines.forEach((l, i) => insert('menu_lines', { event_id: ev.id, dish_id: l.dishId, audience: l.audience, per_guest: l.perGuest, qty_override: l.qtyOverride, notes: l.notes, sort: i }));
    run('DELETE FROM dietary WHERE event_id = ?', ev.id);
    for (const d of b.dietary) insert('dietary', { event_id: ev.id, kind: d.kind, count: d.count, description: d.description });
    const guestSet: string[] = [];
    const guestVals: number[] = [];
    for (const k of ['kids', 'vegetarian', 'vegan'] as const) if (b[k] !== undefined) { guestSet.push(`${k} = ?`); guestVals.push(b[k]!); }
    if (guestSet.length) run(`UPDATE events SET ${guestSet.join(', ')} WHERE id = ?`, ...guestVals, ev.id);
    run("UPDATE events SET menu_status = CASE WHEN menu_status = 'open' THEN 'draft' ELSE menu_status END, version = version + 1, updated_at = ? WHERE id = ?", nowISO(), ev.id);
    const after = menuSnapshot(loadEvent(ev.id));
    const diff = diffMenus(before, after);
    audit({ entity: 'menu', entityId: ev.id, eventId: ev.id, clientId: ev.clientId, userId: user.id, action: 'menu_saved', summary: diff.length ? `${diff.length} שינויים בתפריט` : 'נשמר ללא שינוי', diff: { changes: diff } });
    if ((wasApproved && diff.length) || b.approve) {
      const v = writeVersion(loadEvent(ev.id), user.id, b.reason || (b.approve ? 'אושר' : ''));
      audit({ entity: 'menu', entityId: ev.id, eventId: ev.id, clientId: ev.clientId, userId: user.id, action: wasApproved ? 'menu_changed' : 'menu_approved', summary: `גרסת תפריט ${v.version}${b.reason ? ` – ${b.reason}` : ''}` });
      return { versioned: v.version };
    }
    return { versioned: null };
  });
  reconcileEvent(ev.id);
  publish({ topic: 'event', id: ev.id, eventId: ev.id });
  return c.json({ ...result, menu: view(loadEvent(ev.id)) });
});

/** Acknowledge receipt of a menu version (kitchen or event manager). */
menuRoutes.post('/:id/menu/ack', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'events', 1);
  const b = await body(c, z.object({ role: z.enum(['kitchen', 'event_manager']) }));
  const allowed = hasRole(user, b.role, ev.venue) || hasRole(user, 'owner') || hasRole(user, 'ops');
  if (!allowed) throw forbidden('רק בעל התפקיד יכול לאשר קבלה');
  const v = get<{ id: number }>('SELECT id FROM menu_versions WHERE event_id = ? AND version = ?', ev.id, ev.menuVersion);
  if (!v) throw notFound('גרסת התפריט');
  const r = run('UPDATE menu_acks SET user_id = ?, acked_at = ? WHERE menu_version_id = ? AND role = ? AND acked_at IS NULL', user.id, nowISO(), v.id, b.role);
  if (!r.changes) throw invalid('אין אישור קבלה ממתין לתפקיד זה');
  audit({ entity: 'menu', entityId: ev.id, eventId: ev.id, userId: user.id, action: 'menu_ack', summary: `אישור קבלת גרסה ${ev.menuVersion} (${b.role === 'kitchen' ? 'מטבח' : 'מנהל אירוע'})` });
  reconcileEvent(ev.id);
  return c.json({ ok: true });
});
