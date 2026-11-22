/** Backups are complete, verified, pruned — and a restored copy holds exactly what was there at backup time. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, run, get } from '../server/core/db.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { countRows, createBackup, dailyBackupIfDue, listBackups, pruneBackups, verifyBackupFile } from '../server/core/backup.ts';

openDb(':memory:');
seedDemo();

describe('backups', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mb-backup-'));
  const uploads = mkdtempSync(resolve(tmpdir(), 'mb-uploads-'));
  writeFileSync(resolve(uploads, 'contract.pdf'), 'PDF');

  it('a backup is verified and restores to exactly the state at backup time', async () => {
    const b = await createBackup('manual', dir, uploads);
    expect(b.verified).toBe(true);
    expect(b.counts.events).toBeGreaterThan(10);
    expect(readFileSync(resolve(dir, b.name, 'uploads', 'contract.pdf'), 'utf8')).toBe('PDF');
    // Work continues after the backup…
    const before = get<{ guests: number }>('SELECT guests FROM events WHERE id = 1')!.guests;
    run('UPDATE events SET guests = guests + 77 WHERE id = 1');
    run("INSERT INTO clients (name, phone, phone_digits, kind, created_at, updated_at) VALUES ('אחרי הגיבוי', '050-1', '0501', 'private', 'x', 'x')");
    // …and the backup still holds the earlier state.
    const restored = new DatabaseSync(resolve(dir, b.name, 'matbachon.db'), { readOnly: true });
    expect((restored.prepare('SELECT guests FROM events WHERE id = 1').get() as { guests: number }).guests).toBe(before);
    expect(restored.prepare("SELECT 1 FROM clients WHERE name = 'אחרי הגיבוי'").get()).toBeUndefined();
    expect(countRows(restored)).toEqual(b.counts);
    restored.close();
  });

  it('a damaged or missing backup is reported, not trusted', () => {
    const bad = resolve(dir, 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(resolve(bad, 'matbachon.db'), 'not a database');
    expect(verifyBackupFile(resolve(bad, 'matbachon.db')).ok).toBe(false);
    expect(verifyBackupFile(resolve(dir, 'nothing', 'matbachon.db')).problem).toBe('קובץ הגיבוי חסר');
  });

  it('daily backup runs once a day and old backups are pruned', async () => {
    const d2 = mkdtempSync(resolve(tmpdir(), 'mb-daily-'));
    expect(await dailyBackupIfDue(30, d2)).not.toBeNull();
    expect(await dailyBackupIfDue(30, d2)).toBeNull(); // already today
    for (let i = 0; i < 4; i++) await createBackup('manual', d2, uploads);
    expect(listBackups(d2)).toHaveLength(5);
    pruneBackups(3, d2);
    expect(listBackups(d2)).toHaveLength(3);
  });
});
