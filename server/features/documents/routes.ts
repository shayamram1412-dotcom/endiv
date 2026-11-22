/** Files attached to a client, optionally tied to a specific event (quote, contract, menu…). */
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, createReadStream, existsSync, unlinkSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { Readable } from 'node:stream';
import { all, get, insert, run } from '../../core/db.ts';
import { UPLOAD_DIR } from '../../core/db.ts';
import { camelAll, forbidden, intParam, invalid, notFound, type AppEnv, type SessionUser } from '../../core/http.ts';
import { audit } from '../../core/audit.ts';
import { clientVisible } from '../../core/scope.ts';
import { venueFilter } from '../events/service.ts';
import { publish } from '../../core/realtime.ts';
import { can } from '../../../shared/permissions.ts';
import { DOC_KIND, type VenueCode } from '../../../shared/domain.ts';
import { nowISO } from '../../../shared/dates.ts';
import type { DocumentRecord } from '../../../shared/types.ts';

export const documentsRoutes = new Hono<AppEnv>();

const MAX = 15 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|webp|heic)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/msword|application\/vnd\.ms-excel|text\/plain)$/;

function canSeeDocs(user: SessionUser, venue: VenueCode | null): boolean {
  return can(user, 'clients', 1, venue) || can(user, 'events', 2, venue);
}

documentsRoutes.get('/', (c) => {
  const user = c.get('user');
  const eventId = Number(c.req.query('event')) || null;
  const clientId = Number(c.req.query('client')) || null;
  if (!eventId && !clientId) throw invalid('נדרש אירוע או לקוח');
  const venue = eventId ? get<{ venue: VenueCode }>('SELECT venue FROM events WHERE id = ?', eventId)?.venue ?? null : null;
  if (eventId && !venue) throw notFound('האירוע');
  if (!canSeeDocs(user, venue)) throw forbidden();
  if (!eventId && clientId && !clientVisible(user, clientId)) throw notFound('הלקוח');
  // A client's files: only the general ones and those of events in the user's venues.
  const vf = venueFilter(user);
  const rows = all(
    `SELECT d.*, u.name AS uploaded_by_name, e.title AS event_title FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
      LEFT JOIN events e ON e.id = d.event_id WHERE ${eventId ? 'd.event_id = ?' : `d.client_id = ? AND (d.event_id IS NULL OR ${vf.sql})`} ORDER BY d.at DESC`,
    eventId ?? clientId, ...(eventId ? [] : vf.params),
  );
  return c.json(camelAll<DocumentRecord>(rows));
});

documentsRoutes.post('/', async (c) => {
  const user = c.get('user');
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw invalid('לא נבחר קובץ', { fields: { file: 'נדרש קובץ' } });
  if (file.size > MAX) throw invalid('הקובץ גדול מ-15MB', { fields: { file: 'גדול מדי' } });
  if (!ALLOWED.test(file.type)) throw invalid('סוג קובץ לא נתמך (PDF, תמונה, Word, Excel)', { fields: { file: 'סוג לא נתמך' } });
  const eventId = Number(form.eventId) || null;
  let clientId = Number(form.clientId) || null;
  const kind = String(form.kind ?? 'other');
  if (!(kind in DOC_KIND)) throw invalid('סוג מסמך לא מוכר');
  let venue: VenueCode | null = null;
  if (eventId) {
    const ev = get<{ venue: VenueCode; client_id: number | null }>('SELECT venue, client_id FROM events WHERE id = ?', eventId);
    if (!ev) throw notFound('האירוע');
    venue = ev.venue;
    clientId = clientId ?? ev.client_id;
    if (clientId !== ev.client_id) throw invalid('האירוע אינו שייך ללקוח');
  }
  if (!clientId) throw invalid('נדרש לקוח');
  if (!eventId && !clientVisible(user, clientId)) throw notFound('הלקוח');
  if (!can(user, 'clients', 2, venue) && !can(user, 'events', 2, venue)) throw forbidden();
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const stored = `${randomBytes(16).toString('hex')}${extname(file.name).toLowerCase().slice(0, 8)}`;
  writeFileSync(resolve(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));
  const name = file.name.slice(0, 200);
  const id = insert('documents', { client_id: clientId, event_id: eventId, kind, name, stored_name: stored, mime: file.type, size: file.size, uploaded_by: user.id, at: nowISO() });
  audit({ entity: 'document', entityId: id, eventId, clientId, userId: user.id, action: 'uploaded', summary: `${DOC_KIND[kind as keyof typeof DOC_KIND]}: ${name}` });
  publish({ topic: 'client', id: clientId, clientId }, ...(eventId ? [{ topic: 'event' as const, id: eventId, eventId }] : []));
  return c.json({ id }, 201);
});

function loadDoc(user: SessionUser, id: number) {
  const d = get<{ stored_name: string; name: string; mime: string; event_id: number | null; client_id: number | null }>('SELECT stored_name, name, mime, event_id, client_id FROM documents WHERE id = ?', id);
  if (!d) throw notFound('המסמך');
  const venue = d.event_id ? get<{ venue: VenueCode }>('SELECT venue FROM events WHERE id = ?', d.event_id)?.venue ?? null : null;
  if (!canSeeDocs(user, venue)) throw notFound('המסמך');
  if (!d.event_id && d.client_id && !clientVisible(user, d.client_id)) throw notFound('המסמך');
  return { d, venue };
}

documentsRoutes.get('/:id/download', (c) => {
  const { d } = loadDoc(c.get('user'), intParam(c));
  const path = resolve(UPLOAD_DIR, d.stored_name);
  if (!path.startsWith(UPLOAD_DIR) || !existsSync(path)) throw notFound('הקובץ');
  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      'content-type': d.mime,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
});

documentsRoutes.delete('/:id', (c) => {
  const user = c.get('user');
  const id = intParam(c);
  const { d, venue } = loadDoc(user, id);
  if (!can(user, 'clients', 2, venue) && !can(user, 'events', 3, venue)) throw forbidden();
  run('DELETE FROM documents WHERE id = ?', id);
  const path = resolve(UPLOAD_DIR, d.stored_name);
  if (path.startsWith(UPLOAD_DIR) && existsSync(path)) unlinkSync(path);
  audit({ entity: 'document', entityId: id, eventId: d.event_id, clientId: d.client_id, userId: user.id, action: 'deleted', summary: d.name });
  publish({ topic: 'client', id: d.client_id ?? undefined, clientId: d.client_id });
  return c.json({ ok: true });
});
