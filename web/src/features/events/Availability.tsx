/** "Is the venue free that day?" — shown next to every date field that books a venue. */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.ts';
import { VENUE_LABEL } from '@shared/domain.ts';

export interface DayAvailability { max: number | null; booked: number; full: boolean; events: { id: number; title: string; startTime: string; salesStatus: string; booked: boolean }[] }

export function useAvailability(venue: string, date: string, excludeId?: number) {
  return useQuery({
    queryKey: ['availability', venue, date, excludeId ?? 0],
    enabled: !!venue && /^\d{4}-\d{2}-\d{2}$/.test(date),
    queryFn: () => api.get<DayAvailability>(`/events/availability${qs({ venue, date, exclude: excludeId })}`),
    staleTime: 30_000,
  });
}

export function AvailabilityNote({ venue, date, excludeId }: { venue: string; date: string; excludeId?: number }) {
  const q = useAvailability(venue, date, excludeId);
  const a = q.data;
  if (!a || (!a.events.length && a.max === null)) return null;
  const booked = a.events.filter((e) => e.booked);
  const leads = a.events.filter((e) => !e.booked);
  return (
    <div role={a.full ? 'alert' : undefined} className={`mt-1.5 rounded-[8px] px-2.5 py-1.5 text-xs ${a.full ? 'bg-[var(--color-danger-soft)] font-semibold text-[var(--color-danger)]' : booked.length ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' : 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]'}`}>
      {a.full ? `${VENUE_LABEL[venue as keyof typeof VENUE_LABEL] ?? venue} מלאה ביום זה (${a.booked}/${a.max})` : a.max !== null ? `${a.booked}/${a.max} אירועים סגורים ביום זה` : `${a.booked} אירועים סגורים ביום זה`}
      {booked.length > 0 && <>: {booked.map((e, i) => <span key={e.id}>{i ? ', ' : ''}<Link to={`/events/${e.id}`} className="underline">{e.title}</Link>{e.startTime ? ` ${e.startTime}` : ''}</span>)}</>}
      {leads.length > 0 && <span className="block font-normal text-[var(--color-muted)]">פניות פתוחות לאותו יום: {leads.map((e) => e.title).join(', ')}</span>}
    </div>
  );
}
