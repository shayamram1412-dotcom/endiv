/**
 * Collections (spec יב): payment schedule per event, manual receipt reconciliation, receivables overview.
 * The accounting system remains external; references are recorded here by hand.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../../core/db.ts';
import { body, camelAll, intParam, invalid, notFound, requireAny, zAgorot, zDate, zText, type AppEnv } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { publish } from '../../core/realtime.ts';
import { PAYMENT_KIND } from '../../../shared/domain.ts';
import { formatMoney } from '../../../shared/money.ts';
import type { PaymentRecord, EventRecord } from '../../../shared/types.ts';
import { collectionFor, eventFor, venueFilter } from '../events/service.ts';
import { reconcileEvent } from '../tasks/engine.ts';
import { camel } from '../../core/http.ts';

export const financeRoutes = new Hono<AppEnv>();

financeRoutes.get('/events/:id/payments', (c) => {
  const ev = eventFor(c.get('user'), intParam(c), 'finance', 1);
  return c.json({
    lines: camelAll<PaymentRecord>(all('SELECT * FROM payments WHERE event_id = ? ORDER BY due_date IS NULL, due_date, id', ev.id)),
    summary: collectionFor(ev),
    contractTotal: ev.contractTotal,
  });
});

const lineSchema = z.object({
  kind: z.enum(Object.keys(PAYMENT_KIND) as [keyof typeof PAYMENT_KIND, ...(keyof typeof PAYMENT_KIND)[]]),
  amount: zAgorot.refine((v) => v > 0, 'נדרש סכום'),
  dueDate: zDate.nullable(),
  notes: zText(500).default(''),
});

financeRoutes.post('/events/:id/payments', async (c) => {
  const user = c.get('user');
  const ev = eventFor(user, intParam(c), 'finance', 2);
  const b = await body(c, lineSchema);
  const id = insert('payments', { event_id: ev.id, kind: b.kind, amount: b.amount, due_date: b.dueDate, notes: b.notes });
  audit({ entity: 'payment', entityId: id, eventId: ev.id, clientId: ev.clientId, userId: user.id, action: 'scheduled', summary: `${PAYMENT_KIND[b.kind]} ${formatMoney(b.amount)}` });
  reconcileEvent(ev.id);
  publish({ topic: 'finance', eventId: ev.id });
  return c.json({ id }, 201);
});

/** Record a receipt against a scheduled line (manual reconciliation). */
financeRoutes.post('/payments/:id/receive', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const p = get<{ event_id: number; amount: number; received: number; version: number }>('SELECT event_id, amount, received, version FROM payments WHERE id = ?', id);
  if (!p) throw notFound('התשלום');
  const ev = eventFor(user, p.event_id, 'finance', 2);
  const b = await body(c, z.object({
    amount: zAgorot.refine((v) => v > 0, 'נדרש סכום'),
    receivedAt: zDate,
    reference: zText(120).min(1, 'נדרשת אסמכתא (מס׳ קבלה / העברה)'),
    version: z.number().int(),
  }));
  if (b.version !== p.version) throw invalid('התשלום עודכן בינתיים. רענן ונסה שוב.');
  if (p.received + b.amount > p.amount) throw invalid(`הסכום עולה על היתרה בשורה (${formatMoney(p.amount - p.received)})`, { fields: { amount: 'גבוה מהיתרה' } });
  tx(() => {
    // Conditional on the version the user saw: two people recording the same receipt at once count it once.
    const r = run('UPDATE payments SET received = received + ?, received_at = ?, reference = CASE WHEN reference = \'\' THEN ? ELSE reference || \', \' || ? END, version = version + 1 WHERE id = ? AND version = ? AND received + ? <= amount',
      b.amount, b.receivedAt, b.reference, b.reference, id, b.version, b.amount);
    if (!r.changes) throw invalid('התשלום עודכן בינתיים על ידי משתמש אחר. רענן ונסה שוב.');
    audit({ entity: 'payment', entityId: id, eventId: ev.id, clientId: ev.clientId, userId: user.id, action: 'received', summary: `התקבל ${formatMoney(b.amount)} (${b.reference})` });
  });
  reconcileEvent(ev.id);
  publish({ topic: 'finance', eventId: ev.id });
  return c.json({ ok: true });
});

financeRoutes.put('/payments/:id', async (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const p = get<{ event_id: number; received: number }>('SELECT event_id, received FROM payments WHERE id = ?', id);
  if (!p) throw notFound('התשלום');
  const ev = eventFor(user, p.event_id, 'finance', 2);
  const b = await body(c, lineSchema);
  if (b.amount < p.received) throw invalid('לא ניתן להקטין מתחת לסכום שכבר התקבל');
  run('UPDATE payments SET kind = ?, amount = ?, due_date = ?, notes = ?, version = version + 1 WHERE id = ?', b.kind, b.amount, b.dueDate, b.notes, id);
  audit({ entity: 'payment', entityId: id, eventId: ev.id, userId: user.id, action: 'updated', summary: `${PAYMENT_KIND[b.kind]} ${formatMoney(b.amount)}` });
  reconcileEvent(ev.id);
  publish({ topic: 'finance', eventId: ev.id });
  return c.json({ ok: true });
});

/** Receivables: every event with an open balance, with status and next due. */
financeRoutes.get('/receivables', (c) => {
  const user = requireAny(c, 'finance', 1);
  const vf = venueFilter(user);
  const rows = all(
    `SELECT e.*, c.name AS client_name FROM events e LEFT JOIN clients c ON c.id = e.client_id
      WHERE ${vf.sql} AND e.lifecycle != 'cancelled' AND (e.contract_total > 0 OR EXISTS (SELECT 1 FROM payments p WHERE p.event_id = e.id))
      ORDER BY e.date`, ...vf.params,
  );
  const items = rows.map((r) => {
    const ev = camel<EventRecord & { clientName: string | null }>(r);
    const s = collectionFor(ev);
    return { eventId: ev.id, title: ev.title, clientName: ev.clientName, venue: ev.venue, date: ev.date, lifecycle: ev.lifecycle, payer: ev.payer, ...s };
  }).filter((i) => c.req.query('all') === '1' || i.balance > 0);
  const totals = items.reduce((t, i) => ({ balance: t.balance + i.balance, overdue: t.overdue + i.overdue, received: t.received + i.received }), { balance: 0, overdue: 0, received: 0 });
  return c.json({ items, totals });
});
