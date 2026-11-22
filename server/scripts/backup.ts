/** Take a verified backup now from the command line:  npm run backup */
import { openDb } from '../core/db.ts';
import { createBackup } from '../core/backup.ts';

openDb();
const b = await createBackup('manual');
console.log(b.verified ? `גיבוי תקין נשמר: ${b.name} (אירועים: ${b.counts.events})` : `הגיבוי נכשל באימות: ${b.problem}`);
process.exit(b.verified ? 0 : 1);
