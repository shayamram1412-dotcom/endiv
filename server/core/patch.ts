/**
 * Field-level optimistic concurrency.
 * The client sends the fields it changed plus the values it started from (`base`).
 * If another user changed one of *those* fields in the meantime we refuse with 409 and
 * report exactly which fields collided; edits to other fields merge without loss.
 */
import { get, update } from './db.ts';
import { HttpError, toSnake, camel } from './http.ts';
import { nowISO } from '../../shared/dates.ts';

export interface PatchInput {
  changes: Record<string, unknown>;
  base?: Record<string, unknown>;
}

export interface FieldConflict {
  field: string;
  yours: unknown;
  theirs: unknown;
  base: unknown;
}

const same = (a: unknown, b: unknown) => (a ?? '') === (b ?? '') || String(a ?? '') === String(b ?? '');

export function patchRow<T extends object>(
  table: string,
  id: number,
  input: PatchInput,
  allowed: readonly string[],
  opts: { touchUpdatedAt?: boolean } = {},
): { before: T; after: T; changed: Record<string, { from: unknown; to: unknown }> } {
  const row = get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, 'הרשומה לא נמצאה', 'not_found');
  const before = camel<T>(row);
  const conflicts: FieldConflict[] = [];
  const set: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  for (const [field, value] of Object.entries(input.changes)) {
    if (!allowed.includes(field)) throw new HttpError(422, `השדה ${field} אינו ניתן לעריכה כאן`, 'invalid');
    const current = (before as Record<string, unknown>)[field];
    if (input.base && field in input.base && !same(input.base[field], current) && !same(value, current)) {
      conflicts.push({ field, yours: value, theirs: current, base: input.base[field] });
      continue;
    }
    if (!same(value, current)) {
      set[toSnake(field)] = value;
      changed[field] = { from: current, to: value };
    }
  }
  if (conflicts.length) {
    throw new HttpError(409, 'משתמש אחר עדכן את אותם שדות בזמן שערכת. בדוק את הערכים העדכניים לפני שמירה.', 'conflict', { conflicts, current: before });
  }
  if (Object.keys(set).length) {
    if ('version' in row) set.version = Number(row.version) + 1;
    if (opts.touchUpdatedAt !== false && 'updated_at' in row) set.updated_at = nowISO();
    update(table, id, set);
  }
  const after = camel<T>(get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, id)!);
  return { before, after, changed };
}
