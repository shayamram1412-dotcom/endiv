/** Loads the business's configuration (venues table + settings) into the shared runtime dictionaries. */
import { all } from './db.ts';
import { getSettings } from './settings.ts';
import { applyConfig, type VenueConfig } from '../../shared/config.ts';
import { camelAll } from './http.ts';

export function loadVenues(): VenueConfig[] {
  return camelAll<VenueConfig>(all('SELECT * FROM venues ORDER BY sort, code')).map((v) => ({
    ...v, loadCheck: !!v.loadCheck, siteDetails: !!v.siteDetails,
    defaults: (() => { try { return JSON.parse(String((v as { defaults?: unknown }).defaults ?? '{}')); } catch { return {}; } })(),
  }));
}

export function reloadConfig(): void {
  applyConfig(getSettings().system, loadVenues());
}
