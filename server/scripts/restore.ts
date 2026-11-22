/**
 * Restore the system from a backup.   npm run restore -- <backup folder name>   (list: npm run restore)
 *
 * Safe by design: refuses while the server is running, verifies the backup before touching anything,
 * and first saves the current database as a "pre-restore" backup so the restore itself can be undone.
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { cpSync, existsSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { BACKUP_DIR, DB_PATH, UPLOAD_DIR } from '../core/db.ts';
import { countRows, listBackups, verifyBackupFile } from '../core/backup.ts';

const portInUse = (port: number) => new Promise<boolean>((done) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); done(true); });
  s.once('error', () => done(false));
});

const name = process.argv[2];
if (!name) {
  console.log('גיבויים זמינים (החדש ראשון):');
  for (const b of listBackups()) console.log(`  ${b.name}  ${b.verified ? 'תקין' : `לא תקין – ${b.problem}`}  אירועים: ${b.counts.events ?? '?'}`);
  console.log('\nשחזור: npm run restore -- <שם הגיבוי>');
  process.exit(0);
}
const folder = resolve(BACKUP_DIR, name);
const file = resolve(folder, 'matbachon.db');
const v = verifyBackupFile(file);
if (!v.ok) { console.error(`הגיבוי לא תקין, לא שוחזר דבר: ${v.problem}`); process.exit(1); }
if (await portInUse(Number(process.env.PORT ?? 8787))) { console.error('השרת פועל. יש לעצור אותו לפני שחזור.'); process.exit(1); }

// Safety copy of what is there now.
if (existsSync(DB_PATH)) {
  const safety = resolve(BACKUP_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-pre-restore`);
  mkdirSync(safety, { recursive: true });
  const live = new DatabaseSync(DB_PATH);
  await backup(live, resolve(safety, 'matbachon.db'));
  const counts = countRows(live);
  live.close();
  if (existsSync(UPLOAD_DIR)) cpSync(UPLOAD_DIR, resolve(safety, 'uploads'), { recursive: true });
  writeFileSync(resolve(safety, 'backup.json'), JSON.stringify({ name: safety.split('/').pop(), at: new Date().toISOString(), kind: 'pre-restore', sizeBytes: statSync(resolve(safety, 'matbachon.db')).size, verified: true, problem: null, counts }, null, 2));
  console.log(`המצב הנוכחי נשמר בגיבוי ${safety.split('/').pop()}`);
}
for (const ext of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${ext}`, { force: true });
cpSync(file, DB_PATH);
if (existsSync(resolve(folder, 'uploads'))) { rmSync(UPLOAD_DIR, { recursive: true, force: true }); cpSync(resolve(folder, 'uploads'), UPLOAD_DIR, { recursive: true }); }
const after = verifyBackupFile(DB_PATH, v.counts);
console.log(after.ok ? `שוחזר בהצלחה מ-${name}. אירועים: ${after.counts.events}, לקוחות: ${after.counts.clients}.` : `אזהרה: ${after.problem}`);
