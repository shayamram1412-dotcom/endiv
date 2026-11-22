import type { Context } from 'hono';
import { z } from 'zod';
import { can, canAt, canGlobal, type Level, type Module, type Principal } from '../../shared/permissions.ts';
import type { VenueCode } from '../../shared/domain.ts';
import { EVENT_TYPES as _ET, VENUE_LABEL as _VL, WORK_STAGES as _WS } from '../../shared/domain.ts';

export interface SessionUser extends Principal {
  email: string;
}
export type AppEnv = { Variables: { user: SessionUser } };
export type Ctx = Context<AppEnv>;

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'הרשומה') => new HttpError(404, `${what} לא נמצאה`, 'not_found');
export const forbidden = (msg = 'אין לך הרשאה לפעולה זו') => new HttpError(403, msg, 'forbidden');
export const invalid = (msg: string, details?: unknown) => new HttpError(422, msg, 'invalid', details);

const denied = (level: Level) => forbidden(level >= 2 ? 'אין לך הרשאת עריכה באזור זה' : 'אין לך הרשאת צפייה באזור זה');

/*
 * Every permission check states its scope — there is deliberately no "check without a venue":
 *  - requireAny:    lists. Passes with a grant at any venue; the query MUST then be filtered to the user's venues
 *                   (venueFilter / warehouseFilter / taskScope). The cross-venue test checks every list.
 *  - requireAt:     one record that belongs to a venue (or to the central kitchen when venue is null).
 *  - requireGlobal: business-wide data (suppliers, catalog, central warehouse, settings).
 */
export function requireAny(c: Ctx, module: Module, level: Level = 1): SessionUser {
  const u = c.get('user');
  if (!can(u, module, level)) throw denied(level);
  return u;
}
export function requireAt(c: Ctx, module: Module, level: Level, venue: VenueCode | string | null): SessionUser {
  const u = c.get('user');
  if (!canAt(u, module, level, venue)) throw denied(level);
  return u;
}
export function requireGlobal(c: Ctx, module: Module, level: Level = 1): SessionUser {
  const u = c.get('user');
  if (!canGlobal(u, module, level)) throw denied(level);
  return u;
}

/** Parse and validate a JSON body. Field errors are returned in Hebrew next to each field. */
export async function body<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalid('גוף הבקשה אינו JSON תקין');
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = hebrewIssue(issue);
    throw invalid('יש שדות שדורשים תיקון', { fields });
  }
  return r.data;
}

function hebrewIssue(i: z.core.$ZodIssue): string {
  if (i.message && /[֐-׿]/.test(i.message)) return i.message;
  switch (i.code) {
    case 'invalid_type': return 'ערך חסר או לא תקין';
    case 'too_small': return 'הערך קטן או קצר מדי';
    case 'too_big': return 'הערך גדול או ארוך מדי';
    case 'invalid_format': return 'פורמט לא תקין';
    case 'invalid_value': return 'ערך לא מוכר';
    default: return 'ערך לא תקין';
  }
}

export function intParam(c: Ctx, name = 'id'): number {
  const n = Number(c.req.param(name));
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
}

// ---------------------------------------------------------------- case conversion
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
export const toSnake = (s: string) => s.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase());

export function camel<T = Record<string, unknown>>(row: Record<string, unknown> | undefined | null): T {
  if (!row) return row as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}
export const camelAll = <T = Record<string, unknown>>(rows: Record<string, unknown>[]): T[] => rows.map((r) => camel<T>(r));

// ---------------------------------------------------------------- common schemas
/** One message per problem: empty → "נדרש תאריך", otherwise the format. */
export const zDate = z.string().superRefine((v, ctx) => {
  if (!v) ctx.addIssue({ code: 'custom', message: 'נדרש תאריך' });
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) ctx.addIssue({ code: 'custom', message: 'תאריך לא תקין' });
});
export const zTime = z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'שעה לא תקינה (HH:MM)')]);
export const zText = (max = 2000) => z.string().trim().max(max, `עד ${max} תווים`);
export const zId = z.number().int().positive();
export const zQty = z.number().finite().min(0, 'כמות לא יכולה להיות שלילית').max(1_000_000);
export const zAgorot = z.number().int('סכום לא תקין').min(0).max(100_000_000_00);
export const zPhone = z.string().trim().max(30).regex(/^[\d\s+\-()]*$/, 'מספר טלפון לא תקין');

// ---------------------------------------------------------------- validators for business-editable vocabularies
// Checked against the runtime dictionaries at request time, so venues / event types / stages added in Settings are valid.
export const zVenueCode = z.string().refine((v) => v in _VL, 'נקודה לא מוכרת');
export const zEventTypeKey = z.string().refine((v) => v in _ET, 'סוג אירוע לא מוכר');
export const zStageKey = z.string().refine((v) => v in _WS, 'שלב לא מוכר');
