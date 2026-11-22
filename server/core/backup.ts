/**
 * Backups: a consistent copy of the database plus the uploaded files, verified right after it is written.
 *
 *  - createBackup: one folder per backup (matbachon.db + uploads/), then verify it opens, passes SQLite's
 *    integrity check and holds the same number of rows as the live database.
 *  - a daily automatic backup (server/index.ts) and pruning to the number kept in settings;
 *  - restore is a separate command run while the server is stopped (server/scripts/restore.ts).
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BACKUP_DIR, UPLOAD_DIR, getDb } from './db.ts';

/** Tables whose row counts prove a backup is complete. */
export const KEY_TABLES = ['users', 'clients', 'events', 'menu_lines', 'tasks', 'payments', 'stock_movements', 'purchase_orders', 'documents', 'audit_log'] as const;

export interface BackupInfo {
  name: string;
  at: string;
  kind: 'auto' | 'manual' | 'pre-restore';
  sizeBytes: number;
  verified: boolean;
  problem: string | null;
  counts: Record<string, number>;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export function countRows(db: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of KEY_TABLES) {
    try { out[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n); } catch { out[t] = -1; }
  }
  return out;
}

/** Open the copy read-only and prove it is whole. */
export function verifyBackupFile(file: string, expected?: Record<string, number>): { ok: boolean; problem: string | null; counts: Record<string, number> } {
  if (!existsSync(file)) return { ok: false, problem: 'קובץ הגיבוי חסר', counts: {} };
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const check = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    if (check !== 'ok') return { ok: false, problem: `בדיקת תקינות נכשלה: ${check}`, counts: {} };
    const counts = countRows(db);
    if (expected) {
      const diff = Object.keys(expected).filter((k) => expected[k] !== counts[k]);
      if (diff.length) return { ok: false, problem: `מספר הרשומות שונה ב: ${diff.join(', ')}`, counts };
    }
    return { ok: true, problem: null, counts };
  } catch (e) {
    return { ok: false, problem: `לא ניתן לפתוח את הגיבוי: ${(e as Error).message}`, counts: {} };
  } finally {
    db?.close();
  }
}

export async function createBackup(kind: BackupInfo['kind'], dir = BACKUP_DIR, uploads = UPLOAD_DIR): Promise<BackupInfo> {
  const name = `${stamp()}-${kind}`;
  const folder = resolve(dir, name);
  mkdirSync(folder, { recursive: true });
  const expected = countRows(getDb());
  const file = resolve(folder, 'matbachon.db');
  await backup(getDb(), file);
  if (existsSync(uploads)) cpSync(uploads, resolve(folder, 'uploads'), { recursive: true });
  const v = verifyBackupFile(file, expected);
  const info: BackupInfo = { name, at: new Date().toISOString(), kind, sizeBytes: statSync(file).size, verified: v.ok, problem: v.problem, counts: v.counts };
  writeFileSync(resolve(folder, 'backup.json'), JSON.stringify(info, null, 2));
  return info;
}

export function listBackups(dir = BACKUP_DIR): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => existsSync(resolve(dir, n, 'backup.json')))
    .map((n) => JSON.parse(readFileSync(resolve(dir, n, 'backup.json'), 'utf8')) as BackupInfo)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Keep the newest `keep` backups (a pre-restore safety copy is never pruned automatically). */
export function pruneBackups(keep: number, dir = BACKUP_DIR): string[] {
  const removable = listBackups(dir).filter((b) => b.kind !== 'pre-restore');
  const gone = removable.slice(Math.max(1, keep)).map((b) => b.name);
  for (const n of gone) rmSync(resolve(dir, n), { recursive: true, force: true });
  return gone;
}

/** A daily backup: run if the newest automatic backup is older than 24 hours. */
export async function dailyBackupIfDue(keep: number, dir = BACKUP_DIR): Promise<BackupInfo | null> {
  const last = listBackups(dir).find((b) => b.kind === 'auto');
  if (last && Date.now() - new Date(last.at).getTime() < 24 * 3600_000) return null;
  const info = await createBackup('auto', dir);
  pruneBackups(keep, dir);
  return info;
}
