/** Reusable event pieces: list rows/cards, people pickers, hooks. */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users2, AlertTriangle, ListChecks } from 'lucide-react';
import { api, qs } from '../../lib/api.ts';
import { Badge, Progress, StatusPill, VenueTag, venueColor } from '../../ui/Badge.tsx';
import { EVENT_TYPES, VENUE_RULES, WORK_STAGES } from '@shared/domain.ts';
import { formatDay, relativeDays, today } from '@shared/dates.ts';
import { formatMoney } from '@shared/money.ts';
import type { EventDetail, EventListItem } from '@shared/types.ts';

export function useEvent(id: number) {
  return useQuery({ queryKey: ['event', id], queryFn: () => api.get<EventDetail>(`/events/${id}`) });
}

export function useEventList(params: Record<string, string | number | undefined>) {
  return useQuery({ queryKey: ['events', params], queryFn: () => api.get<EventListItem[]>(`/events${qs(params)}`) });
}

export function SalesOrIntake({ e }: { e: Pick<EventListItem, 'venue' | 'salesStatus' | 'intakeStatus'> }) {
  return VENUE_RULES[e.venue].track === 'hall' ? <StatusPill kind="intake" value={e.intakeStatus} /> : <StatusPill kind="sales" value={e.salesStatus} />;
}

export function EventsTable({ items, showPayment }: { items: EventListItem[]; showPayment?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">תאריך</th>
            <th scope="col">אירוע</th>
            <th scope="col">נקודה</th>
            <th scope="col" className="text-end">אורחים</th>
            <th scope="col">שלב</th>
            <th scope="col">מכירה / קליטה</th>
            <th scope="col">תפריט</th>
            <th scope="col" className="min-w-36">מוכנות</th>
            <th scope="col">מנהל אירוע</th>
            {showPayment && <th scope="col">גבייה</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className={e.lifecycle === 'cancelled' ? 'opacity-60' : ''}>
              <td className="whitespace-nowrap">
                <div className="font-semibold">{formatDay(e.date)}</div>
                <div className="num text-xs text-[var(--color-muted)]">{e.startTime || ''}</div>
              </td>
              <td className="min-w-48">
                <Link to={`/events/${e.id}`} className="font-semibold text-[var(--color-ink)] hover:text-[var(--color-brand)] hover:underline">{e.title}</Link>
                <div className="text-xs text-[var(--color-muted)]">{EVENT_TYPES[e.eventType]}{e.clientName ? ` · ${e.clientName}` : ''}</div>
              </td>
              <td><VenueTag venue={e.venue} /></td>
              <td className="num text-end">{e.guests}</td>
              <td className="whitespace-nowrap text-sm">
                <span className="font-semibold">{WORK_STAGES[e.stage].n}. {WORK_STAGES[e.stage].label}</span>
                <div className="text-xs text-[var(--color-muted)]">{e.taskPct}% משימות</div>
                {e.blockedTasks > 0 && <Badge tone="danger">{e.blockedTasks} חסומות</Badge>}
              </td>
              <td><SalesOrIntake e={e} /></td>
              <td><StatusPill kind="menu" value={e.menuStatus} /></td>
              <td>
                <Progress pct={e.readinessPct} size="sm" label={`${e.readinessPct}%`} />
                {e.shortItems > 0 && <div className="mt-1 text-xs font-semibold text-[var(--color-danger)]">{e.shortItems} פריטים בחוסר</div>}
              </td>
              <td className="whitespace-nowrap text-sm">{e.eventManagerName ?? <span className="text-[var(--color-warn)]">לא שובץ</span>}</td>
              {showPayment && (
                <td className="whitespace-nowrap">
                  <StatusPill kind="payment" value={e.paymentStatus} />
                  {!!e.balance && e.balance > 0 && <div className="num text-xs text-[var(--color-muted)]">{formatMoney(e.balance)}</div>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact card for dashboards and phones. */
export function EventCard({ e, to }: { e: EventListItem; to?: string }) {
  const t = today();
  return (
    <Link to={to ?? `/events/${e.id}`} className="card block p-3.5 transition-colors hover:border-[var(--color-brand)]" style={{ borderInlineStartWidth: 4, borderInlineStartColor: venueColor(e.venue) }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold">{e.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-2)]">
            <span className="font-semibold">{formatDay(e.date)}{e.startTime ? ` · ${e.startTime}` : ''}</span>
            <span className="text-[var(--color-muted)]">{e.date >= t ? relativeDays(e.date) : ''}</span>
            <VenueTag venue={e.venue} />
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold"><Users2 className="size-4 text-[var(--color-muted)]" aria-hidden /><span className="num">{e.guests}</span></span>
      </div>
      <div className="mt-2.5"><Progress pct={e.readinessPct} size="sm" label={e.readinessLabel} /></div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="brand">{WORK_STAGES[e.stage].label} · {e.taskPct}%</Badge>
        {e.blockedTasks > 0 && <Badge tone="danger">{e.blockedTasks} חסומות</Badge>}
        <StatusPill kind="menu" value={e.menuStatus} />
        {e.shortItems > 0 && <Badge tone="danger"><AlertTriangle className="size-3" aria-hidden />{e.shortItems} בחוסר</Badge>}
        {e.openTasks > 0 && <Badge tone="info"><ListChecks className="size-3" aria-hidden />{e.openTasks} משימות</Badge>}
      </div>
    </Link>
  );
}
