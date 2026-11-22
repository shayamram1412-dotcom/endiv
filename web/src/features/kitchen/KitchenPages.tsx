/**
 * Kitchen: weekly load (total per dish + per event) and the daily prep board (KDS) —
 * large touch targets, high contrast, live updates, optimistic status changes.
 */
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Button, LinkButton } from '../../ui/Button.tsx';
import { Badge, StatusPill, VenueTag } from '../../ui/Badge.tsx';
import { DIETARY_KIND, type VenueCode, type MenuStatus, type DietaryKind } from '@shared/domain.ts';
import { addDays, formatDay, formatLongDay, today, weekStart } from '@shared/dates.ts';
import type { WeekDishLoad } from '@shared/kitchen.ts';

interface Week {
  start: string; end: string;
  days: { date: string; events: { id: number; title: string; venue: VenueCode; guests: number; startTime: string; menuStatus: MenuStatus }[]; guests: number; portions: number; prepItems: number; prepDone: number }[];
  dishes: WeekDishLoad[];
}

export function KitchenWeekPage() {
  const [s, set] = useUrlState({ start: weekStart(today()) });
  const q = useQuery({ queryKey: ['kitchen', 'week', s.start], queryFn: () => api.get<Week>(`/kitchen/week${qs({ start: s.start })}`) });
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <PageHeader title="תכנון מטבח שבועי" subtitle="עומס השבוע, סך מנות לכל מנה ופירוט לפי אירוע. השף מחליט מה מכינים מראש ומה ביום האירוע – בלשונית המטבח של כל אירוע."
        actions={<LinkButton to={`/kitchen/prep?date=${today()}`} variant="primary">לוח הכנות היום</LinkButton>} />
      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" aria-label="שבוע קודם" onClick={() => set({ start: addDays(s.start, -7) })} icon={<ChevronRight className="size-4" />} />
        <Button size="sm" onClick={() => set({ start: weekStart(today()) })}>השבוע</Button>
        <Button size="sm" aria-label="שבוע הבא" onClick={() => set({ start: addDays(s.start, 7) })} icon={<ChevronLeft className="size-4" />} />
        <h2 className="ms-2 text-lg font-bold">{formatDay(s.start)} – {formatDay(addDays(s.start, 6))}</h2>
      </div>
      <QueryView q={q} rows={6}>
        {(w) => {
          const max = Math.max(1, ...w.days.map((d) => d.portions));
          return (
            <div className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {w.days.map((d) => (
                  <div key={d.date} className={clsx('card p-3', d.date === today() && 'border-2 border-[var(--color-brand)]')}>
                    <Link to={`/kitchen/prep?date=${d.date}`} className="flex items-baseline justify-between font-bold hover:text-[var(--color-brand)]">{formatDay(d.date)}</Link>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]"><div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${(d.portions / max) * 100}%` }} /></div>
                    <div className="mt-1.5 text-xs text-[var(--color-ink-2)]"><span className="num font-bold">{d.portions.toLocaleString('he-IL')}</span> מנות · <span className="num">{d.guests}</span> אורחים</div>
                    {d.prepItems > 0 && <div className="text-xs text-[var(--color-muted)]">הכנות: {d.prepDone}/{d.prepItems}</div>}
                    <ul className="mt-2 space-y-1">
                      {d.events.map((e) => (
                        <li key={e.id}><Link to={`/events/${e.id}/kitchen`} className="block truncate rounded px-1 text-xs hover:bg-[var(--color-surface-2)]"><VenueTag venue={e.venue} className="me-1 [&>span:last-child]:hidden" />{e.title}</Link></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <Card title="סך שבועי לפי מנה" bodyClass="p-0">
                {!w.dishes.length ? <EmptyState title="אין מנות מתוכננות השבוע" /> : (
                  <table className="table">
                    <thead><tr><th>מנה</th><th className="text-end">סה״כ מנות</th><th>אירועים</th><th /></tr></thead>
                    <tbody>
                      {w.dishes.map((dsh) => (
                        <Fragment key={dsh.dishId}>
                          <tr>
                            <td className="font-semibold">{dsh.dishName}</td>
                            <td className="num text-end text-base font-bold">{dsh.total.toLocaleString('he-IL')}</td>
                            <td className="text-sm text-[var(--color-ink-2)]">{dsh.byEvent.length} אירועים{dsh.byEvent.length > 1 && <Badge tone="brand" className="ms-1">הכנה משותפת אפשרית</Badge>}</td>
                            <td><Button size="sm" variant="ghost" aria-expanded={open === dsh.dishId} onClick={() => setOpen(open === dsh.dishId ? null : dsh.dishId)}>{open === dsh.dishId ? 'הסתרה' : 'פירוט'}</Button></td>
                          </tr>
                          {open === dsh.dishId && dsh.byEvent.map((b) => (
                            <tr key={`${dsh.dishId}-${b.eventId}`} className="bg-[var(--color-surface-2)]">
                              <td className="ps-8 text-sm"><Link to={`/events/${b.eventId}/kitchen`} className="hover:underline">{b.title}</Link></td>
                              <td className="num text-end">{b.portions}</td>
                              <td className="text-sm">{formatDay(b.date)}</td><td />
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}

interface PrepCard {
  eventId: number; title: string; venue: VenueCode; date: string; startTime: string; guests: number; menuStatus: MenuStatus; menuVersion: number;
  dietary: { kind: DietaryKind; count: number; description: string }[];
  dishes: { dishId: number; dishName: string; category: string; allergens: string; portions: number; notes: string; status: string; planned: boolean; reason: string }[];
}

const NEXT: Record<string, 'in_progress' | 'done' | 'planned'> = { planned: 'in_progress', in_progress: 'done', done: 'planned', unplanned: 'in_progress' };
const STATUS_UI: Record<string, { label: string; cls: string }> = {
  unplanned: { label: 'לא תוכנן', cls: 'bg-[var(--color-surface-2)] text-[var(--color-muted)]' },
  planned: { label: 'ממתין', cls: 'bg-[var(--color-info-soft)] text-[var(--color-info)]' },
  in_progress: { label: 'בהכנה', cls: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' },
  done: { label: 'מוכן ✓', cls: 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]' },
};

export function PrepBoardPage() {
  const [s, set] = useUrlState({ date: today() });
  const key = ['kitchen', 'prep', s.date];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ date: string; cards: PrepCard[] }>(`/kitchen/prep${qs({ date: s.date })}`), refetchInterval: 60_000 });
  const [full, setFull] = useState(false);
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const setStatus = useAction(
    ({ eventId, dishId, status, planned, date }: { eventId: number; dishId: number; status: string; planned: boolean; date: string }) =>
      planned
        ? api.post(`/kitchen/events/${eventId}/prep/${dishId}/status`, { status })
        : api.put(`/kitchen/events/${eventId}/prep/${dishId}`, { prepDate: date, portionsOverride: null, reason: '' }).then(() => api.post(`/kitchen/events/${eventId}/prep/${dishId}/status`, { status })),
    {
      invalidate: [key],
      optimistic: {
        key,
        update: (old, v) => {
          const o = old as { date: string; cards: PrepCard[] };
          return { ...o, cards: o.cards.map((c) => (c.eventId !== v.eventId ? c : { ...c, dishes: c.dishes.map((d) => (d.dishId === v.dishId ? { ...d, status: v.status, planned: true } : d)) })) };
        },
      },
    },
  );

  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

  return (
    <div className={clsx(full && 'fixed inset-0 z-50 overflow-y-auto bg-[var(--color-bg)] p-4')}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-extrabold">לוח הכנות</h1>
        <span className="text-lg font-semibold text-[var(--color-ink-2)]">{formatLongDay(s.date)}</span>
        <div className="ms-auto flex gap-2">
          <Button size="lg" aria-label="יום קודם" onClick={() => set({ date: addDays(s.date, -1) })} icon={<ChevronRight className="size-5" />} />
          <Button size="lg" onClick={() => set({ date: today() })}>היום</Button>
          <Button size="lg" aria-label="יום הבא" onClick={() => set({ date: addDays(s.date, 1) })} icon={<ChevronLeft className="size-5" />} />
          <Button size="lg" onClick={() => void toggleFull()} icon={full ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}>{full ? 'יציאה' : 'מסך מלא'}</Button>
        </div>
      </div>
      <QueryView q={q} rows={6} empty={(d) => (d.cards.length ? null : <Card><EmptyState title="אין הכנות ביום זה" text="מנות מופיעות כאן ביום ההכנה שתוכנן להן, או ביום האירוע אם לא תוכנן אחרת." /></Card>)}>
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {d.cards.map((c) => {
              const done = c.dishes.filter((x) => x.status === 'done').length;
              const allergies = c.dietary.filter((x) => x.kind === 'allergy' || x.kind === 'gluten_free');
              return (
                <section key={c.eventId} className={clsx('card overflow-hidden', c.menuStatus === 'changed' && 'border-2 border-[var(--color-danger)]')} aria-labelledby={`kds-${c.eventId}`}>
                  <header className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                    <div className="min-w-0">
                      <h2 id={`kds-${c.eventId}`} className="truncate text-lg font-extrabold"><Link to={`/events/${c.eventId}/kitchen`} className="hover:underline">{c.title}</Link></h2>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <VenueTag venue={c.venue} />
                        <span className="font-semibold">{c.date === d.date ? `היום ${c.startTime}` : `לאירוע ב-${formatDay(c.date)} ${c.startTime}`}</span>
                        <span className="num">{c.guests} אורחים</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <div className="num text-2xl font-extrabold">{done}/{c.dishes.length}</div>
                      <StatusPill kind="menu" value={c.menuStatus} />
                    </div>
                  </header>
                  {c.menuStatus === 'changed' && <div className="bg-[var(--color-danger-soft)] px-3 py-2 text-sm font-bold text-[var(--color-danger)]"><AlertTriangle className="me-1 inline size-4" />התפריט שונה (גרסה {c.menuVersion}) – יש לאשר קבלה בלשונית התפריט</div>}
                  {allergies.length > 0 && (
                    <div className="bg-[var(--color-warn-soft)] px-3 py-2 text-sm font-semibold text-[var(--color-warn)]">
                      {allergies.map((a) => `${DIETARY_KIND[a.kind]}${a.count ? ` (${a.count})` : ''}${a.description ? `: ${a.description}` : ''}`).join(' · ')}
                    </div>
                  )}
                  <ul className="divide-y divide-[var(--color-border)]">
                    {c.dishes.map((x) => {
                      const st = STATUS_UI[x.status] ?? STATUS_UI.unplanned;
                      return (
                        <li key={x.dishId}>
                          <button onClick={() => setStatus.mutate({ eventId: c.eventId, dishId: x.dishId, status: NEXT[x.status] ?? 'in_progress', planned: x.planned, date: d.date })}
                            className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                            aria-label={`${x.dishName}, ${x.portions} מנות, ${st.label}. לחיצה לעדכון`}>
                            <div className="min-w-0 flex-1">
                              <div className={clsx('text-lg font-bold', x.status === 'done' && 'text-[var(--color-muted)] line-through')}>{x.dishName}</div>
                              <div className="text-sm text-[var(--color-ink-2)]">{[x.notes, x.allergens && `אלרגנים: ${x.allergens}`, x.reason && `שינוי: ${x.reason}`].filter(Boolean).join(' · ')}</div>
                            </div>
                            <span className="num text-2xl font-extrabold">{x.portions}</span>
                            <span className={clsx('w-24 rounded-lg px-2 py-2 text-center text-sm font-bold', st.cls)}>{st.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </QueryView>
    </div>
  );
}
