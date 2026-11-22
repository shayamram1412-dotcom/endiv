/** Month / week / day calendar of events, tours, tastings, scheduled calls and deliveries. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '../../lib/api.ts';
import { useUrlState } from '../../lib/useUrlState.ts';
import { PageHeader, ErrorState } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Select, optionsOf } from '../../ui/form.tsx';
import { venueColor } from '../../ui/Badge.tsx';
import { VENUE_LABEL } from '@shared/domain.ts';
import { addDays, formatDay, formatLongDay, monthStart, parseISODate, toISODate, today, weekStart } from '@shared/dates.ts';
import type { CalendarItem } from '@shared/types.ts';

const KIND_LABEL: Record<CalendarItem['kind'], string> = { event: 'אירועים', tour: 'סיורים', tasting: 'טעימות', call: 'שיחות', followup: 'שיחות חוזרות', delivery: 'אספקות' };
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function itemHref(i: CalendarItem) {
  if (i.kind === 'event') return `/events/${i.id}`;
  if (i.kind === 'delivery') return `/purchasing/${i.id}`;
  if (i.kind === 'tasting' && i.eventId) return `/events/${i.eventId}/menu`;
  if (i.kind === 'tour' && i.eventId) return `/events/${i.eventId}/sales`;
  if (i.clientId) return `/clients/${i.clientId}`;
  return i.eventId ? `/events/${i.eventId}` : '#';
}

function Chip({ i, compact }: { i: CalendarItem; compact?: boolean }) {
  const isEvent = i.kind === 'event';
  const tentative = i.status === 'tentative';
  return (
    <Link to={itemHref(i)} title={i.title}
      className={clsx('block truncate rounded-md px-1.5 py-0.5 text-[12px] leading-5 transition-opacity hover:opacity-80',
        isEvent ? 'font-semibold text-white' : 'border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-ink-2)]',
        tentative && 'border-2 border-dashed !bg-transparent !text-[var(--color-ink)]')}
      style={isEvent ? (tentative ? { borderColor: venueColor(i.venue) } : { background: venueColor(i.venue) }) : undefined}>
      {i.time && <><span className="num opacity-90">{i.time}</span>{' '}</>}
      {!isEvent && !compact && <span className="me-1">{i.kind === 'delivery' ? '🚚' : i.kind === 'tasting' ? '🍽' : i.kind === 'tour' ? '📍' : '📞'}</span>}
      {i.title}{isEvent && i.guests ? <span className="opacity-80"> · {i.guests}</span> : null}
    </Link>
  );
}

export function CalendarPage() {
  const [s, set] = useUrlState({ view: 'month', date: today(), venue: '', kinds: 'event,tour,tasting,call,followup,delivery' });
  const kinds = new Set(s.kinds.split(',').filter(Boolean));
  const range = useMemo(() => {
    if (s.view === 'day') return { from: s.date, to: s.date };
    if (s.view === 'week') { const f = weekStart(s.date); return { from: f, to: addDays(f, 6) }; }
    const m = monthStart(s.date);
    const f = weekStart(m);
    const end = toISODate(new Date(parseISODate(m).getFullYear(), parseISODate(m).getMonth() + 1, 0));
    return { from: f, to: addDays(weekStart(end), 6) };
  }, [s.view, s.date]);
  const q = useQuery({ queryKey: ['calendar', range, s.venue], queryFn: () => api.get<CalendarItem[]>(`/calendar${qs({ ...range, venue: s.venue })}`) });
  const items = (q.data ?? []).filter((i) => kinds.has(i.kind));
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [items]);

  const step = (dir: 1 | -1) => {
    if (s.view === 'day') set({ date: addDays(s.date, dir) });
    else if (s.view === 'week') set({ date: addDays(s.date, 7 * dir) });
    else { const d = parseISODate(s.date); set({ date: toISODate(new Date(d.getFullYear(), d.getMonth() + dir, 1)) }); }
  };
  const title = s.view === 'month'
    ? new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(parseISODate(s.date))
    : s.view === 'week' ? `${formatDay(range.from)} – ${formatDay(range.to)}` : formatLongDay(s.date);
  const toggleKind = (k: string) => { const n = new Set(kinds); if (n.has(k)) n.delete(k); else n.add(k); set({ kinds: [...n].join(',') }); };

  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);
  const month = s.date.slice(0, 7);

  return (
    <div>
      <PageHeader title="לוח שנה" actions={<Segmented label="תצוגה" value={s.view} onChange={(v) => set({ view: v })} options={[{ value: 'month', label: 'חודש' }, { value: 'week', label: 'שבוע' }, { value: 'day', label: 'יום' }]} />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => step(-1)} aria-label="הקודם" icon={<ChevronRight className="size-4" />} />
        <Button size="sm" onClick={() => set({ date: today() })}>היום</Button>
        <Button size="sm" onClick={() => step(1)} aria-label="הבא" icon={<ChevronLeft className="size-4" />} />
        <h2 className="mx-2 text-lg font-bold" aria-live="polite">{title}</h2>
        <Select aria-label="נקודה" value={s.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="כל הנקודות" options={optionsOf(VENUE_LABEL)} className="ms-auto w-40" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="סוגי פריטים">
        {(Object.keys(KIND_LABEL) as CalendarItem['kind'][]).map((k) => (
          <button key={k} aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}
            className={clsx('h-8 rounded-full border px-3 text-xs font-semibold', kinds.has(k) ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]' : 'border-[var(--color-border-strong)] text-[var(--color-muted)]')}>
            {KIND_LABEL[k]}
          </button>
        ))}
        <span className="ms-3 flex flex-wrap gap-3 text-xs">{(Object.keys(VENUE_LABEL) as (keyof typeof VENUE_LABEL)[]).map((v) => <span key={v} className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: venueColor(v) }} />{VENUE_LABEL[v]}</span>)}<span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm border-2 border-dashed border-[var(--color-muted)]" />בתהליך מכירה</span></span>
      </div>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : s.view === 'day' ? (
        <div className="card divide-y divide-[var(--color-border)]">
          {(byDate.get(s.date) ?? []).length === 0 && <p className="p-6 text-center text-[var(--color-muted)]">אין פריטים ביום זה</p>}
          {(byDate.get(s.date) ?? []).map((i) => (
            <Link key={`${i.kind}${i.id}`} to={itemHref(i)} className="flex items-center gap-3 p-3 hover:bg-[var(--color-surface-2)]">
              <span className="num w-14 font-bold">{i.time || '—'}</span>
              <span className="size-3 rounded-sm" style={{ background: venueColor(i.venue) }} aria-hidden />
              <span className="flex-1 font-semibold">{i.title}</span>
              <span className="text-xs text-[var(--color-muted)]">{KIND_LABEL[i.kind]}{i.guests ? ` · ${i.guests} אורחים` : ''}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-center text-xs font-bold text-[var(--color-muted)]">
            {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = byDate.get(d) ?? [];
              const events = list.filter((i) => i.kind === 'event');
              const overlap = events.length > 1;
              const out = s.view === 'month' && d.slice(0, 7) !== month;
              return (
                <div key={d} className={clsx('border-b border-e border-[var(--color-border)] p-1.5', s.view === 'week' ? 'min-h-72' : 'min-h-28', out && 'bg-[var(--color-surface-2)] opacity-60')}>
                  <div className="mb-1 flex items-center justify-between">
                    <button onClick={() => set({ view: 'day', date: d })} className={clsx('num grid size-7 place-items-center rounded-full text-xs font-bold', d === today() ? 'bg-[var(--color-brand)] text-[var(--color-on-brand)]' : 'hover:bg-[var(--color-surface-2)]')} aria-label={formatLongDay(d)}>{Number(d.slice(8))}</button>
                    {overlap && <span className="rounded bg-[var(--color-warn-soft)] px-1 text-[10px] font-bold text-[var(--color-warn)]" title="אירועים חופפים">{events.length} אירועים</span>}
                  </div>
                  <div className="space-y-0.5">
                    {list.slice(0, s.view === 'week' ? 14 : 4).map((i) => <Chip key={`${i.kind}${i.id}`} i={i} compact={s.view === 'month'} />)}
                    {list.length > (s.view === 'week' ? 14 : 4) && <button onClick={() => set({ view: 'day', date: d })} className="text-[11px] font-semibold text-[var(--color-brand)]">+{list.length - 4} נוספים</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
