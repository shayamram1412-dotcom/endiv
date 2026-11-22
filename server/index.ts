import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, get } from './core/db.ts';
import { createApp } from './app.ts';
import { sweep } from './features/tasks/engine.ts';
import { seedDemo } from './seed/demo.ts';
import { reloadConfig } from './core/config.ts';
import { dailyBackupIfDue } from './core/backup.ts';
import { getSettings } from './core/settings.ts';

openDb();
if (!get('SELECT 1 FROM users LIMIT 1')) {
  console.log('Empty database – loading demo data…');
  seedDemo();
}
reloadConfig();

const app = createApp();

// Production: serve the built web app with SPA fallback.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use('/assets/*', serveStatic({ root: './dist' }));
  const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
  app.get('*', (c) => (c.req.path.startsWith('/api') ? c.notFound() : c.html(index)));
}

// Time-based task triggers (deliveries due, upcoming events, finished events).
const runSweep = () => {
  try { sweep(); } catch (e) { console.error('sweep failed', e); }
};
runSweep();
setInterval(runSweep, 5 * 60_000).unref();

// A verified backup once a day (checked every hour, so a restart never skips a day).
const runBackup = () => {
  dailyBackupIfDue(getSettings().backupKeep)
    .then((b) => { if (b) console.log(b.verified ? `גיבוי יומי נשמר: ${b.name}` : `גיבוי יומי נכשל באימות: ${b.problem}`); })
    .catch((e) => console.error('backup failed', e));
};
runBackup();
setInterval(runBackup, 3600_000).unref();

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`מטבחון API on http://localhost:${port}`));
