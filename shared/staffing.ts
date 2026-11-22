/**
 * Suggested staffing standard (תקן) per event type — guests per one worker.
 * Ratios come from Settings; the event manager can always override per event.
 */
import type { EventType, ServiceKind, StaffRole } from './domain.ts';
import { DEFAULT_SETTINGS, type StaffingStyle } from './settings.ts';

/** Service style per event type (editable with the event types in Settings). */
export const EVENT_STYLE: Record<string, StaffingStyle> = {
  wedding: 'formal',
  bar_mitzvah: 'formal',
  private: 'formal',
  birthday: 'reception',
  conference: 'reception',
  corporate: 'reception',
  catering: 'reception',
  platters: 'platters',
  other: 'reception',
};

export function suggestStaffing(
  eventType: EventType, serviceKind: ServiceKind, guests: number,
  ratios: Record<StaffingStyle, Partial<Record<StaffRole, number>>> = DEFAULT_SETTINGS.staffingRatios,
): { role: StaffRole; required: number }[] {
  const style = serviceKind === 'platters' ? 'platters' : EVENT_STYLE[eventType] ?? 'reception';
  return (Object.entries(ratios[style] ?? {}) as [StaffRole, number][])
    .filter(([, per]) => per > 0)
    .map(([role, per]) => ({ role, required: guests > 0 ? Math.max(1, Math.ceil(guests / per)) : 0 }))
    .filter((r) => r.required > 0);
}
