/** Reset the database and load demo data: `npm run seed`. */
import { rmSync } from 'node:fs';
import { DB_PATH, openDb } from '../core/db.ts';
import { seedDemo } from './demo.ts';

for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
openDb();
seedDemo();
