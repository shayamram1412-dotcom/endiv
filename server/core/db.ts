import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MIGRATIONS } from './schema.ts';

export type Param = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data');
export const DB_PATH = process.env.DB_PATH ?? resolve(DATA_DIR, 'matbachon.db');
export const UPLOAD_DIR = resolve(DATA_DIR, 'uploads');
export const BACKUP_DIR = resolve(DATA_DIR, 'backups');

let db: DatabaseSync;

export function openDb(path = DB_PATH): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate();
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('DB not opened');
  return db;
}

function migrate(): void {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, at TEXT NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM migrations').all() as { id: string }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    tx(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO migrations (id, at) VALUES (?, ?)').run(m.id, new Date().toISOString());
    });
  }
}

/** Normalize JS values into SQLite parameters (booleans → 0/1, undefined → null). */
function norm(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number' || typeof p === 'string' || typeof p === 'bigint' || p instanceof Uint8Array) return p;
    return JSON.stringify(p);
  });
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...norm(params)) as T[];
}
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...norm(params)) as T | undefined;
}
export function run(sql: string, ...params: unknown[]): { changes: number; id: number } {
  const r = getDb().prepare(sql).run(...norm(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

let depth = 0;
/** Run `fn` atomically. Nested calls join the outer transaction via savepoints. */
export function tx<T>(fn: () => T): T {
  const name = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  depth++;
  try {
    const out = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return out;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw e;
  }
}

/** Build "INSERT INTO t (a,b) VALUES (?,?)" from an object. */
export function insert(table: string, values: Record<string, unknown>): number {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return run(sql, ...keys.map((k) => values[k])).id;
}

export function update(table: string, id: number, values: Record<string, unknown>, idCol = 'id'): number {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idCol} = ?`;
  return run(sql, ...keys.map((k) => values[k]), id).changes;
}

export async function backupTo(path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await backup(getDb(), path);
}
