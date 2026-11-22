import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camelAll, intParam, invalid, requireAny, zAgorot, zText, type AppEnv } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { venueFilter, eventFor } from '../events/service.ts';
import { EVENT_LIST_SQL, listItem } from '../events/routes.ts';
import { reconcileEvent } from '../tasks/engine.ts';
import { nowISO } from '../../../shared/dates.ts';
import { can } from '../../../shared/permissions.ts';
import type { QuoteRecord } from '../../../shared/types.ts';

export const salesRoutes = new Hono<AppEnv>();

/** Open direct-sale funnel: everything not signed/lost plus recently signed. */
salesRoutes.get('/pipeline', (c) => {
  const user = requireAny(c, 'sales', 1);
  const vf = venueFilter(user);
  const rows = all(
    `${EVENT_LIST_SQL} WHERE ${vf.sql} AND e.venue IN (SELECT code FROM venues WHERE track = 'direct') AND e.lifecycle != 'cancelled'
       AND (e.sales_status IN ('lead','quoted','tour') OR (e.sales_status = 'signed' AND e.contract_signed_at >= date('now','-30 day')))
     ORDER BY e.date`,
    ...vf.params,
  );
  return c.json(rows.map((r) => listItem(user, r)));
});

/** Conversion by source × venue in a date range (by inquiry creation date). Each cell lists its event ids for drill-down. */
salesRoutes.get('/conversion', (c) => {
  const user = requireAny(c, 'reports', 1);
  const from = c.req.query('from') ?? '1970-01-01';
  const to = c.req.query('to') ?? '9999-12-31';
  const vf = venueFilter(user);
  const rows = all<{ id: number; source: string; campaign: string; venue: string; sales_status: string; contract_total: number | null }>(
    `SELECT e.id, e.source, e.campaign, e.venue, e.sales_status, e.contract_total FROM events e
      WHERE ${vf.sql} AND e.venue IN (SELECT code FROM venues WHERE track = 'direct') AND substr(e.created_at, 1, 10) BETWEEN ? AND ?`,
    ...vf.params, from, to,
  );
  const showMoney = can(user, 'finance', 1);
  type Cell = { key: string; source: string; venue: string; leads: number; signed: number; lost: number; open: number; revenue: number | null; ids: number[]; signedIds: number[] };
  const map = new Map<string, Cell>();
  for (const r of rows) {
    const source = r.source || 'לא ידוע';
    const key = `${source}|${r.venue}`;
    const cell = map.get(key) ?? { key, source, venue: r.venue, leads: 0, signed: 0, lost: 0, open: 0, revenue: showMoney ? 0 : null, ids: [], signedIds: [] };
    cell.leads++;
    cell.ids.push(r.id);
    if (r.sales_status === 'signed') { cell.signed++; cell.signedIds.push(r.id); if (cell.revenue !== null) cell.revenue += r.contract_total ?? 0; }
    else if (r.sales_status === 'lost') cell.lost++;
    else cell.open++;
    map.set(key, cell);
  }
  const cells = [...map.values()].sort((a, b) => b.leads - a.leads);
  const campaigns = new Map<string, { campaign: string; leads: number; signed: number; ids: number[] }>();
  for (const r of rows.filter((r) => r.campaign)) {
    const cur = campaigns.get(r.campaign) ?? { campaign: r.campaign, leads: 0, signed: 0, ids: [] };
    cur.leads++;
    if (r.sales_status === 'signed') cur.signed++;
    cur.ids.push(r.id);
    campaigns.set(r.campaign, cur);
  }
  return c.json({ cells, campaigns: [...campaigns.values()] });
});

// ---------------------------------------------------------------- quotes (versioned)

salesRoutes.get('/events/:id/quotes', (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'sales', 1);
  const rows = camelAll<QuoteRecord>(all(
    'SELECT q.*, u.name AS created_by_name FROM quotes q LEFT JOIN users u ON u.id = q.created_by WHERE q.event_id = ? ORDER BY q.version DESC', ev.id,
  ));
  return c.json(rows);
});

const quoteSchema = z.object({
  perGuest: zAgorot.nullable(),
  total: zAgorot.refine((v) => v > 0, 'נדרש סכום'),
  guests: z.number().int().min(0),
  description: zText(4000).default(''),
});

salesRoutes.post('/events/:id/quotes', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'sales', 2);
  const b = await body(c, quoteSchema);
  if (b.perGuest !== null && b.guests > 0 && b.perGuest * b.guests !== b.total && b.description === '') {
    // Allowed (discounts/extras), but the difference must be explained.
    throw invalid('הסכום הכולל שונה ממחיר לאורח × אורחים. יש לפרט בתיאור את התוספות או ההנחה.', { fields: { description: 'נדרש הסבר לפער' } });
  }
  const id = tx(() => {
    const v = (get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM quotes WHERE event_id = ?', ev.id)!.v) + 1;
    run("UPDATE quotes SET status = 'superseded' WHERE event_id = ? AND status = 'sent'", ev.id);
    const id = insert('quotes', { event_id: ev.id, version: v, per_guest: b.perGuest, total: b.total, guests: b.guests, description: b.description, status: 'sent', created_by: user.id, created_at: nowISO() });
    if (ev.salesStatus === 'lead') run("UPDATE events SET sales_status = 'quoted', version = version + 1, updated_at = ? WHERE id = ?", nowISO(), ev.id);
    audit({ entity: 'quote', entityId: id, eventId: ev.id, clientId: ev.clientId, userId: user.id, action: 'created', summary: `הצעת מחיר גרסה ${v}` });
    return id;
  });
  reconcileEvent(ev.id);
  publish({ topic: 'event', id: ev.id, eventId: ev.id });
  return c.json({ id }, 201);
});
