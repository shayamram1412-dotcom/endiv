import { get, run } from './db.ts';
import { mergeSettings, type BusinessSettings } from '../../shared/settings.ts';
import { nowISO } from '../../shared/dates.ts';
import { reloadConfig } from './config.ts';

let cache: BusinessSettings | null = null;

export function getSettings(): BusinessSettings {
  if (cache) return cache;
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = 'business'");
  cache = mergeSettings(row ? (JSON.parse(row.value) as Partial<BusinessSettings>) : null);
  return cache;
}

export function saveSettings(s: BusinessSettings, userId: number): void {
  run(
    "INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('business', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    JSON.stringify(s), userId, nowISO(),
  );
  cache = null;
  // Re-apply vocabulary/structure to the runtime dictionaries.
  reloadConfig();
}
